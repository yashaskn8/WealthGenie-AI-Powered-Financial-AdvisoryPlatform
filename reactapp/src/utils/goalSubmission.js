/**
 * WealthGenie — Shared Goal Submission Utility (WG-033)
 * Centralized payload normalization and API submission wrapper.
 */

export function buildGoalPayload({
  goalName,
  targetAmount,
  targetDate,
  currentSavings,
  priority,
  profileId,
}) {
  let formattedDate = targetDate;
  if (targetDate instanceof Date) {
    formattedDate = targetDate.toISOString().split('T')[0];
  } else if (typeof targetDate === 'string') {
    formattedDate = targetDate.trim();
  }

  const payload = {
    goal_name: goalName,
    target_amount: targetAmount,
    target_date: formattedDate,
    current_savings: currentSavings,
    priority,
  };

  if (!profileId) throw new Error('A canonical Financial Profile ID is required for goal planning.');
  payload.profileId = profileId;

  return payload;
}

export async function submitGoal(apiClient, rawInput) {
  try {
    const payload = buildGoalPayload(rawInput);
    const res = await apiClient.createGoal(payload);
    return { success: true, goal: res.goal, raw: res };
  } catch (err) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}
