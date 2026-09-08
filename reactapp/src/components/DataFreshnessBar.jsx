import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { getMarketRates, refreshMarketRates } from '../services/api';

/**
 * DataFreshnessBar — displays the status of official external data sources.
 * Simulation assumptions are intentionally not represented as live facts.
 */
const DataFreshnessBar = () => {
  const [dataSources, setDataSources] = useState(null);
  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSources = useCallback(async () => {
    try {
      const data = await getMarketRates();
      setDataSources(data);
    } catch {
      // Graceful degradation — hide bar if market API is unavailable
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleRefresh = async () => {
    if (refreshCooldown) return;
    setRefreshing(true);
    try {
      await refreshMarketRates();
      // Start cooldown (60s)
      setRefreshCooldown(true);
      setTimeout(() => setRefreshCooldown(false), 60000);
      // Refetch after a brief delay
      setTimeout(() => fetchSources(), 3500);
    } catch {
      // Ignore — refresh is best-effort
    } finally {
      setRefreshing(false);
    }
  };

  if (!dataSources?.sources) return null;

  const sources = Object.values(dataSources.sources).filter(Boolean);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '8px 14px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      fontSize: 12, color: '#94a3b8',
      marginBottom: 12,
    }}>
      <Clock size={13} style={{ opacity: 0.6 }} />
      <span style={{ marginRight: 4, fontWeight: 500, color: '#cbd5e1' }}>Data Sources:</span>

      {sources.map((source) => {
        const isAvailable = source.status === 'AVAILABLE';
        const isPartial = source.status === 'PARTIAL';
        const color = isAvailable ? '#10b981' : isPartial ? '#f59e0b' : '#ef4444';
        const freshness = source.freshness || {};
        const tooltip = [
          `${source.provider}: ${source.status}`,
          source.fetchedAt ? `Fetched ${source.fetchedAt}` : 'Not fetched',
          `Fresh ${freshness.FRESH || 0}; stale ${freshness.STALE || 0}; unknown ${freshness.UNKNOWN || 0}`,
          source.error?.code || null,
        ].filter(Boolean).join(' — ');

        return (
          <span
            key={source.provider}
            title={tooltip}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 6,
              background: isAvailable ? 'rgba(16,185,129,0.1)' : isPartial ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${isAvailable ? 'rgba(16,185,129,0.2)' : isPartial ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}`,
              cursor: 'help',
            }}
          >
            {isAvailable
              ? <CheckCircle size={10} color={color} />
              : <AlertTriangle size={10} color={color} />
            }
            <span style={{ color }}>{source.provider}: {source.status.replaceAll('_', ' ')}</span>
          </span>
        );
      })}

      <button
        onClick={handleRefresh}
        disabled={refreshCooldown || refreshing}
        title={refreshCooldown ? 'Cooldown: wait 60s between refreshes' : 'Refresh official backend market-data sources'}
        style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 6,
          background: refreshCooldown ? 'rgba(255,255,255,0.03)' : 'rgba(6,182,212,0.1)',
          border: `1px solid ${refreshCooldown ? 'rgba(255,255,255,0.06)' : 'rgba(6,182,212,0.2)'}`,
          color: refreshCooldown ? '#475569' : '#06b6d4',
          cursor: refreshCooldown ? 'not-allowed' : 'pointer',
          fontSize: 11, fontWeight: 500,
          transition: 'all 0.2s ease',
        }}
      >
        <RefreshCw size={11} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
        {refreshCooldown ? 'Cooling down…' : 'Refresh Sources'}
      </button>
    </div>
  );
};

export default DataFreshnessBar;
