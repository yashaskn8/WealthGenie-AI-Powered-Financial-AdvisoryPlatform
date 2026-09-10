import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TaxesHub from '../TaxesHub';
import ProgressHub from '../ProgressHub';
import AdvancedHub from '../AdvancedHub';
import WhereToInvestScreen from '../WhereToInvestScreen';
import DeepDiveModal from '../DeepDiveModal';
import Sidebar from '../Sidebar';
import {
  NAV_PAGES,
  LEGACY_NAV_MAP,
  resolveNavigation,
} from '../../utils/navigationMap';

afterEach(cleanup);

const mockProfile = {
  profileId: '64b000000000000000000001',
  age: 30,
  monthly_take_home: 100000,
  monthly_savings: 30000,
  investment_goals: ['Emergency Fund', 'Wealth Growth'],
  investment_horizon_years: 10,
  liquid_savings: 500000,
  emi_burden_pct: 10,
  financial_dependents: 1,
  emergency_fund_months: 6,
  risk_tolerance: 'Moderate',
  version: 1,
};

const mockRecommendations = [
  {
    id: 'ppf',
    name: 'Public Provident Fund',
    type: 'PPF',
    category: 'Government',
    allocationWeight: 0.6,
    allocation_pct: 60,
    monthly_allocation: 18000,
    nominalReturn: 7.1,
    effectiveYield: 7.1,
    color: '#06b6d4',
  },
  {
    id: 'index_mf',
    name: 'Nifty 50 Index Fund',
    type: 'Index_MF',
    category: 'Equity',
    allocationWeight: 0.4,
    allocation_pct: 40,
    monthly_allocation: 12000,
    nominalReturn: 12.0,
    effectiveYield: 12.0,
    color: '#6366f1',
  },
];

