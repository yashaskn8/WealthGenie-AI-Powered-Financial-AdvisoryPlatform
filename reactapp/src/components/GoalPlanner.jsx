import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Target, Plus, Trash2, AlertTriangle, CheckCircle, TrendingUp, ArrowUpRight, Clock, ShieldCheck, Sparkles, Activity, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SebiDisclaimer from './SebiDisclaimer';
import api from '../services/api';
import GoalForm from './GoalForm';
import GoalDetailPane from './GoalDetailPane';
import { submitGoal } from '../utils/goalSubmission';

const STATUS_CONFIG = {
  on_track:  { color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)', label: 'ON TRACK',  icon: CheckCircle, glow: 'rgba(16, 185, 129, 0.4)' },
  at_risk:   { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)',  label: 'AT RISK',   icon: AlertTriangle, glow: 'rgba(245, 158, 11, 0.4)' },
  off_track: { color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.14)',   label: 'OFF TRACK', icon: AlertTriangle, glow: 'rgba(244, 63, 94, 0.4)' },
};

const UNKNOWN_STATUS_CONFIG = {
  color: '#64748b', bg: 'rgba(100, 116, 139, 0.14)', label: 'UNAVAILABLE',
  icon: Clock, glow: 'rgba(100, 116, 139, 0.25)',
};

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const formatINR = (value) => {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
};

