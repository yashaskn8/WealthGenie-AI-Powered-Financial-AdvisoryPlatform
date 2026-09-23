/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProfileEditor from '../ProfileEditor.jsx';
import * as api from '../services/api.js';

const profile = {
  profileId: '64b000000000000000000001',
  version: 4,
  age: 34,
  monthly_take_home: 90000,
  monthly_savings: 25000,
  risk_tolerance: 'Moderate',
  investment_goals: ['Wealth Growth'],
  investment_horizon_years: 12,
  sold_property_proceeds: 0,
  has_lump_sum: false,
  lump_sum_amount: 0,
};

describe('ProfileEditor financial-state invalidation', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('invalidates current recommendation before save and invokes recovery on failure', async () => {
    const events = [];
    vi.spyOn(api, 'updateProfile').mockImplementation(async () => {
      events.push('request');
      throw new Error('network interruption');
    });
    const onProfileChangeStart = vi.fn(() => events.push('invalidate'));
    const onProfileChangeFailure = vi.fn(async () => events.push('recover'));
    vi.stubGlobal('alert', vi.fn());

    render(
      <ProfileEditor
        userProfile={profile}
        onProfileUpdate={vi.fn()}
        onProfileChangeStart={onProfileChangeStart}
        onProfileChangeFailure={onProfileChangeFailure}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-edit'));
    fireEvent.click(screen.getByTestId('profile-save'));

    await waitFor(() => expect(onProfileChangeFailure).toHaveBeenCalledOnce());
    expect(events).toEqual(['invalidate', 'request', 'recover']);
  });
});
