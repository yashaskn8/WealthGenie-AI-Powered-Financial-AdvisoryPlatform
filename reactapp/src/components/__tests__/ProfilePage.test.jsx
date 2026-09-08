import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from '../ProfilePage.jsx';
import * as api from '../../services/api.js';

function ProfileProbe({ userProfile, onProfileUpdate }) {
  return (
    <div>
      <span data-testid="profile-version">{userProfile.version}</span>
      <button
        type="button"
        onClick={() => onProfileUpdate({ ...userProfile, version: userProfile.version + 1 })}
      >
        Apply update
      </button>
    </div>
  );
}

describe('ProfilePage backend version contract', () => {
  beforeEach(() => {
    localStorage.clear();
    api.setUserInfo({ id: 'user-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the complete create form inside an accessible scrolling region', async () => {
    vi.spyOn(api, 'getCurrentProfile').mockRejectedValue({ status: 404 });

    render(
      <ProfilePage>
        <ProfileProbe />
      </ProfilePage>
    );

    const scrollRegion = await screen.findByRole('region', { name: 'Financial profile form' });
    const formCard = screen.getByTestId('profile-scroll-region');
    const saveButton = screen.getByTestId('profile-save');

    expect(scrollRegion.tabIndex).toBe(0);
    expect(scrollRegion.className).toContain('profile-content');
    expect(formCard.className).toContain('profile-form-card');
    expect(formCard.style.overflowY).toBe('auto');
    expect(formCard.contains(saveButton)).toBe(true);
  });

  it('restores the latest backend version in memory without browser persistence', async () => {
    vi.spyOn(api, 'getCurrentProfile').mockResolvedValue({
      profileId: '64b000000000000000000001',
      version: 2,
      age: 32,
      monthly_take_home: 65000,
      monthly_savings: 12000,
      risk_tolerance: 'Moderate',
      sold_property_proceeds: 0,
      has_lump_sum: false,
      lump_sum_amount: 0,
      liquid_savings: 100000,
      emi_burden_pct: 5,
      financial_dependents: 0,
      emergency_fund_months: 6,
      investment_goals: ['Wealth Growth'],
      investment_horizon_years: 10,
    });

    render(
      <ProfilePage>
        <ProfileProbe />
      </ProfilePage>
    );

    expect((await screen.findByTestId('profile-version')).textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Apply update' }));
    expect(screen.getByTestId('profile-version').textContent).toBe('3');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
