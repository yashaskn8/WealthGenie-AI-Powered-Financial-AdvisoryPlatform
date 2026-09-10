import { test, expect } from '@playwright/test';

const ARTIFACT_DIR = 'C:/Users/prana/.gemini/antigravity-ide/brain/56ce2aaf-db44-4e4c-b03b-12e05009c861/scratch';

/**
 * Market context mock — matches GET /api/regime/current
 * (WhereToInvestTab calls api.getCurrentMarketContext → request('GET', '/regime/current'))
 */
const MARKET_CONTEXT_MOCK = {
  status: 'MARKET_CONTEXT_AVAILABLE',
  context: 'CAUTIOUS',
  classification: 'DETERMINISTIC_POLICY_HEURISTIC',
  policyVersion: 'market-context-policy-1.0.0',
  observedAt: '2026-09-09T10:00:00.000Z',
  evaluatedAt: '2026-09-09T14:46:01.694Z',
  freshness: { status: 'FRESH' },
  reasonCodes: [
    'DRAWDOWN_AT_OR_BELOW_CAUTIOUS_THRESHOLD',
    'RETURN_20D_AT_OR_BELOW_CAUTIOUS_THRESHOLD',
    'PRICE_BELOW_MA50',
    'HYSTERESIS_CONTEXT_CONFIRMED',
  ],
  signals: {
    nifty50Current: { value: 23431.5, unit: 'INDEX_POINTS', available: true },
    nifty50PreviousClose: { value: 23635.1, unit: 'INDEX_POINTS', available: true },
    indiaVixCurrent: { value: 11.94, unit: 'INDEX_POINTS', available: true },
    return1DayPct: { value: -0.86, unit: 'PERCENT', available: true },
    return5DayPct: { value: -2.02, unit: 'PERCENT', available: true },
    return20DayPct: { value: -4.11, unit: 'PERCENT', available: true },
    drawdownFromRecentHighPct: { value: -11.15, unit: 'PERCENT', available: true },
    movingAverage50Day: { value: 24196.32, unit: 'INDEX_POINTS', available: true },
    movingAverage200Day: { value: 24583.9, unit: 'INDEX_POINTS', available: true },
    priceVsMovingAverage50Pct: { value: -3.16, unit: 'PERCENT', available: true },
    priceVsMovingAverage200Pct: { value: -4.69, unit: 'PERCENT', available: true },
    realizedVolatility20DayAnnualizedPct: { value: 5.67, unit: 'PERCENT', available: true },
  },
  sources: [
    { provider: 'NSE', instrumentId: 'NIFTY 50', dataClass: 'LIVE' },
    { provider: 'NSE', instrumentId: 'INDIA VIX', dataClass: 'LIVE' },
    { provider: 'NSE', instrumentId: 'NIFTY 50', dataClass: 'DAILY' },
  ],
};

