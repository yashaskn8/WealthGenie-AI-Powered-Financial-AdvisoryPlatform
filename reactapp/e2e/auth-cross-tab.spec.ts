import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';

async function installAuthProbe(page: Page) {
  await page.route('**/login', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().isNavigationRequest() && pathname === '/login') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body></body></html>',
      });
    }
    return route.fallback();
  });
  await page.goto('/login');
  await page.evaluate(async () => {
    const apiModulePath: string = '/src/services/api.js';
    const api = await import(/* @vite-ignore */ apiModulePath);
    (window as any).__authApi = api;
    const render = () => {
      document.body.dataset.authUser = api.getUserInfo()?.id || 'signed-out';
    };
    api.subscribeAuth(render);
    api.subscribeProfileChanges(() => {
      const count = Number(document.body.dataset.profileSignals || '0') + 1;
      document.body.dataset.profileSignals = String(count);
    });
    render();
  });
}

test('a profile save invalidates another tab without broadcasting financial profile values', async ({ context }) => {
  test.setTimeout(30_000);
  const server = await installServerSessionRoutes(context);
  const savedRequests: unknown[] = [];
  await context.route('**/api/profile/profile-1', async route => {
    savedRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: { profile: { profileId: 'profile-1', version: 2 } } });
  });
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  try {
    await installAuthProbe(tabA);
    await installAuthProbe(tabB);
    await tabA.evaluate(() => {
      (window as any).__profileWireMessages = [];
      const observer = new BroadcastChannel('wealthgenie-profile-state');
      observer.onmessage = event => (window as any).__profileWireMessages.push(event.data);
      (window as any).__profileWireObserver = observer;
    });
    await tabA.evaluate(() => (window as any).__authApi.login('user-a@example.com', 'safe-test-password'));
    await tabB.evaluate(() => (window as any).__authApi.restoreSession());
    await tabA.evaluate(() => (window as any).__authApi.updateProfile('profile-1', {
      monthly_take_home: 100000,
      monthly_savings: 20000,
      age: 35,
      risk_tolerance: 'Moderate',
      investment_goals: ['Wealth Growth'],
      investment_horizon_years: 10,
      version: 1,
    }));
    await expect(tabB.locator('body')).toHaveAttribute('data-profile-signals', '1');
    await expect.poll(() => tabA.evaluate(() => (window as any).__profileWireMessages.length)).toBe(1);
    expect(savedRequests).toHaveLength(1);
    expect(JSON.stringify(savedRequests[0])).toContain('100000');
    const wireMessages = await tabA.evaluate(() => JSON.stringify((window as any).__profileWireMessages));
    for (const privateValue of ['100000', '20000', 'Moderate', 'Wealth Growth', 'monthly_take_home']) {
      expect(wireMessages).not.toContain(privateValue);
    }
    const signal = await tabB.evaluate(() => (window as any).__authApi.getUserInfo()?.id);
    expect(signal).toBe('user-a');
    expect(await tabB.locator('body').getAttribute('data-profile-signals')).toBe('1');
  } finally {
    await tabA.evaluate(() => (window as any).__profileWireObserver?.close()).catch(() => undefined);
    server.releaseLateResponse();
    server.releaseHeldSessionRestore();
    await tabA.close();
    await tabB.close();
  }
});

test('a committed profile update with a lost response still invalidates peer tabs', async ({ context }) => {
  test.setTimeout(30_000);
  const server = await installServerSessionRoutes(context);
  let committed = false;
  await context.route('**/api/profile/profile-uncertain', async route => {
    committed = true;
    await route.abort('timedout');
  });
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  try {
    await installAuthProbe(tabA);
    await installAuthProbe(tabB);
    await tabA.evaluate(() => (window as any).__authApi.login('user-a@example.com', 'safe-test-password'));
    await tabB.evaluate(() => (window as any).__authApi.restoreSession());
    const outcome = await tabA.evaluate(async () => (window as any).__authApi.updateProfile('profile-uncertain', {
      monthly_take_home: 90000,
      monthly_savings: 15000,
      age: 35,
      risk_tolerance: 'Moderate',
      investment_goals: ['Wealth Growth'],
      investment_horizon_years: 10,
      version: 1,
    }).then(() => 'resolved').catch(() => 'uncertain'));
    expect(outcome).toBe('uncertain');
    expect(committed).toBe(true);
    await expect(tabB.locator('body')).toHaveAttribute('data-profile-signals', '1');
  } finally {
    server.releaseLateResponse();
    server.releaseHeldSessionRestore();
    await tabA.close();
    await tabB.close();
  }
});

