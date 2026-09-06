/** Presentation-only catalogue for custom Goal Tracker names. */
export const GOAL_TYPES = Object.freeze([
  { id: 'retirement', label: 'Retirement', Icon: 'Umbrella', color: '#8b5cf6' },
  { id: 'emergency_fund', label: 'Emergency Fund', Icon: 'Shield', color: '#10b981' },
  { id: 'home_purchase', label: 'Home Purchase', Icon: 'Home', color: '#38bdf8' },
  { id: 'child_education', label: 'Child Education', Icon: 'GraduationCap', color: '#f59e0b' },
  { id: 'vehicle', label: 'Vehicle', Icon: 'Car', color: '#f43f5e' },
  { id: 'wealth_growth', label: 'Wealth Growth', Icon: 'TrendingUp', color: '#06b6d4' },
  { id: 'tax_saving', label: 'Tax Saving', Icon: 'FileText', color: '#a3e635' },
  { id: 'custom', label: 'Custom', Icon: 'Sparkles', color: '#c084fc' },
]);

export function getGoalTypeById(id) {
  const normalized = String(id || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return GOAL_TYPES.find(goal => goal.id === normalized) || null;
}

export function getGoalTypeByLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return GOAL_TYPES.find(goal => goal.label.toLowerCase() === normalized) || null;
}

export function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return match ? `${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}` : null;
}