test.describe('Market Today Card Visual & Responsive Review', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER PAGEERROR:', err.message));

    // ── 0. Set onboarding complete in localStorage so the first-time modal does not block clicks ──
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('wg_onboarded', 'true');
      } catch {
        // ignore
      }
    });

    // ── 0b. Catch-all fallback registered FIRST so specific routes registered AFTERWARDS take priority (Playwright LIFO) ──
    await page.route('**/api/**', async route => {
      console.log(`[CATCH-ALL API] ${route.request().method()} ${route.request().url()}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    // ── 1. Auth session: GET /api/auth/session ──
    await page.route('**/api/auth/session', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'usr_test_1', name: 'Priya Sharma', email: 'priya@example.com' },
          csrfToken: 'test-csrf-token-12345',
        }),
      });
    });

    // ── 2. Current profile: GET /api/profile/current ──
    await page.route('**/api/profile/current', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profileId: '64b000000000000000000001',
          age: 28,
          monthly_take_home: 100000,
          monthly_savings: 30000,
          investment_goals: ['Wealth Growth'],
          investment_horizon_years: 10,
          liquid_savings: 500000,
          emi_burden_pct: 0,
          financial_dependents: 0,
          emergency_fund_months: 6,
          risk_tolerance: 'Moderate',
          version: 1,
        }),
      });
    });

    // ── 3. Recommendations: POST /api/recommend ──
    // Must satisfy assertBackendRecommendationInstrument & assertKnownBackendInstrumentTypes:
    // id: 'ppf', type: 'PPF', assetClass, effectiveYield === nominalReturn,
    // returnBasis: 'PRE_TAX_NOMINAL', postTaxReturn: null, expenseRatio: 0
    await page.route('**/api/recommend', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          recommendationId: 'rec_test_001',
          instruments: [
            {
              id: 'ppf',
              name: 'Public Provident Fund (PPF)',
              type: 'PPF',
              assetClass: 'Sovereign',
              riskLevel: 'Low',
              allocationWeight: 1.0,
              allocation_pct: 100,
              nominalReturn: 7.1,
              effectiveYield: 7.1,
              riskScore: 1,
              lockIn: 15,
              expenseRatio: 0,
              score: 85,
              tags: ['Government', 'Sovereign'],
              returnBasis: 'PRE_TAX_NOMINAL',
              postTaxReturn: null,
              scoreFactors: { goalFit: 90, liquidity: 30 },
            },
          ],
          dashboard_projection: {
            instrument_monthly_allocations: { ppf: 30000 },
          },
          explanation: 'Balanced beginner growth portfolio.',
          advisory_text: 'Your portfolio is well-suited for your profile.',
          advisory_explanation: { status: 'READY' },
        }),
      });
    });

    // ── 3b. Deferred advisory endpoint ──
    await page.route('**/api/recommend/**/advisory', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          advisory_text: 'Your portfolio is well-suited for your profile.',
          advisory_explanation: { status: 'READY' },
        }),
      });
    });

    // ── 4. Market context: GET /api/regime/current ──
    // WhereToInvestTab calls api.getCurrentMarketContext → request('GET', '/regime/current')
    await page.route('**/api/regime/current', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MARKET_CONTEXT_MOCK),
      });
    });

    // ── 4b. Market adjustment preview: POST /api/regime/adjust ──
    await page.route('**/api/regime/adjust', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          context: 'CAUTIOUS',
          adjustments: [],
        }),
      });
    });

    // ── 5. WTI product ranking: POST /api/instruments/rank-wti ──
    // WhereToInvestTab calls api.rankInvestmentCandidates → request('POST', '/instruments/rank-wti')
    await page.route('**/api/instruments/rank-wti', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          products: [
            {
              id: 'mf:amfi:120503',
              name: 'Nippon India Large Cap Fund - Direct Plan - Growth',
              provider: 'Nippon India Mutual Fund',
              source: { provider: 'AMFI', instrumentId: '120503' },
              nav: { value: 89.42 },
              historicalReturn: { valuePct: 16.8 },
              beginnerSuitability: {
                whyThisFitsYou: 'Fits your 10-year horizon for equity growth.',
                riskTier: 'Moderate Risk',
                accessToMoney: 'Exit load 1% within 7 days, nil after',
                verifiedFactLabel: 'Historical 1Y return',
                verifiedFactValue: '16.80% historical',
                sourceProvider: 'AMFI',
              },
            },
          ],
          ranking: { status: 'EVIDENCE_RANKED', hasUniqueLeader: true },
          comparisonUniverse: { disclosure: 'Comparison of verified AMFI Direct Growth products.' },
        }),
      });
    });
  });

  test('visual appearance, compactness, and expand/collapse at desktop 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/profile');

    // Dismiss onboarding modal if present
    const showPlanBtn = page.locator('button:has-text("Show me my plan")');
    if (await showPlanBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await showPlanBtn.click();
    }

    // Wait for recommendation card to render, then click Learn More to open Deep Dive
    const learnMoreBtn = page.locator('button:has-text("Deep Dive"), button:has-text("Learn More")').first();
    await expect(learnMoreBtn).toBeVisible({ timeout: 20000 });
    await learnMoreBtn.scrollIntoViewIfNeeded();
    await learnMoreBtn.click({ force: true });

    // In modal, click "Where to Invest" tab
    const wtiTab = page.locator('.ddm-tab-btn', { hasText: /Where to Invest/i });
    await expect(wtiTab).toBeVisible({ timeout: 10000 });
    await wtiTab.click({ force: true });

    // Verify "Market today" card renders
    const marketCard = page.locator('.wti-beginner-market-card');
    await expect(marketCard).toBeVisible({ timeout: 10000 });

    // Verify CAUTIOUS badge
    await expect(marketCard.locator('.wti-beginner-market-badge')).toHaveText('CAUTIOUS');

    // Verify Beginner summary text
    await expect(marketCard.locator('.wti-beginner-market-headline')).toHaveText('Markets have been weaker recently.');
    await expect(marketCard.locator('.wti-beginner-meaning')).toContainText('What this means for you:');

    // Verify Action buttons
    await expect(marketCard.locator('.wti-preview-plan-btn')).toContainText('See how this affects my plan');
    const techToggle = marketCard.locator('.wti-tech-toggle-btn');
    await expect(techToggle).toBeVisible();
    await expect(techToggle).toHaveAttribute('aria-expanded', 'false');

    // Verify collapsed card height (must be compact ~120-230px)
    const collapsedBox = await marketCard.boundingBox();
    expect(collapsedBox).not.toBeNull();
    console.log(`[DESKTOP 1440px] Collapsed card height: ${collapsedBox?.height}px`);
    expect(collapsedBox!.height).toBeGreaterThanOrEqual(120);
    expect(collapsedBox!.height).toBeLessThanOrEqual(230);

    // Capture screenshot of default collapsed card
    await page.screenshot({
      path: `${ARTIFACT_DIR}/market_today_desktop_collapsed.png`,
      fullPage: false,
    });

    // Click "Technical details" to expand
    await techToggle.click();
    await expect(techToggle).toHaveAttribute('aria-expanded', 'true');
    const techPanel = page.locator('[data-testid="market-context-panel"]');
    await expect(techPanel).toBeVisible();

    // Verify grouped technical metrics
    await expect(page.locator('.wti-tech-group-title', { hasText: 'Market & Index' })).toBeVisible();
    await expect(page.locator('.wti-tech-group-title', { hasText: 'Trend & Moving Averages' })).toBeVisible();
    await expect(page.locator('.wti-tech-group-title', { hasText: 'Volatility' })).toBeVisible();
    await expect(page.locator('.wti-tech-group-title', { hasText: 'Evidence & Policy Provenance' })).toBeVisible();

    // Verify humanized labels
    await expect(page.locator('.wti-tech-metric-label', { hasText: 'NIFTY 50' })).toBeVisible();
    await expect(page.locator('.wti-tech-metric-label', { hasText: 'Previous close' })).toBeVisible();
    await expect(page.locator('.wti-tech-metric-label', { hasText: 'India VIX' })).toBeVisible();
    await expect(page.locator('.wti-tech-metric-label', { hasText: '50-day moving average' })).toBeVisible();
    await expect(page.locator('.wti-tech-metric-label', { hasText: '200-day moving average' })).toBeVisible();
    await expect(page.locator('.wti-tech-metric-label', { hasText: 'Drawdown from recent high' })).toBeVisible();

    // Capture screenshot of expanded card
    await page.screenshot({
      path: `${ARTIFACT_DIR}/market_today_desktop_expanded.png`,
      fullPage: false,
    });

    // Collapse again
    await techToggle.click();
    await expect(techToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('responsive behavior at tablet (768px) and mobile (390px)', async ({ page }) => {
    // 768px Tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/profile');

    // Dismiss onboarding modal if present
    const showPlanBtn = page.locator('button:has-text("Show me my plan")');
    if (await showPlanBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await showPlanBtn.click();
    }

    const learnMoreBtn = page.locator('button:has-text("Deep Dive"), button:has-text("Learn More")').first();
    await expect(learnMoreBtn).toBeVisible({ timeout: 20000 });
    await learnMoreBtn.scrollIntoViewIfNeeded();
    await learnMoreBtn.click({ force: true });

    const wtiTab = page.locator('.ddm-tab-btn', { hasText: /Where to Invest/i });
    await expect(wtiTab).toBeVisible({ timeout: 10000 });
    await wtiTab.click({ force: true });

    const marketCard = page.locator('.wti-beginner-market-card');
    await expect(marketCard).toBeVisible({ timeout: 10000 });

    const tabletBox = await marketCard.boundingBox();
    console.log(`[TABLET 768px] Collapsed card height: ${tabletBox?.height}px`);
    expect(tabletBox!.height).toBeLessThanOrEqual(260);

    await page.screenshot({
      path: `${ARTIFACT_DIR}/market_today_tablet_768px.png`,
      fullPage: false,
    });

    // 390px Mobile
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBox = await marketCard.boundingBox();
    console.log(`[MOBILE 390px] Collapsed card height: ${mobileBox?.height}px`);
    expect(mobileBox!.height).toBeLessThanOrEqual(300);

    await page.screenshot({
      path: `${ARTIFACT_DIR}/market_today_mobile_390px.png`,
      fullPage: false,
    });
  });
});
