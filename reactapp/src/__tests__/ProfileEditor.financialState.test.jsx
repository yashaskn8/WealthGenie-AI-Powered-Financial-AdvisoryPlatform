/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('notifies the dashboard with the committed server profile only after a successful update', async () => {
    let resolveUpdate;
    vi.spyOn(api, 'updateProfile').mockImplementation(() => new Promise(resolve => {
      resolveUpdate = resolve;
    }));
    const onProfileUpdate = vi.fn();
    const onProfileChangeStart = vi.fn();
    vi.stubGlobal('alert', vi.fn());

    render(
      <ProfileEditor
        userProfile={profile}
        onProfileUpdate={onProfileUpdate}
        onProfileChangeStart={onProfileChangeStart}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-edit'));
    fireEvent.change(screen.getByTestId('profile-input-monthly_savings'), { target: { value: '27000' } });
    fireEvent.click(screen.getByTestId('profile-save'));

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledOnce());
    expect(onProfileChangeStart).toHaveBeenCalledOnce();
    expect(onProfileUpdate).not.toHaveBeenCalled();

    const recommendation = { recommendationId: 'rec-current-v5', response_state: 'CURRENT', profile_version: 5 };
    await act(async () => resolveUpdate({
      profile: { ...profile, monthly_savings: 27000, version: 5 },
      recommendation,
    }));
    await waitFor(() => expect(onProfileUpdate).toHaveBeenCalledOnce());
    expect(onProfileUpdate).toHaveBeenCalledWith(expect.objectContaining({
      profileId: profile.profileId,
      version: 5,
      monthly_savings: 27000,
    }), { recommendation });
  });

  it('reuses the same idempotency key when the same profile update is retried after a lost response', async () => {
    vi.spyOn(api, 'updateProfile')
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({
        profile: { ...profile, version: 5, monthly_savings: 27000 },
        recommendation: { recommendationId: 'rec-current-v5', response_state: 'CURRENT', profile_version: 5 },
      });
    const onProfileChangeFailure = vi.fn();
    vi.stubGlobal('alert', vi.fn());

    render(
      <ProfileEditor
        userProfile={profile}
        onProfileUpdate={vi.fn()}
        onProfileChangeFailure={onProfileChangeFailure}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-edit'));
    fireEvent.change(screen.getByTestId('profile-input-monthly_savings'), { target: { value: '27000' } });
    fireEvent.click(screen.getByTestId('profile-save'));
    await waitFor(() => expect(onProfileChangeFailure).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByTestId('profile-save'));

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(2));
    const firstKey = api.updateProfile.mock.calls[0][2].headers['Idempotency-Key'];
    const secondKey = api.updateProfile.mock.calls[1][2].headers['Idempotency-Key'];
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondKey).toBe(firstKey);
  });
});