const GoalPlanner = ({ profile }) => {
  const [goals, setGoals] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [simulatedSips, setSimulatedSips] = useState({});
  const [goalSimulations, setGoalSimulations] = useState({});
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [simulationError, setSimulationError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const fetchGoals = useCallback(async () => {
    try {
      const res = await api.getGoals();
      setGoals(res.goals || []);
      setSimulatedSips(Object.fromEntries((res.goals || []).map(goal => [
        goal._id || goal.goalId,
        Number.isFinite(Number(goal.simulated_monthly_contribution))
          ? Number(goal.simulated_monthly_contribution)
          : null,
      ])));
      if (res.goals && res.goals.length > 0) {
        const first = res.goals[0];
        setSelectedGoal(first);
      }
    } catch (err) {
      console.error('Failed to fetch goals:', err);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  // Sort goals: Critical first, then by probability (lowest first = most urgent)
  const sortedGoals = useMemo(() => {
    return [...goals].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? Number.MAX_SAFE_INTEGER;
      const pb = PRIORITY_ORDER[b.priority] ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const probabilityA = Number(a.probability_of_success);
      const probabilityB = Number(b.probability_of_success);
      if (!Number.isFinite(probabilityA)) return Number.isFinite(probabilityB) ? 1 : 0;
      if (!Number.isFinite(probabilityB)) return -1;
      return probabilityA - probabilityB;
    });
  }, [goals]);

  const getLiveProbability = (goal) => {
    const id = goal._id || goal.goalId;
    const value = Number(goalSimulations[id]?.probability_of_success ?? goal.probability_of_success);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  };

  const getSimulatedChartData = (goal) => {
    const id = goal._id || goal.goalId;
    return goalSimulations[id]?.chartData ?? goal.chartData ?? [];
  };

  const selectedGoalId = selectedGoal?._id || selectedGoal?.goalId;
  const selectedSip = selectedGoalId ? simulatedSips[selectedGoalId] : null;
  useEffect(() => {
    if (!selectedGoalId || !Number.isFinite(selectedSip) || selectedSip <= 0) return undefined;
    const persistedContribution = Number(selectedGoal.simulated_monthly_contribution);
    if (!Number.isFinite(persistedContribution)) return undefined;
    if (selectedSip === persistedContribution) {
      setGoalSimulations(prev => {
        if (!prev[selectedGoalId]) return prev;
        const next = { ...prev };
        delete next[selectedGoalId];
        return next;
      });
      setSimulationError(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSimulationLoading(true);
      setSimulationError(null);
      api.simulateGoal(selectedGoalId, selectedSip, { signal: controller.signal })
        .then(result => {
          if (!cancelled) setGoalSimulations(prev => ({ ...prev, [selectedGoalId]: result }));
        })
        .catch(error => {
          if (!cancelled && error.code !== 'REQUEST_ABORTED') setSimulationError(error.message);
        })
        .finally(() => {
          if (!cancelled) setSimulationLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedGoal, selectedGoalId, selectedSip]);

  const handleSubmitGoal = async (goalData) => {
    setLoading(true);
    try {
      const res = await submitGoal(api, {
        ...goalData,
        profileId: profile?.profileId || profile?._id,
      });

      if (res.success && res.goal) {
        setGoals(prev => [...prev, res.goal]);
        setSelectedGoal(res.goal);
        const gid = res.goal._id || res.goal.goalId;
        setSimulatedSips(prev => ({
          ...prev,
          [gid]: Number.isFinite(Number(res.goal.simulated_monthly_contribution))
            ? Number(res.goal.simulated_monthly_contribution)
            : null,
        }));
        setShowForm(false);
      } else if (!res.success) {
        alert('Failed to save goal: ' + res.error);
      }
    } catch (err) {
      alert('Failed to save goal: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (goalId) => {
    setDeletingId(goalId);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    try {
      await api.deleteGoal(deletingId);
      const nextGoals = goals.filter(g => (g._id !== deletingId && g.goalId !== deletingId));
      setGoals(nextGoals);
      if (selectedGoal && (selectedGoal._id === deletingId || selectedGoal.goalId === deletingId)) {
        setSelectedGoal(nextGoals[0] || null);
      }
    } catch (err) {
      alert('Failed to delete goal: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handlePriorityChange = async (newPriority) => {
    const gid = selectedGoal?._id || selectedGoal?.goalId;
    if (!gid) return;
    try {
      const res = await api.updateGoal(gid, { priority: newPriority });
      if (res.goal) {
        setGoals(prev => prev.map(g => (g._id === gid || g.goalId === gid) ? res.goal : g));
        setSelectedGoal(res.goal);
      }
    } catch (err) {
      alert('Failed to update priority: ' + err.message);
    }
  };

  const handleSaveGoalUpdates = async (updates) => {
    const gid = selectedGoal?._id || selectedGoal?.goalId;
    if (!gid) return;
    try {
      const res = await api.updateGoal(gid, {
        target_amount: updates.targetAmount,
        current_savings: updates.currentSavings
      });
      if (res.goal) {
        const freshList = await api.getGoals();
        setGoals(freshList.goals || []);
        const freshGoal = (freshList.goals || []).find(g => g._id === gid || g.goalId === gid);
        setSelectedGoal(freshGoal || res.goal);
      }
    } catch (err) {
      alert('Failed to update goal settings: ' + err.message);
    }
  };

  // Summary statistics
  const targetValues = goals.map(goal => Number(goal.target_amount));
  const sipValues = goals.map(goal => Number(goal.recommended_sip));
  const probabilityValues = goals.map(goal => Number(goal.probability_of_success));
  const totalTarget = targetValues.every(value => Number.isFinite(value) && value >= 0)
    ? targetValues.reduce((sum, value) => sum + value, 0)
    : null;
  const totalSip = sipValues.every(value => Number.isFinite(value) && value >= 0)
    ? sipValues.reduce((sum, value) => sum + value, 0)
    : null;
  const avgProb = goals.length > 0 && probabilityValues.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    ? probabilityValues.reduce((sum, value) => sum + value, 0) / probabilityValues.length
    : null;

  return (
    <motion.div 
      className="dashboard-page"
      style={{
        padding: '32px 40px', boxSizing: 'border-box', maxWidth: 1600, margin: '0 auto', width: '100%',
        overflowX: 'hidden', minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(14, 165, 233, 0.08) 0%, transparent 70%)'
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* Futuristic Dashboard Header */}
      <div className="dashboard-header" style={{ marginBottom: 32, flexWrap: 'wrap', gap: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <motion.div
            whileHover={{ rotate: 180, scale: 1.05 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            style={{ 
              display: 'flex', width: 68, height: 68, flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(139, 92, 246, 0.2))', 
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 30px rgba(6, 182, 212, 0.3), inset 0 1px 1px rgba(255,255,255,0.3)',
              position: 'relative'
            }}
          >
            <Target size={34} color="#38bdf8" />
            <motion.div
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{
                position: 'absolute', inset: -3, borderRadius: 24,
                border: '1px solid rgba(56, 189, 248, 0.5)', pointerEvents: 'none'
              }}
            />
          </motion.div>
          <div className="dashboard-title-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="dashboard-subtitle" style={{ letterSpacing: '1.5px', color: '#38bdf8', fontWeight: 800 }}>
                QUANTITATIVE FINANCIAL PLANNING ENGINE
              </span>
              <span style={{
                fontSize: '0.6rem', padding: '2px 8px', borderRadius: 10,
                background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#10b981', fontWeight: 800, letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: 4
              }}>
                <Activity size={10} /> v3.0 ACTIVE
              </span>
            </div>
            <h1 className="dashboard-title" style={{ fontSize: '2.2rem', fontWeight: 900, letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #fff 0%, #cbd5e1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              My Goal Planner
            </h1>
            <p style={{ fontSize: '0.98rem', color: '#94a3b8', marginTop: 6, fontWeight: 500 }}>
              Server-owned, model-based goal simulations using explicit assumptions; results are not provider forecasts or guaranteed outcomes.
            </p>
          </div>
        </div>

        <motion.button
          onClick={() => setShowForm(!showForm)}
          whileHover={{ scale: 1.05, boxShadow: '0 0 35px rgba(6, 182, 212, 0.5)' }}
          whileTap={{ scale: 0.95 }}
          style={{
            background: 'linear-gradient(135deg, #0ea5e9 0%, #8b5cf6 100%)', border: 'none',
            borderRadius: 16, padding: '14px 28px', color: '#fff', fontWeight: 800,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            fontSize: '0.95rem', boxShadow: '0 8px 25px rgba(6, 182, 212, 0.35), inset 0 1px 1px rgba(255,255,255,0.4)',
            letterSpacing: '0.3px', flexShrink: 0
          }}
        >
          <Plus size={20} /> Create Target Goal
        </motion.button>
      </div>

      {/* Cyber Summary HUD Metrics */}
      {goals.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginBottom: 30 }}
        >
          <motion.div
            whileHover={{ y: -2, boxShadow: '0 12px 30px rgba(6, 182, 212, 0.15)' }}
            style={{
              background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8))',
              border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: 18, padding: '18px 22px',
              display: 'flex', alignItems: 'center', gap: 16, backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 25px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.05)'
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(56, 189, 248, 0.2)' }}>
              <Target size={22} color="#38bdf8" />
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>AGGREGATE TARGET</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f1f5f9', marginTop: 2 }}>{Number.isFinite(totalTarget) ? formatINR(totalTarget) : '—'}</div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -2, boxShadow: '0 12px 30px rgba(16, 185, 129, 0.15)' }}
            style={{
              background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8))',
              border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 18, padding: '18px 22px',
              display: 'flex', alignItems: 'center', gap: 16, backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 25px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.05)'
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(16, 185, 129, 0.2)' }}>
              <TrendingUp size={22} color="#10b981" />
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>REQUIRED MONTHLY SIP</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#10b981', marginTop: 2 }}>{Number.isFinite(totalSip) ? `${formatINR(totalSip)}/mo` : '—'}</div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -2, boxShadow: '0 12px 30px rgba(139, 92, 246, 0.15)' }}
            style={{
              background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8))',
              border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: 18, padding: '18px 22px',
              display: 'flex', alignItems: 'center', gap: 16, backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 25px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.05)'
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(139, 92, 246, 0.12)', border: '1px solid rgba(139, 92, 246, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(139, 92, 246, 0.2)' }}>
              <ArrowUpRight size={22} color="#8b5cf6" />
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>SIMULATED GOAL REACH RATE</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: avgProb === null ? '#64748b' : avgProb >= 0.65 ? '#10b981' : '#f59e0b', marginTop: 2 }}>{avgProb === null ? '—' : `${Math.round(avgProb * 100)}%`}</div>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDeletingId(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            }}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 20 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'linear-gradient(145deg, #1e293b, #0f172a)', border: '1px solid rgba(244, 63, 94, 0.3)',
                borderRadius: 24, padding: 36, maxWidth: 420, width: '90%', textAlign: 'center',
                boxShadow: '0 25px 70px rgba(0,0,0,0.7), 0 0 30px rgba(244, 63, 94, 0.2)',
              }}
            >
              <div style={{
                width: 60, height: 60, borderRadius: 18, margin: '0 auto 18px',
                background: 'rgba(244, 63, 94, 0.12)', border: '1px solid rgba(244, 63, 94, 0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 20px rgba(244, 63, 94, 0.2)'
              }}>
                <Trash2 size={26} color="#f43f5e" />
              </div>
              <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 900, marginBottom: 8 }}>Remove Target Goal?</h3>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: 26, lineHeight: 1.5 }}>
                This will purge all Monte Carlo simulations, AI projections, and history for this goal target.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setDeletingId(null)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', fontWeight: 700, cursor: 'pointer',
                    fontSize: '0.88rem',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                    background: 'linear-gradient(135deg, #dc2626, #f43f5e)', color: '#fff', fontWeight: 800,
                    cursor: 'pointer', fontSize: '0.88rem',
                    boxShadow: '0 4px 20px rgba(244, 63, 94, 0.4)',
                  }}
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Two-panel Responsive Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: showForm || selectedGoal ? '1fr 1.2fr' : '1fr', gap: 28, transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}>
        {/* Left Panel — Goal List */}
        <div>
          <AnimatePresence>
            {showForm && (
              <GoalForm 
                onSubmitGoal={handleSubmitGoal}
                onCancel={() => setShowForm(false)}
                loading={loading}
              />
            )}
          </AnimatePresence>

          {/* Goal Cards */}
          {goals.length === 0 && !showForm && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{
                background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.5), rgba(15, 23, 42, 0.7))',
                borderRadius: 24, padding: '60px 40px',
                textAlign: 'center', border: '1px dashed rgba(56, 189, 248, 0.2)',
                backdropFilter: 'blur(16px)'
              }}
            >
              <div style={{
                width: 76, height: 76, borderRadius: 22, margin: '0 auto 20px',
                background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 30px rgba(56, 189, 248, 0.15)'
              }}>
                <Target size={40} style={{ color: '#38bdf8' }} />
              </div>
              <h3 style={{ fontSize: '1.35rem', color: '#f8fafc', marginBottom: 8, fontWeight: 900 }}>No Active Goals Configured</h3>
              <p style={{ color: '#64748b', fontSize: '0.92rem', maxWidth: 420, margin: '0 auto 26px', lineHeight: 1.6 }}>
                Create your first financial milestone to unlock Monte Carlo projections, AI-powered advice, and SIP planning.
              </p>
              <motion.button 
                whileHover={{ scale: 1.05, boxShadow: '0 0 25px rgba(56, 189, 248, 0.4)' }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowForm(true)}
                style={{
                  background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(139, 92, 246, 0.15))',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: 14, padding: '14px 28px', color: '#38bdf8', fontWeight: 800, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10, margin: '0 auto', fontSize: '0.92rem'
                }}
              >
                <Plus size={18} /> Initialize Target Goal
              </motion.button>
            </motion.div>
          )}

          {/* Section Header */}
          {goals.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, padding: '0 4px' }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.2px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={13} color="#38bdf8" /> ACTIVE TARGETS ({goals.length})
              </span>
              <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 600 }}>
                AUTO-SORTED BY PRIORITY
              </span>
            </div>
          )}

          <AnimatePresence>
            {sortedGoals.map((goal, index) => {
              const cfg = STATUS_CONFIG[goal.status] || UNKNOWN_STATUS_CONFIG;
              const StatusIcon = cfg.icon;
              const isSelected = selectedGoal?._id === goal._id || selectedGoal?.goalId === goal.goalId;
              const prob = getLiveProbability(goal);
              const hasProbability = Number.isFinite(prob);
              const probPct = hasProbability ? Math.round(prob * 100) : null;
              const probColor = !hasProbability ? '#64748b' : probPct >= 75 ? '#10b981' : probPct >= 50 ? '#f59e0b' : '#f43f5e';
              
              // Clamp funded savings to target amount for display so huge test values don't break UI
              const rawSavings = Number(goal.current_savings);
              const targetAmount = Number(goal.target_amount);
              const hasFundingData = Number.isFinite(rawSavings) && rawSavings >= 0
                && Number.isFinite(targetAmount) && targetAmount > 0;
              const fundedSavings = hasFundingData ? Math.min(targetAmount, rawSavings) : null;
              const savingsProgress = hasFundingData
                ? Math.min(100, Math.round((fundedSavings / targetAmount) * 100))
                : null;
              const yearsLeft = Number.isFinite(Number(goal.years_remaining)) ? Number(goal.years_remaining) : null;

              return (
                <motion.div
                  key={goal._id || goal.goalId}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100, scale: 0.9 }}
                  transition={{ duration: 0.35, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ y: -3, scale: 1.01, boxShadow: `0 15px 40px rgba(0,0,0,0.5), 0 0 20px ${isSelected ? 'rgba(56,189,248,0.2)' : 'transparent'}` }}
                  onClick={() => { setSelectedGoal(goal); setShowForm(false); }}
                  style={{
                    background: isSelected
                      ? 'linear-gradient(145deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.98))'
                      : 'linear-gradient(145deg, rgba(30, 41, 59, 0.45), rgba(15, 23, 42, 0.65))',
                    border: `1px solid ${isSelected ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.06)'}`,
                    borderRadius: 20, padding: '22px 24px', marginBottom: 16, cursor: 'pointer',
                    boxShadow: isSelected ? '0 12px 35px rgba(6, 182, 212, 0.15)' : '0 4px 12px rgba(0,0,0,0.2)',
                    transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden',
                    backdropFilter: 'blur(16px)',
                  }}
                >
                  {/* Glowing left accent line */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                    background: isSelected
                      ? 'linear-gradient(180deg, #38bdf8, #8b5cf6)'
                      : `linear-gradient(180deg, ${cfg.color}, transparent)`,
                    borderRadius: '20px 0 0 20px',
                  }} />

                  {/* Top neon indicator on select */}
                  {isSelected && (
                    <motion.div
                      layoutId="active-card-top-beam"
                      style={{
                        position: 'absolute', top: 0, left: '10%', width: '80%', height: '1px',
                        background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.6), transparent)',
                      }}
                    />
                  )}

                  {/* Goal Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#f8fafc', margin: '0 0 6px 0', letterSpacing: '-0.01em' }}>
                        {goal.goal_name}
                      </h4>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.78rem', color: '#64748b', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Target size={12} color="#38bdf8" /> <strong style={{ color: '#cbd5e1' }}>{formatINR(goal.target_amount)}</strong>
                        </span>
                        <span style={{ opacity: 0.3 }}>|</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={12} /> {yearsLeft === null ? 'Unavailable' : yearsLeft > 0 ? `${yearsLeft.toFixed(1)} yrs` : 'Matured'}
                        </span>
                        <span style={{ opacity: 0.3 }}>|</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <TrendingUp size={12} color="#10b981" /> {formatINR(goal.recommended_sip)}/mo
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{
                        background: cfg.bg, color: cfg.color, padding: '4px 10px',
                        borderRadius: 8, fontSize: '0.7rem', fontWeight: 800,
                        display: 'flex', alignItems: 'center', gap: 5,
                        border: `1px solid ${cfg.color}30`,
                        boxShadow: `0 0 10px ${cfg.glow}`
                      }}>
                        <StatusIcon size={12} /> {cfg.label}
                      </span>
                      <motion.button 
                        whileHover={{ scale: 1.2, color: '#f43f5e' }}
                        onClick={(e) => { e.stopPropagation(); handleDelete(goal._id || goal.goalId); }}
                        style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, display: 'flex' }}
                        title="Delete Goal Target"
                      >
                        <Trash2 size={15} />
                      </motion.button>
                    </div>
                  </div>

                  {/* Sleek Visual Meters & Probability Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
                    <div style={{ flex: 1 }}>
                      {/* Funded meter */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#64748b', marginBottom: 4 }}>
                        <span>Funded Capital: <strong style={{ color: '#38bdf8' }}>{formatINR(fundedSavings)}</strong></span>
                        <span style={{ fontWeight: 700, color: '#94a3b8' }}>{savingsProgress === null ? 'Unavailable' : `${savingsProgress}%`}</span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{
                          height: '100%', width: `${savingsProgress ?? 0}%`,
                          background: 'linear-gradient(90deg, #0284c7, #38bdf8)', borderRadius: 3,
                          boxShadow: '0 0 8px rgba(56, 189, 248, 0.4)'
                        }} />
                      </div>
                      
                      {/* Model-based simulation meter */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#64748b', marginBottom: 4 }}>
                        <span>Simulated Goal Reach Rate</span>
                        <span style={{ fontWeight: 700, color: probColor }}>{hasProbability ? `${probPct}%` : 'Unavailable'}</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${hasProbability ? Math.min(100, probPct) : 0}%` }}
                          transition={{ duration: 0.9, ease: 'easeOut', delay: index * 0.08 }}
                          style={{
                            height: '100%',
                            background: `linear-gradient(90deg, ${probColor}50, ${probColor})`, borderRadius: 3,
                            boxShadow: `0 0 12px ${probColor}60`,
                          }} 
                        />
                      </div>
                    </div>

                    {/* Clean single-line probability badge */}
                    <div style={{
                      width: 52, height: 52, borderRadius: 16, flexShrink: 0,
                      background: `radial-gradient(circle at center, ${probColor}18, ${probColor}05)`,
                      border: `1.5px solid ${probColor}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 0 16px ${probColor}25`
                    }}>
                      <span style={{ fontSize: '1rem', fontWeight: 900, color: probColor, letterSpacing: '-0.02em' }}>
                        {hasProbability ? `${probPct}%` : '—'}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Right Panel — Goal Details & Monte Carlo Engine */}
        {selectedGoal && (
          <GoalDetailPane 
            selectedGoal={selectedGoal}
            simulatedSips={simulatedSips}
            onChangeSimulatedSip={(val) => setSimulatedSips(prev => ({ ...prev, [selectedGoal._id || selectedGoal.goalId]: val }))}
            onPriorityChange={handlePriorityChange}
            onSaveGoalUpdates={handleSaveGoalUpdates}
            getLiveProbability={getLiveProbability}
            getSimulatedChartData={getSimulatedChartData}
            monthlySavingsCapacity={Number(profile?.monthly_savings)}
            simulationLoading={simulationLoading}
            simulationError={simulationError}
            simulationResult={goalSimulations[selectedGoalId] || null}
          />
        )}
      </div>
      <SebiDisclaimer />
    </motion.div>
  );
};

export default GoalPlanner;
