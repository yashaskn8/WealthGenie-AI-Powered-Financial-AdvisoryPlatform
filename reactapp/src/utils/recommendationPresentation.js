export function formatINR(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `₹${Math.round(number).toLocaleString('en-IN')}` : '—';
}

export function getWhy(recommendation) {
  const reasons = [];
  if (recommendation.returnBasis === 'PRE_TAX_NOMINAL') reasons.push('Expected return is shown on a pre-tax nominal basis.');
  if (Number.isFinite(Number(recommendation.riskScore))) reasons.push(`Risk tier ${recommendation.riskScore} passed the server suitability ceiling.`);
  if (recommendation.tags?.length) reasons.push(`Supports: ${recommendation.tags.slice(0, 3).join(', ')}.`);
  if (recommendation.scoreFactors?.goalFit >= 80) reasons.push('Strong match for the selected Financial Profile goals.');
  if (recommendation.scoreFactors?.liquidity >= 80) reasons.push('High catalog liquidity score.');
  return reasons.length ? reasons : ['Selected by the authoritative backend recommendation pipeline.'];
}