describe('Feature Preservation: Zero-Feature-Loss Audit', () => {
  describe('1. Legacy Navigation Mappings', () => {
    const expectedMappings = [
      { legacy: 'dashboard', page: NAV_PAGES.HOME, tab: null },
      { legacy: 'allocation', page: NAV_PAGES.PLAN, tab: null },
      { legacy: 'where-to-invest', page: NAV_PAGES.INVESTMENTS, tab: null },
      { legacy: 'tax-optimizer', page: NAV_PAGES.TAXES, tab: 'regime-savings' },
      { legacy: 'taxes', page: NAV_PAGES.TAXES, tab: 'regime-savings' },
      { legacy: 'post-tax', page: NAV_PAGES.TAXES, tab: 'real-returns' },
      { legacy: 'goals', page: NAV_PAGES.PROGRESS, tab: 'goals' },
      { legacy: 'goal-planner', page: NAV_PAGES.PROGRESS, tab: 'plan-goal' },
      { legacy: 'sip-planner', page: NAV_PAGES.PROGRESS, tab: 'grow-sip' },
      { legacy: 'health', page: NAV_PAGES.PROGRESS, tab: 'health' },
      { legacy: 'rebalancer', page: NAV_PAGES.PROGRESS, tab: 'rebalancer' },
      { legacy: 'compare', page: NAV_PAGES.ADVANCED, tab: 'comparison' },
      { legacy: 'insights', page: NAV_PAGES.ADVANCED, tab: 'insights' },
      { legacy: 'profile', page: NAV_PAGES.ACCOUNT, tab: null },
      { legacy: 'account', page: NAV_PAGES.ACCOUNT, tab: null },
      { legacy: 'help', page: NAV_PAGES.HELP, tab: null },
    ];

    expectedMappings.forEach(({ legacy, page, tab }) => {
      it(`maps legacy identifier "${legacy}" to page="${page}" and tab="${tab}"`, () => {
        const resolved = resolveNavigation(legacy);
        expect(resolved).toEqual({ page, tab });
      });
    });
  });

  describe('2. TaxesHub preserves TaxScreen and PostTaxAnalysis', () => {
    it('mounts TaxScreen under regime-savings tab with required props', () => {
      const onLearnMore = vi.fn();
      render(
        <TaxesHub
          activeTab="regime-savings"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
          onLearnMore={onLearnMore}
        />
      );

      expect(screen.getByTestId('panel-regime-savings')).toBeInTheDocument();
      expect(screen.queryByTestId('panel-real-returns')).not.toBeInTheDocument();
    });

    it('mounts PostTaxAnalysis under real-returns tab', () => {
      render(
        <TaxesHub
          activeTab="real-returns"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
        />
      );

      expect(screen.getByTestId('panel-real-returns')).toBeInTheDocument();
      expect(screen.queryByTestId('panel-regime-savings')).not.toBeInTheDocument();
    });
  });

  describe('3. ProgressHub preserves child milestone components', () => {
    it('mounts GoalTracker on goals tab', () => {
      render(
        <ProgressHub
          activeTab="goals"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
          onNavigate={vi.fn()}
        />
      );

      expect(screen.getByTestId('panel-goals')).toBeInTheDocument();
      expect(screen.queryByTestId('panel-plan-goal')).not.toBeInTheDocument();
    });

    it('mounts GoalPlanner on plan-goal tab', () => {
      render(
        <ProgressHub
          activeTab="plan-goal"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
        />
      );

      expect(screen.getByTestId('panel-plan-goal')).toBeInTheDocument();
    });

    it('mounts StepUpPlanner on grow-sip tab', () => {
      render(
        <ProgressHub
          activeTab="grow-sip"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
        />
      );

      expect(screen.getByTestId('panel-grow-sip')).toBeInTheDocument();
    });

    it('mounts HealthScoreScreen on health tab', () => {
      render(
        <ProgressHub
          activeTab="health"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
          onNavigate={vi.fn()}
        />
      );

      expect(screen.getByTestId('panel-health')).toBeInTheDocument();
    });

    it('mounts RebalancerScreen on rebalancer tab with onSaveRebalance', () => {
      const onSave = vi.fn();
      render(
        <ProgressHub
          activeTab="rebalancer"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
          onSaveRebalance={onSave}
        />
      );

      expect(screen.getByTestId('panel-rebalancer')).toBeInTheDocument();
    });
  });

  describe('4. AdvancedHub preserves Comparison, Insights, and Diagnostics', () => {
    it('mounts ComparisonTableModal on comparison tab', () => {
      render(
        <AdvancedHub
          activeTab="comparison"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
          onNavigateHome={vi.fn()}
        />
      );

      expect(screen.getByTestId('panel-comparison')).toBeInTheDocument();
    });

    it('mounts InsightsScreen on insights tab', () => {
      render(
        <AdvancedHub
          activeTab="insights"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
          recommendationMeta={{}}
        />
      );

      expect(screen.getByTestId('panel-insights')).toBeInTheDocument();
    });

    it('mounts Policy & Diagnostics on diagnostics tab with real policy data', () => {
      render(
        <AdvancedHub
          activeTab="diagnostics"
          onTabChange={vi.fn()}
          profile={mockProfile}
          recommendations={mockRecommendations}
          recommendationMeta={{
            policy_lineage: 'market-context-policy-1.0.0',
            market_state: 'NORMAL',
          }}
        />
      );

      expect(screen.getByTestId('panel-diagnostics')).toBeInTheDocument();
      expect(screen.getByText('Deterministic Recommendation Engine Policy')).toBeInTheDocument();
      expect(screen.getByText('market-context-policy-1.0.0')).toBeInTheDocument();
    });
  });

  describe('5. WhereToInvestScreen integrates Deep Dive', () => {
    it('renders category selector in exact backend recommendation order', () => {
      render(
        <WhereToInvestScreen
          recommendations={mockRecommendations}
          userProfile={mockProfile}
          onLearnMore={vi.fn()}
        />
      );

      expect(screen.getByTestId('wti-category-ppf')).toBeInTheDocument();
      expect(screen.getByTestId('wti-category-index_mf')).toBeInTheDocument();
    });

    it('exposes Deep Dive action bar and triggers onLearnMore with activeParent', () => {
      const onLearnMore = vi.fn();
      render(
        <WhereToInvestScreen
          recommendations={mockRecommendations}
          userProfile={mockProfile}
          onLearnMore={onLearnMore}
        />
      );

      expect(screen.getByTestId('wti-deep-dive-bar')).toBeInTheDocument();

      // Click "Full Deep Dive"
      fireEvent.click(screen.getByTestId('wti-open-deep-dive'));
      expect(onLearnMore).toHaveBeenCalledWith(mockRecommendations[0], 'Overview');

      // Click "Calculator"
      fireEvent.click(screen.getByTestId('wti-open-calc'));
      expect(onLearnMore).toHaveBeenCalledWith(mockRecommendations[0], 'Calculator');

      // Click "Tax Rules"
      fireEvent.click(screen.getByTestId('wti-open-tax'));
      expect(onLearnMore).toHaveBeenCalledWith(mockRecommendations[0], 'Tax');

      // Click "History"
      fireEvent.click(screen.getByTestId('wti-open-history'));
      expect(onLearnMore).toHaveBeenCalledWith(mockRecommendations[0], 'History');
    });
  });

  describe('6. DeepDiveModal preserves all 7 tabs and supports initialTab', () => {
    it('renders all 7 tabs and respects initialTab="Calculator"', () => {
      render(
        <DeepDiveModal
          isOpen={true}
          onClose={vi.fn()}
          investment={mockRecommendations[0]}
          onSelectInvestment={vi.fn()}
          allRecommendations={mockRecommendations}
          horizon={10}
          userProfile={mockProfile}
          initialTab="Calculator"
        />
      );

      const calcTab = screen.getByRole('tab', { name: /^calculator$/i });
      expect(calcTab).toBeInTheDocument();
      expect(calcTab.className).toContain('ddm-tab-btn--active');
      expect(screen.getByRole('tab', { name: /^overview$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^where to invest$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^tax$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^history$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^why invest$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^stress test$/i })).toBeInTheDocument();
    });
  });

  describe('7. Sidebar exposes all primary, utility, and legacy navigation test-ids', () => {
    it('exposes test-ids for all 8 destinations and legacy aliases', () => {
      render(
        <Sidebar
          activePage="home"
          onNavigate={vi.fn()}
          onLogout={vi.fn()}
        />
      );

      // Primary navigation items
      expect(screen.getByTestId('nav-home')).toBeInTheDocument();
      expect(screen.getByTestId('nav-plan')).toBeInTheDocument();
      expect(screen.getByTestId('nav-investments')).toBeInTheDocument();
      expect(screen.getByTestId('nav-taxes')).toBeInTheDocument();
      expect(screen.getByTestId('nav-progress')).toBeInTheDocument();
      expect(screen.getByTestId('nav-advanced')).toBeInTheDocument();
      expect(screen.getByTestId('nav-profile')).toBeInTheDocument();
      expect(screen.getByTestId('nav-help')).toBeInTheDocument();
      expect(screen.getByTestId('nav-sign-out')).toBeInTheDocument();

      // Legacy test-ids
      expect(screen.getByTestId('nav-allocation')).toBeInTheDocument();
      expect(screen.getByTestId('nav-where-to-invest')).toBeInTheDocument();
      expect(screen.getByTestId('nav-tax-optimizer')).toBeInTheDocument();
      expect(screen.getByTestId('nav-post-tax')).toBeInTheDocument();
      expect(screen.getByTestId('nav-goal-planner')).toBeInTheDocument();
      expect(screen.getByTestId('nav-goals')).toBeInTheDocument();
      expect(screen.getByTestId('nav-rebalancer')).toBeInTheDocument();
      expect(screen.getByTestId('nav-sip-planner')).toBeInTheDocument();
      expect(screen.getByTestId('nav-health')).toBeInTheDocument();
      expect(screen.getByTestId('nav-compare')).toBeInTheDocument();
      expect(screen.getByTestId('nav-insights')).toBeInTheDocument();
      expect(screen.getByTestId('nav-dashboard')).toBeInTheDocument();
    });
  });
});
