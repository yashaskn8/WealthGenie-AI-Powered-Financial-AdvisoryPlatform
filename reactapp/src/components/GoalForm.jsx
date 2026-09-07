import React, { useState } from 'react';
import { Rocket, Umbrella, Home, GraduationCap, Shield, Car, Sparkles, TrendingUp, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { GOAL_TYPES } from '../config/goalCatalog';

const ICON_MAP = {
  Umbrella,
  Home,
  GraduationCap,
  Shield,
  Car,
  Sparkles,
  TrendingUp,
  FileText,
};

// Derive GoalForm presets from unified catalog (excluding wealth_growth and tax_saving)
const GOAL_PRESETS = GOAL_TYPES
  .filter(g => g.id !== 'wealth_growth' && g.id !== 'tax_saving')
  .map(g => ({
    label: g.label,
    Icon: ICON_MAP[g.Icon] || Sparkles,
    color: g.color,
  }));

export const GoalForm = ({ onSubmitGoal, onCancel, loading }) => {
  const [formStep, setFormStep] = useState(1);
  const [goalName, setGoalName] = useState('');
  const [customName, setCustomName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [currentSavings, setCurrentSavings] = useState('');
  const [priority, setPriority] = useState('Medium');

  const [minDate] = useState(() => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmitGoal({
      goalName: goalName === 'Custom' ? customName : goalName,
      targetAmount: Number(targetAmount),
      targetDate,
      currentSavings: Number(currentSavings) || 0,
      priority,
    });
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '0.9rem',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'all 0.2s',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '0.78rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#94a3b8',
    marginBottom: '8px',
  };

  return (
    <motion.form 
      data-testid="goal-form"
      initial={{ opacity: 0, height: 0, scale: 0.95 }}
      animate={{ opacity: 1, height: 'auto', scale: 1 }}
      exit={{ opacity: 0, height: 0, scale: 0.95 }}
      transition={{ duration: 0.4, type: 'spring', bounce: 0.2 }}
      onSubmit={handleSubmit} 
      style={{
        background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.9))', backdropFilter: 'blur(24px)',
        border: '1px solid rgba(6, 182, 212, 0.3)', borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 24, padding: 32, marginBottom: 24,
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05), 0 20px 50px rgba(0,0,0,0.5)',
        overflow: 'hidden', position: 'relative'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: '20%', width: '60%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.8), transparent)' }} />
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Rocket size={20} color="#38bdf8" /> Set Up Your Goal (Step {formStep} of 3)
        </h3>
        <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
          {formStep === 1 ? 'Goal Type' : formStep === 2 ? 'Target Amount & Date' : 'Current Savings & Importance'}
        </span>
      </div>

      {/* Step 1: Goal presets */}
      {formStep === 1 && (
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 16 }}>What is your main savings goal?</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            {GOAL_PRESETS.map(preset => (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                key={preset.label} type="button"
                onClick={() => {
                  setGoalName(preset.label);
                  if (preset.label !== 'Custom') {
                    setFormStep(2);
                  }
                }}
                style={{
                  background: goalName === preset.label ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(139, 92, 246, 0.2))' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${goalName === preset.label ? 'rgba(6, 182, 212, 0.5)' : 'rgba(255,255,255,0.05)'}`,
                  borderRadius: 12, padding: '16px 8px', color: goalName === preset.label ? '#fff' : '#94a3b8', 
                  cursor: 'pointer', fontSize: '0.85rem', fontWeight: goalName === preset.label ? 600 : 400,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 8, boxShadow: goalName === preset.label ? 'inset 0 2px 4px rgba(255,255,255,0.1)' : 'none',
                }}
              >
                <preset.Icon size={22} color={goalName === preset.label ? '#fff' : preset.color} /> {preset.label}
              </motion.button>
            ))}
          </div>

          {goalName === 'Custom' && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Custom Goal Name</label>
              <input
                type="text" placeholder="e.g. Euro Trip, Dream Wedding" value={customName}
                onChange={e => setCustomName(e.target.value)}
                style={inputStyle} required
              />
            </motion.div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button 
              type="button" 
              onClick={onCancel}
              style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '14px 24px', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600, flex: 1
              }}
            >
              Cancel
            </button>
            {goalName === 'Custom' && (
              <button 
                type="button" 
                onClick={() => {
                  if (customName.trim() === '') {
                    alert('Please enter a custom goal name.');
                    return;
                  }
                  setFormStep(2);
                }}
                style={{
                  flex: 1, background: 'linear-gradient(135deg, #0ea5e9, #8b5cf6)',
                  border: 'none', borderRadius: 12, padding: '14px', color: '#fff',
                  fontWeight: 700, cursor: 'pointer', fontSize: '1rem',
                  boxShadow: '0 4px 15px rgba(6, 182, 212, 0.4)'
                }}
              >
                Next Step
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Step 2: Amount & Date */}
      {formStep === 2 && (
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem', marginBottom: 16 }}>
            How much do you need for <strong>{goalName === 'Custom' ? customName : goalName}</strong>, and when?
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Target Amount (₹)</label>
              <input
                data-testid="goal-target-amount"
                type="number" placeholder="e.g. 3000000" value={targetAmount}
                onChange={e => setTargetAmount(e.target.value)}
                style={inputStyle} required min="1000"
              />
            </div>
            <div>
              <label style={labelStyle}>Target Date</label>
              <input
                data-testid="goal-target-date"
                type="date" value={targetDate} min={minDate}
                onChange={e => setTargetDate(e.target.value)}
                style={inputStyle} required
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            <button 
              type="button" 
              onClick={() => setFormStep(1)}
              style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '14px 24px', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600, flex: 1
              }}
            >
              Back
            </button>
            <button 
              type="button" 
              onClick={() => {
                if (!targetAmount || Number(targetAmount) < 1000) {
                  alert('Please enter a target amount of at least ₹1,000.');
                  return;
                }
                if (!targetDate) {
                  alert('Please select a target date.');
                  return;
                }
                setFormStep(3);
              }}
              style={{
                flex: 1, background: 'linear-gradient(135deg, #0ea5e9, #8b5cf6)',
                border: 'none', borderRadius: 12, padding: '14px', color: '#fff',
                fontWeight: 700, cursor: 'pointer', fontSize: '1rem',
                boxShadow: '0 4px 15px rgba(6, 182, 212, 0.4)'
              }}
            >
              Next Step
            </button>
          </div>
        </motion.div>
      )}

      {/* Step 3: Savings & Priority */}
      {formStep === 3 && (
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
          <p style={{ color: '#cbd5e1', fontSize: '0.9rem', marginBottom: 16 }}>
            How much have you saved so far, and how important is this goal?
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Current Savings (₹)</label>
              <input
                data-testid="goal-current-savings"
                type="number" placeholder="e.g. 100000" value={currentSavings}
                onChange={e => setCurrentSavings(e.target.value)}
                style={inputStyle} min="0"
              />
            </div>
            <div>
              <label style={labelStyle}>Goal Importance (Priority)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {['Critical', 'High', 'Medium', 'Low'].map(p => {
                  const isActive = priority === p;
                  const colors = { Critical: '#ef4444', High: '#f97316', Medium: '#0ea5e9', Low: '#64748b' };
                  const c = colors[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      style={{
                        background: isActive ? `${c}25` : 'rgba(15, 23, 42, 0.6)',
                        border: `1px solid ${isActive ? c : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 10, padding: '10px 4px', color: isActive ? c : '#94a3b8',
                        fontSize: '0.78rem', fontWeight: isActive ? 800 : 500, cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            <button 
              type="button" 
              onClick={() => setFormStep(2)}
              style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '14px 24px', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 600, flex: 1
              }}
            >
              Back
            </button>
            <button 
              data-testid="goal-submit"
              type="submit" 
              disabled={loading}
              style={{
                flex: 2, background: loading ? '#334155' : 'linear-gradient(135deg, #0ea5e9, #10b981)',
                border: 'none', borderRadius: 12, padding: '14px', color: '#fff',
                fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontSize: '1rem',
                boxShadow: loading ? 'none' : '0 4px 15px rgba(6, 182, 212, 0.4)',
              }}
            >
              {loading ? 'Running AI Projections...' : 'Save Goal & View Projections'}
            </button>
          </div>
        </motion.div>
      )}
    </motion.form>
  );
};

export default GoalForm;
