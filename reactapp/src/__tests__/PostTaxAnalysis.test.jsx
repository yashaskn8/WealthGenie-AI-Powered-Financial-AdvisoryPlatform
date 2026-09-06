/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PostTaxAnalysis from '../PostTaxAnalysis';
import * as apiModule from '../services/api';

vi.mock('../services/api', () => ({ computePostTaxReturnBatch: vi.fn() }));

describe('PostTaxAnalysis separate tax what-if', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not infer gross income and submits every explicit tax input', async () => {
    apiModule.computePostTaxReturnBatch.mockResolvedValue({ results: [{ postTaxReturn: 0.07 }] });
    render(<PostTaxAnalysis
      profile={{ age: 30, investment_horizon_years: 3 }}
      recommendations={[{
        id: 'fd', name: 'Fixed Deposit', type: 'FD', nominalReturn: 7, monthly_allocation: 10000,
      }]}
    />);
    expect(apiModule.computePostTaxReturnBatch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Gross annual taxable income/i), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText(/Income source/i), { target: { value: 'salary' } });
    fireEvent.change(screen.getByLabelText(/Tax regime/i), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: /calculate explicit tax what-if/i }));
    await waitFor(() => expect(apiModule.computePostTaxReturnBatch).toHaveBeenCalledWith(
      [{ instrumentType: 'FD', nominalRate: 0.07, holdingYears: 3, monthlySIP: 10000 }],
      1000000, 'new', 30, 'salary',
    ));
    expect(await screen.findByText(/Estimated post-tax: 7.00%/i)).toBeVisible();
    expect(screen.getByText(/SEPARATE_TAX_WHAT_IF/i)).toBeVisible();
  });
});
