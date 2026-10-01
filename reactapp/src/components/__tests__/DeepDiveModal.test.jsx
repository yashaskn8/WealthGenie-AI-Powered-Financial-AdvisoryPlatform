import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DeepDiveModal from '../DeepDiveModal';

vi.mock('../deepdive', () => ({
  OverviewTab: () => <div>Overview</div>, WhereToInvestTab: () => null,
  CalculatorTab: () => null, TaxTab: () => null, HistoryTab: () => null,
  WhyInvestTab: () => null, StressTestTab: () => null,
}));
vi.mock('../../services/api', () => ({ default: { compareInvestmentProjection: vi.fn(async () => ({ normalizedChart: [] })) } }));
afterEach(cleanup);

it('can close and reopen a real instrument without interpreting an absent selection as missing return facts', () => {
  const instrument = { id: 'ppf', name: 'Server PPF', nominalReturn: 7.1, riskLabel: 'Very Low', lockIn: 15, category: 'Sovereign' };
  const props = { onClose: vi.fn(), horizon: 15, allRecommendations: [instrument] };
  const view = render(<DeepDiveModal {...props} isOpen investment={instrument} />);
  expect(screen.getByRole('dialog', { name: 'Server PPF' })).toBeVisible();
  expect(() => view.rerender(<DeepDiveModal {...props} isOpen={false} investment={null} />)).not.toThrow();
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<DeepDiveModal {...props} isOpen investment={instrument} />);
  expect(screen.getByRole('dialog', { name: 'Server PPF' })).toBeVisible();
});
