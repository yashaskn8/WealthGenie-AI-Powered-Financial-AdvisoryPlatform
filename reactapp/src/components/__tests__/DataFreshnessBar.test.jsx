/**
 * @vitest-environment jsdom
 */
/* global global */
import React from 'react';
import { render, screen } from '@testing-library/react';
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

  it('shows source freshness without exposing a customer-triggered provider refresh', async () => {
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
          nse: {
            provider: 'NSE', status: 'AVAILABLE', fetchedAt: '2026-09-08T10:00:30.000Z',
            freshness: { FRESH: 2, STALE: 0, UNKNOWN: 0 },
          },
        },
      }),
    });

    render(<DataFreshnessBar instruments={['Equity_MF']} />);
    expect(await screen.findByText('AMFI: PARTIAL')).toBeTruthy();
    expect(await screen.findByText('NSE: AVAILABLE')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh Sources' })).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
