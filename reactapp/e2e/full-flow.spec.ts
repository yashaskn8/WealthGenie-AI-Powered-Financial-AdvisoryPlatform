import { test, expect, type Page, type Response } from '@playwright/test';

function apiResponse(method: string, pathname: string) {
  return (response: Response) => {
    const url = new URL(response.url());
    return response.request().method() === method && url.pathname === pathname;
  };
}

async function assertNoSensitiveBrowserStorage(page: Page) {
  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  const serialized = JSON.stringify(storage);
  expect(serialized).not.toMatch(/wg_token|wg_user|wg_profile|wealthgenie_user_profile/i);
  expect(serialized).not.toMatch(/"token"\s*:|monthly_income|monthly_savings|liquid_savings/i);
}

test.describe('real WealthGenie dependency lifecycle', () => {
  test('signup, profile, recommendation, products, market, simulations, tax, grounded chat, session, and logout', async ({ page, context }) => {
    test.setTimeout(360_000);
    const consoleErrors: string[] = [];
    const prohibitedBrowserProviderRequests: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('request', request => {
      if (/(?:nseindia\.com|amfiindia\.com|sbi\.bank|indiapost\.gov\.in|integrate\.api\.nvidia\.com|api\.groq\.com|generativelanguage\.googleapis\.com)/i.test(request.url())) {
        prohibitedBrowserProviderRequests.push(request.url());
      }
    });
    const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const user = {
      name: `E2E User ${unique}`,
      // Joi validates public DNS TLDs; example.com is the reserved, valid
      // documentation domain for non-deliverable automated identities.
      email: `e2e-${unique}@example.com`,
      mobile: '9876543210',
      password: 'Valid@Pass2026!',
    };

    await page.goto('/login');
    await page.locator('#login-view a', { hasText: 'Register' }).click();
    await page.locator('#reg-name').fill(user.name);
    await page.locator('#reg-email').fill(user.email);
    await page.locator('#reg-mobile').fill(user.mobile);
    await page.locator('#reg-password').fill(user.password);
    await page.locator('#reg-confirm-password').fill(user.password);

    const registrationPromise = page.waitForResponse(apiResponse('POST', '/api/auth/register'));
    await page.locator('#register-form button[type="submit"]').click();
    const registration = await registrationPromise;
    expect(registration.status()).toBe(201);
    await expect(page.getByRole('heading', { name: 'Registration Successful!' })).toBeVisible();
    await page.locator('.popup-card button', { hasText: 'OK' }).click();
    await expect(page).toHaveURL(/\/profile$/);

    const profileScrollRegion = page.getByTestId('profile-scroll-region');
    const scrollMetrics = await profileScrollRegion.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(scrollMetrics.overflowY).toBe('auto');
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    await profileScrollRegion.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await expect(page.getByTestId('profile-save')).toBeVisible();

    await page.getByTestId('profile-input-monthly_take_home').fill('90000');
    await page.getByTestId('profile-input-monthly_savings').fill('25000');
    await page.getByTestId('profile-input-age').fill('34');
    const horizonInput = page.getByTestId('profile-input-investment_horizon_years');
    await horizonInput.focus();
    await horizonInput.press('Home');
    for (let year = 1; year < 12; year += 1) {
      await horizonInput.press('ArrowRight');
    }
    await page.getByRole('button', { name: 'Moderate', exact: true }).click();
    await page.getByLabel('Wealth Growth', { exact: true }).check();

    const profileCreatePromise = page.waitForResponse(apiResponse('POST', '/api/profile/build'));
    const recommendationPromise = page.waitForResponse(apiResponse('POST', '/api/recommend'), { timeout: 90_000 });
    await page.getByTestId('profile-save').click();

    const profileCreate = await profileCreatePromise;
    expect(profileCreate.status()).toBe(201);
    const profile = await profileCreate.json();
    expect(profile.profileId).toMatch(/^[0-9a-f]{24}$/i);
    expect(profile).toMatchObject({
      sold_property_proceeds: null,
      has_lump_sum: null,
      lump_sum_amount: null,
      liquid_savings: null,
      emi_burden_pct: null,
      financial_dependents: null,
      emergency_fund_months: null,
      final_suitability_risk: 'Conservative',
    });

    const recommendation = await recommendationPromise;
    expect(recommendation.status()).toBe(200);
    const advisory = await recommendation.json();
    expect(String(advisory.recommendationId)).toMatch(/^[0-9a-f]{24}$/i);
    expect(String(advisory.audit_id)).toMatch(/^[0-9a-f]{24}$/i);
    expect(advisory.instruments.length).toBeGreaterThan(0);
    expect(advisory.instruments.reduce((sum: number, item: { allocationWeight: number }) => sum + Number(item.allocationWeight), 0)).toBeCloseTo(1, 6);
    expect(advisory.return_data_class).toBe('MODEL_ASSUMPTION');
    expect(advisory.provider_forecast).toBe(false);
    expect(advisory.ml_fallback).toBe(true);
    expect(advisory.optional_profile_fields_unknown).toEqual([
      'soldPropertyProceeds', 'hasLumpSum', 'lumpSumAmount', 'liquidSavings', 'emiBurdenPct',
      'financialDependents', 'emergencyFundMonths',
    ]);
    expect(advisory.ml_input_fields_unknown).toEqual([
      'hasLumpSum', 'liquidSavings', 'emiBurdenPct', 'financialDependents', 'emergencyFundMonths',
    ]);
    await expect(page.locator('aside.sidebar')).toBeVisible();

    await page.getByTestId('nav-profile').click();
    await page.getByTestId('profile-input-monthly_savings').fill('27000');
    const profileUpdatePromise = page.waitForResponse(apiResponse('PUT', `/api/profile/${profile.profileId}`));
    const refreshedRecommendationPromise = page.waitForResponse(apiResponse('POST', '/api/recommend'), { timeout: 90_000 });
    await page.getByTestId('profile-save').click();
    const profileUpdate = await profileUpdatePromise;
    expect(profileUpdate.status()).toBe(200);
    const updatedProfile = await profileUpdate.json();
    expect(updatedProfile.monthly_savings).toBe(27000);
    await expect(page.getByRole('status')).toContainText(
      'Profile saved. Personalized outputs will refresh.',
    );
    const refreshedRecommendation = await refreshedRecommendationPromise;
    expect(refreshedRecommendation.status()).toBe(200);
    const refreshedAdvisory = await refreshedRecommendation.json();
    expect(String(refreshedAdvisory.recommendationId)).toMatch(/^[0-9a-f]{24}$/i);

    const wtiResponse = await page.request.post('/api/instruments/rank-wti', {
      data: { profileId: profile.profileId, parentInstrumentId: 'liquid_mf' },
      timeout: 120_000,
    });
    expect(wtiResponse.status()).toBe(200);
    const wti = await wtiResponse.json();
    expect(wti.total).toBeGreaterThanOrEqual(0);
    expect(wti.total).toBeLessThanOrEqual(5);
    expect(wti.products).toHaveLength(wti.total);
    for (const product of wti.products) {
      expect(product.provider).toBe('AMFI');
      expect(product.expectedReturn).toBeNull();
      expect(product.nominalReturn).toBeNull();
      expect(product.source?.provider).toBe('AMFI');
    }

    const marketResponse = await page.request.get('/api/regime/current', { timeout: 120_000 });
    expect(marketResponse.status()).toBe(200);
    const market = await marketResponse.json();
    expect(['MARKET_CONTEXT_AVAILABLE', 'MARKET_CONTEXT_UNAVAILABLE']).toContain(market.status);
    if (market.status === 'MARKET_CONTEXT_AVAILABLE') {
      expect(['NORMAL', 'CAUTIOUS', 'HIGH_VOLATILITY', 'RISK_OFF']).toContain(market.context);
      expect(market.sources.some((source: { provider?: string }) => source.provider === 'NSE')).toBe(true);
      expect(market.observedAt).toBeTruthy();
      expect(market.freshness).toBeTruthy();
    } else {
      expect(market.context).toBeNull();
      expect(market.reasonCodes.length).toBeGreaterThan(0);
    }

    const adjustmentResponse = await page.request.post('/api/regime/adjust', {
      data: { profileId: profile.profileId },
      timeout: 120_000,
    });
    expect(adjustmentResponse.status()).toBe(200);
    const adjustment = await adjustmentResponse.json();
    expect(adjustment.introducedInstrumentIds).toEqual([]);
    expect(adjustment.suitabilityRevalidated).toBe(true);
    expect(adjustment.concentrationCapsRevalidated).toBe(true);
    expect(adjustment.actualTotalTiltPct).toBeLessThanOrEqual(adjustment.maxTotalTiltPct);
    expect(Object.keys(adjustment.adjustedWeights).sort()).toEqual(
      refreshedAdvisory.instruments.map((item: { id: string }) => item.id).sort(),
    );

    const supportedTypes = [...new Set(refreshedAdvisory.instruments.map((item: { type: string }) => item.type))];
    const projectionResponse = await page.request.post('/api/projection', {
      data: {
        profileId: profile.profileId,
        instruments: supportedTypes.slice(0, 5),
        monthly_investment: 20000,
        years: [5, 12],
      },
    });
    expect(projectionResponse.status()).toBe(200);
    const projection = await projectionResponse.json();
    expect(projection.return_data_class).toBe('MODEL_ASSUMPTION');
    expect(projection.return_assumption_source).toBe('WEALTHGENIE_MODEL_POLICY');
    expect(projection.observed_market_fact).toBe(false);
    expect(projection.provider_forecast).toBe(false);

    const monteCarloResponse = await page.request.post('/api/montecarlo/montecarlo', {
      data: {
        profileId: profile.profileId,
        instrument: supportedTypes[0],
        monthly_investment: 20000,
        years: 5,
        target_amount: 1500000,
      },
    });
    expect(monteCarloResponse.status()).toBe(200);
    const monteCarlo = await monteCarloResponse.json();
    expect(monteCarlo.return_data_class).toBe('MODEL_ASSUMPTION');
    expect(monteCarlo.provider_forecast).toBe(false);
    expect(monteCarlo.simulations_run).toBeGreaterThan(0);
    expect(monteCarlo.percentile_labels.p50).toBe('Simulated median');

    await page.getByTestId('nav-allocation').click();
    await expect(page.getByRole('heading', { name: /Where to Invest Your Money/i })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Investment allocation breakdown donut chart' })).toBeVisible();

    await page.getByTestId('nav-goal-planner').click();
    await page.getByRole('button', { name: /Add custom goal/ }).click();
    await expect(page.getByTestId('goal-form')).toBeVisible();
    await page.getByRole('button', { name: /Emergency Fund/ }).click();
    await page.getByTestId('goal-target-amount').fill('600000');
    const targetYear = new Date().getUTCFullYear() + 4;
    await page.getByTestId('goal-target-date').fill(`${targetYear}-12-31`);
    await page.getByRole('button', { name: 'Next Step' }).click();
    await page.getByTestId('goal-current-savings').fill('100000');

    const goalCreatePromise = page.waitForResponse(apiResponse('POST', '/api/goals/create'), { timeout: 90_000 });
    await page.getByTestId('goal-submit').click();
    const goalCreate = await goalCreatePromise;
    expect(goalCreate.status()).toBe(201);
    const goal = await goalCreate.json();
    expect(String(goal.goal.goalId)).toMatch(/^[0-9a-f]{24}$/i);
    await expect(page.getByText('Emergency Fund').first()).toBeVisible();

    const taxPromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname === '/api/tax/compare';
    });
    await page.getByTestId('nav-tax-optimizer').click();
    await page.getByLabel('Gross annual taxable income').fill('1080000');
    await page.getByLabel('Income source').selectOption('salary');
    await page.getByRole('button', { name: 'Calculate from explicit tax facts' }).click();
    const taxResponse = await taxPromise;
    expect(taxResponse.status()).toBe(200);
    const tax = await taxResponse.json();
    expect(tax.new_regime.tax).toBeGreaterThanOrEqual(0);
    expect(tax.old_regime.tax).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('heading', { name: 'Server calculation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lower calculated tax' })).toBeVisible();

    const chatResponsePromise = page.waitForResponse(apiResponse('POST', '/api/chat/message'), { timeout: 90_000 });
    await page.getByRole('button', { name: 'Genie AI' }).click();
    await page.getByLabel('Ask Genie a financial question').fill('Explain why this recommendation fits my saved profile.');
    await page.getByRole('button', { name: 'Send message' }).click();
    const chatResponse = await chatResponsePromise;
    expect(chatResponse.status()).toBe(200);
    const chat = await chatResponse.json();
    expect(chat.grounded).toBe(true);
    expect(chat.validation_status).toBe('PASS');
    expect(chat.evidence_ids_used.length).toBeGreaterThan(0);
    expect(chat.citations.length).toBeGreaterThan(0);
    await expect(page.getByText('Grounded by WealthGenie data').last()).toBeVisible();
    await page.getByText('Grounded by WealthGenie data').last().click();
    await expect(page.getByText(/Provider: (DETERMINISTIC_TEMPLATE|NVIDIA_NIM|GEMINI|GROQ)/).last()).toBeVisible();

    const cookies = await context.cookies();
    expect(cookies.find(cookie => cookie.name === 'wg_session')).toMatchObject({ httpOnly: true });
    await assertNoSensitiveBrowserStorage(page);

    const sessionRestorePromise = page.waitForResponse(apiResponse('GET', '/api/auth/session'));
    await page.reload();
    const restored = await sessionRestorePromise;
    expect(restored.status()).toBe(200);
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 45_000 });
    await assertNoSensitiveBrowserStorage(page);

    const firstLogoutPromise = page.waitForResponse(apiResponse('POST', '/api/auth/logout'));
    await page.getByTestId('nav-sign-out').click();
    expect((await firstLogoutPromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/login$/);

    await page.locator('#login-email').fill(user.email);
    await page.locator('#login-password').fill(user.password);
    const loginPromise = page.waitForResponse(apiResponse('POST', '/api/auth/login'));
    await page.locator('#login-form button[type="submit"]').click();
    expect((await loginPromise).status()).toBe(200);
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 45_000 });

    const finalLogoutPromise = page.waitForResponse(apiResponse('POST', '/api/auth/logout'));
    await page.getByTestId('nav-sign-out').click();
    expect((await finalLogoutPromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some(cookie => cookie.name === 'wg_session')).toBe(false);
    await assertNoSensitiveBrowserStorage(page);
    expect(prohibitedBrowserProviderRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
