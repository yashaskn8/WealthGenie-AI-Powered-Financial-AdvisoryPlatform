import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FinancialProfileForm from '../FinancialProfileForm.jsx';

describe('FinancialProfileForm optional supplemental facts', () => {
  it('submits when only the required recommendation facts are entered', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<FinancialProfileForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('profile-input-monthly_take_home'), { target: { value: '65000' } });
    fireEvent.change(screen.getByTestId('profile-input-monthly_savings'), { target: { value: '35000' } });
    fireEvent.change(screen.getByTestId('profile-input-age'), { target: { value: '56' } });
    fireEvent.change(screen.getByTestId('profile-input-investment_horizon_years'), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Moderate' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wealth Growth' }));
    fireEvent.click(screen.getByTestId('profile-save'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      liquid_savings: '',
      emi_burden_pct: '',
      financial_dependents: '',
      emergency_fund_months: '',
    });
  });
});
