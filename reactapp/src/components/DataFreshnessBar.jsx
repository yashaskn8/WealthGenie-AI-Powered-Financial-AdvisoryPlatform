import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { getMarketRates } from '../services/api';

/**
 * DataFreshnessBar — displays the status of official external data sources.
 * Simulation assumptions are intentionally not represented as live facts.
 */
const DataFreshnessBar = () => {
  const [dataSources, setDataSources] = useState(null);
  const marketRatesRequest = useRef(null);

  useEffect(() => {
    let active = true;
    // React StrictMode replays mount effects in development. Reuse the same
    // in-flight read so the replay does not issue a duplicate API request.
    if (!marketRatesRequest.current) marketRatesRequest.current = getMarketRates();

    marketRatesRequest.current
      .then(data => {
        if (active) setDataSources(data);
      })
      .catch(() => {
        // Graceful degradation — hide bar if market API is unavailable
      });
    return () => { active = false; };
  }, []);

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

    </div>
  );
};

export default DataFreshnessBar;
