/**
 * @vitest-environment jsdom
 */
/* global global */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DataFreshnessBar from '../DataFreshnessBar';

describe('DataFreshnessBar Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when dataSources is null', () => {
    const { container } = render(<DataFreshnessBar instruments={['Equity_MF']} />);
    expect(container.firstChild).toBeNull();
  });

  it('handles refresh button click safely', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        sources: {
          amfi: {
            provider: 'AMFI', status: 'PARTIAL', fetchedAt: '2026-09-08T07:14:56.690Z',
            freshness: { FRESH: 14106, STALE: 0, UNKNOWN: 241 },
          },
          upstox: {
            provider: 'UPSTOX', status: 'PROVIDER_NOT_CONFIGURED', fetchedAt: null,
            freshness: { FRESH: 0, STALE: 0, UNKNOWN: 0 },
            error: { code: 'PROVIDER_NOT_CONFIGURED' },
          },
        },
      }),
    });

    render(<DataFreshnessBar instruments={['Equity_MF']} />);
    expect(await screen.findByText('AMFI: PARTIAL')).toBeTruthy();
    expect(await screen.findByText('UPSTOX: PROVIDER NOT CONFIGURED')).toBeTruthy();
    const refresh = screen.getByRole('button', { name: 'Refresh Sources' });
    fireEvent.click(refresh);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
