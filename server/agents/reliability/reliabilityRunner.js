import { FaultInjector } from './faultInjector.js';
import { createConstraintRegistry } from './constraintRegistry.js';
import { gradeOutcome, gradeProcess, localizeFailures, buildScorecard } from './graders.js';
import { createTrajectoryIR } from './trajectoryIR.js';
import { collectReliabilityMetrics } from './reliabilityMetrics.js';
import { SyntheticReliabilityEnvironment } from './syntheticEnvironment.js';
import { VirtualClock } from './virtualClock.js';

export function runReliabilityScenario(scenario, { clock = new VirtualClock(), faultInjector = new FaultInjector(), constraintRegistry = createConstraintRegistry() } = {}) {
  const environment = new SyntheticReliabilityEnvironment({ clock, faultInjector, scenarioId: scenario.id });
  scenario.actions.forEach(action => {
    clock.advanceBy(action.atHours - (environment.lastActionHours || 0));
    environment.lastActionHours = action.atHours;
    environment.runAction(action);
  });
  const trajectory = createTrajectoryIR({ scenarioId: scenario.id, events: environment.events });
  const constraints = constraintRegistry.evaluateAll({ scenario, environment, trajectory });
  const processGrade = gradeProcess({ scenario, environment, trajectory, constraints });
  const outcomeGrade = gradeOutcome({ scenario, environment });
  const failures = localizeFailures({ scenario, processGrade, outcomeGrade, trajectory });
  const metrics = collectReliabilityMetrics({ scenario, environment, trajectory, processGrade, outcomeGrade });
  const scorecard = buildScorecard({ scenario, processGrade, outcomeGrade, failures, metrics });
  return Object.freeze({ scenarioId: scenario.id, scenario, trajectory, environment: environment.state, constraints, processGrade, outcomeGrade, failures, metrics, scorecard });
}

export function runReliabilitySuite(scenarios, options = {}) {
  const results = scenarios.map(scenario => runReliabilityScenario(scenario, options));
  return Object.freeze({ results, scorecards: results.map(result => result.scorecard), passed: results.every(result => result.scorecard.passed), metrics: results.map(result => result.metrics) });
}
