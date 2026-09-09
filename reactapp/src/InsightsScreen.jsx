import React from 'react';
import { motion } from 'framer-motion';
import { Lightbulb, TrendingUp, AlertTriangle, BarChart3, Newspaper, Sparkles, Shield, Zap } from 'lucide-react';
import './InsightsScreen.css';

const InsightsScreen = ({ profile, recommendations, recommendationMeta }) => {
  const horizon = Number(profile?.investment_horizon_years);
  const activeRecs = (recommendations || []).filter(recommendation => Number(recommendation.monthly_allocation) > 0);
  const assetAllocations = Object.entries(recommendationMeta?.asset_class_allocation || {});
  const reasonCodes = recommendationMeta?.suitability_reason_codes || [];
  const returnAssumption = Number(recommendationMeta?.portfolio_return_assumption);
  const excludedCount = (recommendationMeta?.excluded_due_to_eligibility || []).length;
  const representedGoals = new Set(activeRecs.flatMap(recommendation => recommendation.goalTags || [])).size;

  const cards = [
    {
      icon: TrendingUp,
      iconColor: '#f43f5e',
      accentGradient: 'linear-gradient(135deg, #f43f5e, #e11d48)',
      title: 'Suitability Alignment',
      tag: 'Profile Signal',
      tagColor: '#f43f5e',
      severity: 'medium',
      body: `The recommendation service classified your final suitability as ${recommendationMeta?.final_risk_tier || 'unavailable'} for the declared ${horizon}-year horizon.`,
      action: reasonCodes.length ? `Server reason codes: ${reasonCodes.join(', ')}.` : 'The server reported no suitability-capacity reduction reason.',
      delay: 0.1
    },
    {
      icon: BarChart3,
      iconColor: '#2dd4bf',
      accentGradient: 'linear-gradient(135deg, #2dd4bf, #14b8a6)',
      title: 'Authoritative Return Basis',
      tag: 'Projection Input',
      tagColor: '#2dd4bf',
      severity: 'low',
      body: Number.isFinite(returnAssumption)
        ? `The projection uses a backend-weighted ${returnAssumption.toFixed(2)}% annual model assumption on a pre-tax nominal basis. It is not a provider forecast.`
        : 'The recommendation service did not provide a portfolio return assumption.',
      action: 'Tax and inflation are intentionally calculated in separate what-if tools with explicit inputs.',
      delay: 0.2
    },
    {
      icon: Newspaper,
      iconColor: '#fbbf24',
      accentGradient: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
      title: 'Recommendation Rationale',
      tag: 'Advisory Context',
      tagColor: '#fbbf24',
      severity: 'medium',
      body: recommendationMeta?.advisory_text
        || (['PENDING', 'GENERATING'].includes(recommendationMeta?.advisory_explanation?.status)
          ? 'Generating grounded explanation…'
          : 'The advisory service did not return a narrative explanation.'),
      action: recommendationMeta?.reconciliation_note || 'Review the recommendation dashboard for instrument-level evidence.',
      delay: 0.3
    },
    {
      icon: AlertTriangle,
      iconColor: '#38bdf8',
      accentGradient: 'linear-gradient(135deg, #38bdf8, #0ea5e9)',
      title: 'Investment Diversification',
      tag: 'Risk Checker',
      tagColor: '#38bdf8',
      severity: 'low',
      body: `${activeRecs.length} backend-selected instruments span ${assetAllocations.length} asset classes: ${assetAllocations.map(([name, percentage]) => `${name} ${percentage}%`).join(', ') || 'allocation unavailable'}.`,
      action: excludedCount > 0 ? `${excludedCount} catalog instruments were excluded by eligibility checks.` : 'No eligibility exclusion count was reported.',
      delay: 0.4
    },
    {
      icon: Shield,
      iconColor: '#a78bfa',
      accentGradient: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
      title: 'Declared Goal Coverage',
      tag: 'Goal Mapping',
      tagColor: '#a78bfa',
      severity: 'low',
      body: `${representedGoals} goal tag${representedGoals === 1 ? '' : 's'} appear across the authoritative instruments for ${profile?.investment_goals?.length || 0} goals declared in your Financial Profile.`,
      action: 'Use Goal Planner for goal-specific backend Monte Carlo projections and contribution simulations.',
      delay: 0.5
    },
  ];

  const severityConfig = {
    low: { label: 'Low Impact', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.08)', border: 'rgba(74, 222, 128, 0.2)' },
    medium: { label: 'Monitor', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.08)', border: 'rgba(251, 191, 36, 0.2)' },
    high: { label: 'Action Needed', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.08)', border: 'rgba(244, 63, 94, 0.2)' },
  };

  return (
    <div className="insights-page">
      <div className="insights-ambient">
        <div className="insights-orb insights-orb-1" />
        <div className="insights-orb insights-orb-2" />
      </div>

      {/* Header */}
      <motion.div
        className="insights-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="insights-badge">
          <Sparkles size={12} /> AI-Powered Analysis
        </div>
        <h1 className="insights-title">
          <span className="insights-icon-wrap">
            <Lightbulb size={22} color="#fbbf24" />
          </span>
          Genie AI{' '}
          <span className="insights-title-accent">Insights</span>
        </h1>
        <p className="insights-subtitle">
          Algorithmic market observations mapped to your {horizon}-year trajectory.
        </p>
        <div className="insights-header-divider" />
      </motion.div>

      {/* Cards */}
      <div className="insights-grid">
        {cards.map((card, i) => {
          const IconComp = card.icon;
          const sev = severityConfig[card.severity];
          return (
            <motion.div
              key={i}
              className="insight-card"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: card.delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              style={{ '--card-color': card.iconColor, '--card-color-rgb': hexToRgb(card.iconColor) }}
            >
              {/* Top accent */}
              <div className="insight-card-accent" style={{ background: card.accentGradient }} />
              
              {/* Ambient glow */}
              <div className="insight-card-glow" style={{ background: `radial-gradient(circle, ${card.iconColor}0a, transparent 70%)` }} />

              {/* Number badge */}
              <div className="insight-number">{String(i + 1).padStart(2, '0')}</div>

              {/* Header */}
              <div className="insight-card-header">
                <div className="insight-icon-wrap" style={{ 
                  background: `linear-gradient(135deg, ${card.iconColor}15, ${card.iconColor}05)`,
                  border: `1px solid ${card.iconColor}30`,
                  boxShadow: `0 0 20px ${card.iconColor}10`
                }}>
                  <IconComp color={card.iconColor} size={20} />
                </div>
                <div className="insight-title-group">
                  <h3 className="insight-card-title">{card.title}</h3>
                  <div className="insight-tags">
                    <span className="insight-tag" style={{ color: card.tagColor, background: `${card.tagColor}12`, borderColor: `${card.tagColor}25` }}>
                      {card.tag}
                    </span>
                    <span className="insight-severity" style={{ color: sev.color, background: sev.bg, borderColor: sev.border }}>
                      {sev.label}
                    </span>
                  </div>
                </div>
              </div>

              {/* Body */}
              <p className="insight-card-body">{card.body}</p>

              {/* Action */}
              <div className="insight-action" style={{ borderColor: `${card.iconColor}15` }}>
                <Zap size={13} color={card.iconColor} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{card.action}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '56, 189, 248';
}

export default InsightsScreen;
