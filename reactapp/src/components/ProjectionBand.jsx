import React, { useState, useEffect } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const formatINR = (value) => {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))',
      border: '1px solid rgba(56, 189, 248, 0.4)',
      borderRadius: 14, padding: '14px 18px', color: '#e2e8f0', fontSize: '0.82rem',
      boxShadow: '0 12px 35px rgba(0,0,0,0.5), 0 0 15px rgba(56, 189, 248, 0.2)', minWidth: 210,
      backdropFilter: 'blur(16px)'
    }}>
      <div style={{ fontWeight: 800, marginBottom: 8, color: '#38bdf8', letterSpacing: '0.5px', textTransform: 'uppercase', fontSize: '0.72rem' }}>
        Simulation Year {d.year}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '6px 16px' }}>
        <span style={{ color: '#94a3b8' }}>90th %ile (Bull):</span><span style={{ fontWeight: 700, color: '#10b981' }}>{formatINR(d.p90)}</span>
        <span style={{ color: '#94a3b8' }}>75th %ile:</span><span style={{ fontWeight: 600, color: '#38bdf8' }}>{formatINR(d.p75)}</span>
        <span style={{ color: '#38bdf8', fontWeight: 800 }}>Median Scenario:</span><span style={{ fontWeight: 900, color: '#38bdf8' }}>{formatINR(d.p50)}</span>
        <span style={{ color: '#94a3b8' }}>25th %ile:</span><span style={{ fontWeight: 600, color: '#cbd5e1' }}>{formatINR(d.p25)}</span>
        <span style={{ color: '#94a3b8' }}>10th %ile (Bear):</span><span style={{ fontWeight: 600, color: '#f43f5e' }}>{formatINR(d.p10)}</span>
      </div>
    </div>
  );
};

const ProjectionBand = ({ chartData, targetAmount, goalProbability, instrumentName, simulationsRun }) => {
  const [visible, setVisible] = useState(false);
  const hasSimulationCount = Number.isInteger(simulationsRun) && simulationsRun > 0;

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  if (!chartData || chartData.length === 0) return null;

  return (
    <div style={{
      opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease',
      background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.9))',
      backdropFilter: 'blur(20px)',
      borderRadius: 24, padding: '24px 28px',
      border: '1px solid rgba(56, 189, 248, 0.25)',
      boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05), 0 15px 40px rgba(0,0,0,0.4)',
      position: 'relative', overflow: 'hidden'
    }}>
      {/* Glow line top border */}
      <div style={{ position: 'absolute', top: 0, left: '15%', width: '70%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.6), transparent)' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h4 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', margin: 0, letterSpacing: '-0.01em' }}>
            Monte Carlo Wealth Growth Simulation {instrumentName ? `— ${instrumentName}` : ''}
          </h4>
          <p style={{ fontSize: '0.73rem', color: '#64748b', margin: '4px 0 0 0', fontWeight: 500 }}>
            {hasSimulationCount ? `${simulationsRun.toLocaleString()} Stochastic Paths` : 'Server Monte Carlo result'} • Shaded bands denote 10th–90th simulation intervals
          </p>
        </div>
        {goalProbability !== null && goalProbability !== undefined && (
          <div style={{
            background: goalProbability >= 0.7 ? 'rgba(16, 185, 129, 0.14)' : goalProbability >= 0.4 ? 'rgba(245, 158, 11, 0.14)' : 'rgba(244, 63, 94, 0.14)',
            border: `1px solid ${goalProbability >= 0.7 ? 'rgba(16, 185, 129, 0.35)' : goalProbability >= 0.4 ? 'rgba(245, 158, 11, 0.35)' : 'rgba(244, 63, 94, 0.35)'}`,
            borderRadius: 14, padding: '8px 18px', textAlign: 'center',
            boxShadow: `0 0 15px ${goalProbability >= 0.7 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)'}`
          }}>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: goalProbability >= 0.7 ? '#10b981' : goalProbability >= 0.4 ? '#f59e0b' : '#f43f5e', lineHeight: 1 }}>
              {Math.round(goalProbability * 100)}%
            </div>
            <div style={{ fontSize: '0.62rem', color: '#94a3b8', marginTop: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Target Feasibility
            </div>
          </div>
        )}
      </div>

      {/* Chart Container */}
      <div style={{ width: '100%', height: 290 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="cyanBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="innerBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="year" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false}
              label={{ value: 'Years Horizon', position: 'insideBottomRight', offset: -5, fill: '#475569', fontSize: 10, fontWeight: 700 }}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false}
              tickFormatter={formatINR} width={75}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Outer band: p10 → p90 */}
            <Area type="monotone" dataKey="p90" stroke="none" fill="url(#cyanBand)" />
            <Area type="monotone" dataKey="p10" stroke="none" fill="transparent" />

            {/* Inner band: p25 → p75 */}
            <Area type="monotone" dataKey="p75" stroke="none" fill="url(#innerBand)" />
            <Area type="monotone" dataKey="p25" stroke="none" fill="transparent" />

            {/* Median line with cyan glow */}
            <Line type="monotone" dataKey="p50" stroke="#38bdf8" strokeWidth={3} dot={false} animationDuration={900} />

            {/* Target line */}
            {targetAmount && (
              <ReferenceLine y={targetAmount} stroke="#f43f5e" strokeDasharray="6 4" strokeWidth={2}
                label={{ value: `TARGET: ${formatINR(targetAmount)}`, fill: '#f43f5e', fontSize: 10, fontWeight: 800, position: 'insideTopRight' }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Cyber Legend */}
      <div style={{ display: 'flex', gap: 22, marginTop: 14, fontSize: '0.72rem', color: '#64748b', flexWrap: 'wrap', fontWeight: 600 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, height: 3, background: '#38bdf8', borderRadius: 2, boxShadow: '0 0 8px #38bdf8' }} /> Median Scenario (50th %ile)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 8, background: 'rgba(139, 92, 246, 0.4)', borderRadius: 2, border: '1px solid rgba(139, 92, 246, 0.6)' }} /> 25th–75th %ile Likely Band
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 8, background: 'rgba(56, 189, 248, 0.25)', borderRadius: 2, border: '1px solid rgba(56, 189, 248, 0.4)' }} /> 10th–90th %ile Full Range
        </span>
        {targetAmount && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 18, height: 0, borderTop: '2px dashed #f43f5e' }} /> Target Goal Level
          </span>
        )}
      </div>
    </div>
  );
};

export default ProjectionBand;
