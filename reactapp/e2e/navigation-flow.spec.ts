import { test, expect } from '@playwright/test';

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
    'PRICE_BELOW_MA50',
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
  ],
};

test.describe('Beginner-First Navigation Architecture E2E Journey', () => {
  test.beforeEach(async ({ page }) => {
    // 0. Disable onboarding modal so it does not intercept clicks
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('wg_onboarded', 'true');
      } catch {
        // ignore
      }
    });

    // 0b. Catch-all registered FIRST (LIFO matching in Playwright)
    await page.route('**/api/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    // 1. Auth session
    await page.route('**/api/auth/session', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'usr_test_nav', name: 'Aarav Patel', email: 'aarav@example.com' },
          csrfToken: 'test-csrf-token-nav',
        }),
      });
    });

    // 2. Profile
    await page.route('**/api/profile/current', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profileId: '64b000000000000000000002',
          age: 30,
          monthly_take_home: 90000,
          monthly_savings: 25000,
          investment_goals: ['Wealth Growth'],
          investment_horizon_years: 7,
          liquid_savings: 400000,
          emi_burden_pct: 0,
          financial_dependents: 1,
          emergency_fund_months: 6,
          risk_tolerance: 'Moderate',
          version: 1,
        }),
      });
    });

    // 3. Recommendations
    await page.route('**/api/recommend', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          recommendationId: 'rec_nav_001',
          instruments: [
            {
              id: 'ppf',
              name: 'Public Provident Fund (PPF)',
              type: 'PPF',
              assetClass: 'Sovereign',
              riskLevel: 'Low',
              allocationWeight: 0.6,
              allocation_pct: 60,
              nominalReturn: 7.1,
              effectiveYield: 7.1,
              riskScore: 1,
              lockIn: 15,
              expenseRatio: 0,
              score: 88,
              tags: ['Government', 'Sovereign'],
              returnBasis: 'PRE_TAX_NOMINAL',
              postTaxReturn: null,
              scoreFactors: { goalFit: 90, liquidity: 30 },
            },
            {
              id: 'index_mf',
              name: 'Nifty 50 Index Fund',
              type: 'Index_MF',
              assetClass: 'Equity',
              riskLevel: 'Medium',
              allocationWeight: 0.4,
              allocation_pct: 40,
              nominalReturn: 12.0,
              effectiveYield: 12.0,
              riskScore: 3,
              lockIn: 0,
              expenseRatio: 0.002,
              score: 82,
              tags: ['Large Cap', 'Equity'],
              returnBasis: 'PRE_TAX_NOMINAL',
              postTaxReturn: null,
              scoreFactors: { goalFit: 85, liquidity: 90 },
            },
          ],
          dashboard_projection: {
            instrument_monthly_allocations: { ppf: 15000, index_mf: 10000 },
          },
          explanation: 'Balanced beginner growth portfolio.',
          advisory_text: 'Your portfolio is ready.',
          advisory_explanation: { status: 'READY' },
        }),
      });
    });

    // 4. Market context
    await page.route('**/api/regime/current', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MARKET_CONTEXT_MOCK),
      });
    });

    // 5. WTI rank
    await page.route('**/api/instruments/rank-wti', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rankingId: 'wti_rank_nav',
          universe: 'QUALIFIED_GOVERNMENT_SAVINGS',
          products: [
            {
              id: 'ppf-main',
              name: 'Public Provident Fund',
              metric: '7.1% p.a. (Govt fixed)',
              risk: 'Very Low Risk',
              source: 'India Post / DEA',
              access: '15-year lock-in with partial withdrawals',
            },
          ],
        }),
      });
    });
  });

  test('full beginner journey: Home → Where to Invest → Taxes → Progress → Advanced with browser history', async ({ page }) => {
    // 1. Visit /profile
    await page.goto('http://127.0.0.1:5173/profile');
    await page.waitForLoadState('networkidle');

    // Verify URL normalized to page=home
    await expect(page).toHaveURL(/page=home/);

    // Verify Home first-viewport "Your Plan Today" card and CTA
    const heroCard = page.getByTestId('beginner-home-hero');
    await expect(heroCard).toBeVisible();
    await expect(heroCard).toContainText('YOUR PLAN TODAY');
    await expect(heroCard).toContainText('₹25,000/mo');

    const whereToInvestCTA = page.getByTestId('home-cta-where-to-invest');
    await expect(whereToInvestCTA).toBeVisible();

    // 2. Click "See Where to Invest" CTA
    await whereToInvestCTA.click();
    await expect(page).toHaveURL(/page=investments/);
    await expect(page.getByText('Top Verified Choices for You')).toBeVisible();

    // Verify category selector is in exact backend recommendation order
    const categorySelector = page.getByRole('tablist', { name: 'Recommended investment categories' });
    await expect(categorySelector).toBeVisible();
    await expect(page.getByTestId('wti-category-ppf')).toBeVisible();
    await expect(page.getByTestId('wti-category-index_mf')).toBeVisible();

    // 3. Navigate to Taxes via Sidebar
    await page.getByTestId('nav-taxes').click();
    await expect(page).toHaveURL(/page=taxes&tab=regime-savings/);
    await expect(page.getByTestId('panel-regime-savings')).toBeVisible();
    await expect(page.getByTestId('panel-real-returns')).not.toBeVisible();

    // Switch to Real Returns sub-tab
    await page.getByTestId('tab-real-returns').click();
    await expect(page).toHaveURL(/page=taxes&tab=real-returns/);
    await expect(page.getByTestId('panel-real-returns')).toBeVisible();
    await expect(page.getByTestId('panel-regime-savings')).not.toBeVisible();

    // 4. Navigate to Progress via Sidebar
    await page.getByTestId('nav-progress').click();
    await expect(page).toHaveURL(/page=progress&tab=goals/);
    await expect(page.getByTestId('panel-goals')).toBeVisible();

    // Switch to Keep on Track (Rebalancer) sub-tab
    await page.getByTestId('tab-rebalancer').click();
    await expect(page).toHaveURL(/page=progress&tab=rebalancer/);
    await expect(page.getByTestId('panel-rebalancer')).toBeVisible();
    await expect(page.getByTestId('panel-goals')).not.toBeVisible();

    // 5. Navigate to Advanced via Sidebar
    await page.getByTestId('nav-advanced').click();
    await expect(page).toHaveURL(/page=advanced&tab=comparison/);
    await expect(page.getByTestId('panel-comparison')).toBeVisible();

    // Switch to Policy & Diagnostics sub-tab
    await page.getByTestId('tab-diagnostics').click();
    await expect(page).toHaveURL(/page=advanced&tab=diagnostics/);
    await expect(page.getByTestId('panel-diagnostics')).toBeVisible();

    // 6. Test browser Back and Forward
    await page.goBack();
    await expect(page).toHaveURL(/page=advanced&tab=comparison/);

    await page.goBack();
    await expect(page).toHaveURL(/page=progress&tab=rebalancer/);
    await expect(page.getByTestId('panel-rebalancer')).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/page=advanced&tab=comparison/);
  });

  test('mobile viewport (390px): bottom tab bar, More drawer, focus trap, and Escape handling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:5173/profile?page=home');
    await page.waitForLoadState('networkidle');

    // Bottom tab bar has 5 primary items + More
    await expect(page.getByTestId('mobile-nav-home')).toBeVisible();
    await expect(page.getByTestId('mobile-nav-plan')).toBeVisible();
    await expect(page.getByTestId('mobile-nav-investments')).toBeVisible();
    await expect(page.getByTestId('mobile-nav-taxes')).toBeVisible();
    await expect(page.getByTestId('mobile-nav-progress')).toBeVisible();
    const moreBtn = page.getByTestId('mobile-nav-more');
    await expect(moreBtn).toBeVisible();

    // Open More sheet
    await moreBtn.click();
    const drawer = page.getByRole('dialog', { name: 'More navigation options' });
    await expect(drawer).toBeVisible();

    // Press Escape to close and verify focus returns to More button
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(moreBtn).toBeFocused();

    // Open More sheet again and navigate to Advanced
    await moreBtn.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Advanced/i }).click();

    await expect(page).toHaveURL(/page=advanced/);
    await expect(drawer).not.toBeVisible();
  });
});
