import crypto from 'node:crypto';

// Bump whenever the deterministic goal calculation's inputs or policy change.
// Legacy results without this identity are intentionally stale until recalculated.
export const GOAL_CALCULATION_POLICY_VERSION = 'goal-plan-policy-1.0.0';

export function buildGoalCalculationInputFingerprint(goal) {
  const goalId = goal?._id ? String(goal._id) : String(goal?.goalId || '');
  const profileId = goal?.profileId ? String(goal.profileId) : '';
  const targetAmount = Number(goal?.target_amount);
  const currentSavings = Number(goal?.current_savings);
  const targetDate = goal?.target_date ? new Date(goal.target_date) : null;
  const inflationAssumption = Number(goal?.inflation_assumption);

  if (!goalId || !profileId || !Number.isFinite(targetAmount) || targetAmount < 0
      || !Number.isFinite(currentSavings) || currentSavings < 0
      || !targetDate || Number.isNaN(targetDate.getTime())
      || !Number.isFinite(inflationAssumption) || inflationAssumption < 0 || inflationAssumption > 1) {
    return null;
  }

  const payload = {
    goalId,
    profileId,
    targetAmount,
    targetDate: targetDate.toISOString(),
    currentSavings,
    inflationAssumption,
    calculationPolicyVersion: GOAL_CALCULATION_POLICY_VERSION,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
