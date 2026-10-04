import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaxScreen from '../TaxScreen';
import api from '../../services/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TaxScreen request binding', () => {
  it('hides a verified tax result immediately when its income inputs change', async () => {
    let finishComparison;
    vi.spyOn(api, 'getTaxPolicyMetadata').mockResolvedValue({
      currentFiscalYearVerified: true,
      currentFiscalYear: 'FY2026-27',
      verifiedFiscalYears: ['FY2026-27'],
    });
    vi.spyOn(api, 'compareTax').mockImplementation(() => new Promise(resolve => {
      finishComparison = resolve;
    }));

    render(<TaxScreen profile={{ age: 35 }} recommendations={[]} />);
    await waitFor(() => expect(screen.getByLabelText('Fiscal year for tax calculation')).toHaveValue('FY2026-27'));
    fireEvent.change(screen.getByLabelText('Income source for tax calculation'), { target: { value: 'salary' } });
    await waitFor(() => expect(api.compareTax).toHaveBeenCalledTimes(1));

    finishComparison({
      fiscal_year: 'FY2026-27',
      verified: true,
      saving: 0,
      recommended_regime: 'new',
      new_regime: { tax: 0, taxable_income: 0, effective_rate: 0, standard_deduction: 0, slab_breakdown: [], marginal_relief_applied: false },
      old_regime: { tax: 0, taxable_income: 0, effective_rate: 0, standard_deduction: 0, slab_breakdown: [], marginal_relief_applied: false },
      deduction_limits: {},
      remaining_deductions: {},
    });

    await waitFor(() => expect(screen.getByText('FY2026-27 · Verified Server Rules')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Yearly gross income before tax'), { target: { value: '50000' } });

    expect(screen.queryByText('FY2026-27 · Verified Server Rules')).not.toBeInTheDocument();
    expect(screen.getByText('The authoritative tax service is calculating your comparison.')).toBeInTheDocument();
  });
});
