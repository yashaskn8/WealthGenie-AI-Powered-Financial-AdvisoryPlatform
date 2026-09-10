/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PostTaxAnalysis from '../PostTaxAnalysis';
import * as apiModule from '../services/api';

vi.mock('../services/api', () => ({
  computePostTaxReturnBatch: vi.fn(),
  getTaxPolicyMetadata: vi.fn(async () => ({
    currentFiscalYear: 'FY2026-27',
    currentFiscalYearVerified: true,
    verifiedFiscalYears: ['FY2025-26', 'FY2026-27'],
  })),
}));

describe('PostTaxAnalysis separate tax what-if', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not infer gross income and submits every explicit tax input', async () => {
    apiModule.computePostTaxReturnBatch.mockResolvedValue({
      calculation_classification: 'SEPARATE_TAX_WHAT_IF',
      assumptions: { inflationRate: 0.06 },
      results: [{
        postTaxReturn: 0.07,
        taxType: 'Slab Rate (0%)',
        effectiveTaxPercent: 0,
        postTaxGain: 38218,
        taxDragWealth: 0,
        taxDragCAGR: 0,
        totalInvested: 360000,
        nominalReturnPercent: 7,
        postTaxReturnPercent: 7,
        realReturnPercent: 0.9434,
      }],
      summary: {
        totalTaxDrag: 0,
        keptPerThousand: 1000,
        erodedPerThousand: 0,
        retentionEfficiencyPercent: 100,
        maxTaxRate: 0,
      },
      insights: [{ title: 'No Estimated Tax Drag', body: 'No drag.', icon: 'shield', color: 'green' }],
    });
    render(<PostTaxAnalysis
      profile={{ age: 30, investment_horizon_years: 3 }}
      recommendations={[{
        id: 'fd', name: 'Fixed Deposit', type: 'FD', nominalReturn: 7, monthly_allocation: 10000,
      }]}
    />);
    expect(apiModule.computePostTaxReturnBatch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/Fiscal year/i).value).toBe('FY2026-27'));
    fireEvent.change(screen.getByLabelText(/Gross annual income before allowed deductions/i), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText(/Income source/i), { target: { value: 'salary' } });
    fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText(/Fiscal year/i), { target: { value: 'FY2026-27' } });
    fireEvent.change(screen.getByLabelText(/Inflation assumption/i), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /calculate explicit tax what-if/i }));
    await waitFor(() => expect(apiModule.computePostTaxReturnBatch).toHaveBeenCalledWith(
      [{ instrumentType: 'FD', nominalRate: 0.07, holdingYears: 3, monthlySIP: 10000 }],
      1000000, 'new', 30, 'salary', 0.06, 'FY2026-27',
    ));
    expect((await screen.findAllByText('7.0%')).length).toBeGreaterThan(0);
    expect(screen.getByText(/MODELLED_POST_TAX_PROJECTION/i)).toBeInTheDocument();
  });
});