async function installServerSessionRoutes(context: BrowserContext) {
  let serverUser: { id: string; email: string } | null = null;
  let releaseLateResponse: (() => void) | null = null;
  let markLateRequestStarted: (() => void) | null = null;
  const lateRequestStarted = new Promise<void>(resolve => { markLateRequestStarted = resolve; });
  const lateResponse = new Promise<void>(resolve => { releaseLateResponse = resolve; });
  let holdNextSessionRestore = false;
  let releaseHeldSessionRestore: (() => void) | null = null;
  let markHeldSessionRestoreStarted: (() => void) | null = null;
  const heldSessionRestoreStarted = new Promise<void>(resolve => { markHeldSessionRestoreStarted = resolve; });
  const heldSessionRestore = new Promise<void>(resolve => { releaseHeldSessionRestore = resolve; });

  await context.route('**/api/auth/login', async (route: Route) => {
    const email = route.request().postDataJSON().email as string;
    const id = email.startsWith('user-b') ? 'user-b' : 'user-a';
    serverUser = { id, email };
    await route.fulfill({ status: 200, json: { user: serverUser } });
  });
  await context.route('**/api/auth/logout', async (route: Route) => {
    serverUser = null;
    await route.fulfill({ status: 200, json: { message: 'Logout successful.' } });
  });
  await context.route('**/api/auth/session', async (route: Route) => {
    const userAtRequestStart = serverUser;
    if (holdNextSessionRestore) {
      holdNextSessionRestore = false;
      markHeldSessionRestoreStarted?.();
      await heldSessionRestore;
    }
    if (userAtRequestStart) await route.fulfill({ status: 200, json: { user: userAtRequestStart } });
    else await route.fulfill({ status: 401, json: { code: 'SESSION_EXPIRED' } });
  });
  await context.route('**/api/profile/current', async (route: Route) => {
    const userAtRequestStart = serverUser;
    markLateRequestStarted?.();
    await lateResponse;
    await route.fulfill({ status: 200, json: { user: userAtRequestStart } });
  });

  return {
    lateRequestStarted,
    releaseLateResponse: () => releaseLateResponse?.(),
    holdNextSessionRestore: () => { holdNextSessionRestore = true; },
    heldSessionRestoreStarted,
    releaseHeldSessionRestore: () => releaseHeldSessionRestore?.(),
  };
}

test('logout in another tab clears auth, cancels stale work, and a new login replaces the old identity', async ({ context }) => {
  test.setTimeout(30_000);
  const server = await installServerSessionRoutes(context);
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  const tabC = await context.newPage();
  let tabD: Page | null = null;

  try {
    await installAuthProbe(tabA);
    await installAuthProbe(tabB);
    await installAuthProbe(tabC);

    await tabA.evaluate(() => (window as any).__authApi.login('user-a@example.com', 'safe-test-password'));
    await expect(tabA.locator('body')).toHaveAttribute('data-auth-user', 'user-a');

    await tabB.evaluate(() => (window as any).__authApi.restoreSession());
    await expect(tabB.locator('body')).toHaveAttribute('data-auth-user', 'user-a');

    server.holdNextSessionRestore();
    const staleRestore = tabC.evaluate(() => (window as any).__authApi.restoreSession()
      .then(() => 'restored')
      .catch((error: { code?: string }) => error.code || 'rejected'));
    await server.heldSessionRestoreStarted;

    await tabB.evaluate(() => {
      const api = (window as any).__authApi;
      (window as any).__lateProfileRequest = api.getCurrentProfile({ retries: 0 })
        .then(() => 'resolved')
        .catch((error: { code?: string }) => error.code || 'rejected');
    });
    await server.lateRequestStarted;

    await tabA.evaluate(() => (window as any).__authApi.logout());
    await expect(tabB.locator('body')).toHaveAttribute('data-auth-user', 'signed-out');
    await expect(tabC.locator('body')).toHaveAttribute('data-auth-user', 'signed-out');
    tabD = await context.newPage();
    await installAuthProbe(tabD);
    await tabD.evaluate(() => (window as any).__authApi.restoreSession().catch(() => null));
    await expect(tabD.locator('body')).toHaveAttribute('data-auth-user', 'signed-out');

    server.releaseHeldSessionRestore();
    await staleRestore;
    await expect(tabC.locator('body')).toHaveAttribute('data-auth-user', 'signed-out');
    server.releaseLateResponse();
    await expect.poll(() => tabB.evaluate(() => (window as any).__lateProfileRequest)).not.toBe('resolved');

    await tabB.evaluate(() => (window as any).__authApi.login('user-b@example.com', 'safe-test-password'));
    await expect(tabB.locator('body')).toHaveAttribute('data-auth-user', 'user-b');
    await expect(tabA.locator('body')).toHaveAttribute('data-auth-user', 'user-b');
    await expect(tabC.locator('body')).toHaveAttribute('data-auth-user', 'user-b');
    await expect(tabD.locator('body')).toHaveAttribute('data-auth-user', 'user-b');
    expect(await tabA.locator('body').getAttribute('data-auth-user')).not.toBe('user-a');
  } finally {
    server.releaseLateResponse();
    server.releaseHeldSessionRestore();
    await tabA.close();
    await tabB.close();
    await tabC.close();
    await tabD?.close();
  }
});
