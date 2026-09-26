if (process.env.RUN_AGENT_LIVE_EVALS !== 'true') {
  console.log(JSON.stringify({ enabled: false, reason: 'RUN_AGENT_LIVE_EVALS is not true' }));
  process.exit(0);
}

// Do not initialize a paid provider or imply a closed-loop evaluation exists.
// This repository does not yet register an isolated real PlanReview runner
// for the live evaluator. The library requires one and rejects omission.
console.error(JSON.stringify({
  enabled: false,
  code: 'LIVE_EVAL_RUNNER_REQUIRED',
  reason: 'No isolated real PlanReview evaluation runner is configured; no provider call was made.',
}));
process.exitCode = 2;
