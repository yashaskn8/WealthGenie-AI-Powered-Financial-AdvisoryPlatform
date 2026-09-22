import { AUTHORITY_DELTA_ZERO, HARD_LIMITS, TASK_STATES } from './reliabilityConstants.js';

export class SyntheticReliabilityEnvironment {
  constructor({ clock, faultInjector = null, scenarioId = 'synthetic' } = {}) {
    this.clock = clock;
    this.faultInjector = faultInjector;
    this.scenarioId = scenarioId;
    this.events = [];
    this.state = {
      task: { id: 'task-opaque', state: null, duplicateCount: 0, canceledAt: null },
      provider: { available: true, retries: 0, calls: 0 },
      worker: { status: 'IDLE', generation: 0, staleWritesRejected: 0 },
      evidence: { fresh: true, contradictory: false, promptInjectionContained: true },
      health: { events: [], reactionHours: null, unnecessaryActions: 0 },
      commit: { count: 0, reconciled: false },
      cancellation: { requested: false, propagated: false, completionAfterCancelPrevented: false },
      authorityDelta: AUTHORITY_DELTA_ZERO,
      actionCount: 0,
      retryCount: 0,
    };
  }

  emit(kind, data = {}) {
    this.events.push({
      sequence: this.events.length + 1,
      at: this.clock.now().toISOString(),
      actor: data.actor || 'SYNTHETIC_RUNTIME',
      kind,
      state: this.state.task.state,
      code: data.code || null,
      taskId: this.state.task.id,
      data,
    });
    if (this.events.length > HARD_LIMITS.maxEvents) throw new Error('Reliability scenario event budget exceeded.');
  }

  setTask(state) {
    if (!TASK_STATES.includes(state)) throw new Error(`Invalid synthetic task state: ${state}`);
    this.state.task.state = state;
  }

  submitTask() {
    if (this.state.task.state) {
      this.state.task.duplicateCount += 1;
      this.emit('TASK_DUPLICATE_SUPPRESSED', { code: 'A2A_TASK_IDEMPOTENCY_REPLAY' });
      return;
    }
    this.setTask('SUBMITTED');
    this.emit('TASK_SUBMITTED', { protocolVersion: '1.0', transport: 'HTTP+JSON' });
    this.setTask('WORKING');
    this.emit('TASK_WORKING');
  }

  providerOutage() {
    this.state.provider.available = false;
    this.emit('PROVIDER_OUTAGE', { code: 'PROVIDER_UNAVAILABLE' });
  }

  providerRecover() {
    this.state.provider.available = true;
    this.emit('PROVIDER_RECOVERED');
  }

  providerRequest() {
    this.state.provider.calls += 1;
    if (!this.state.provider.available) {
      this.state.provider.retries += 1;
      this.state.retryCount += 1;
      this.emit('PROVIDER_RETRY_SCHEDULED', { code: 'PROVIDER_UNAVAILABLE', retry: this.state.provider.retries });
      if (this.state.provider.retries >= HARD_LIMITS.maxRetries) {
        this.setTask('FAILED');
        this.emit('TASK_FAILED', { code: 'PROVIDER_RETRY_LIMIT' });
      }
      return;
    }
    if (this.state.cancellation.requested) {
      this.state.cancellation.completionAfterCancelPrevented = true;
      this.emit('COMPLETION_SUPPRESSED_AFTER_CANCEL', { code: 'TASK_CANCELED' });
      return;
    }
    this.setTask('COMPLETED');
    this.emit('TASK_COMPLETED', { artifact: 'synthetic-reliability-artifact' });
  }

  workerCrash() {
    this.state.worker.status = 'CRASHED';
    this.emit('WORKER_CRASHED', { code: 'WORKER_LOST_LEASE' });
  }

  workerResume() {
    this.state.worker.status = 'ACTIVE';
    this.state.worker.generation += 1;
    if (this.state.task.state === 'WORKING') this.emit('WORKER_RESUMED', { executionGeneration: this.state.worker.generation });
  }

  staleWorkerWrite() {
    this.state.worker.staleWritesRejected += 1;
    this.emit('STALE_WRITE_REJECTED', { code: 'AGENT_LEASE_LOST' });
  }

  duplicateQueue() {
    this.state.task.duplicateCount += 1;
    this.emit('QUEUE_DUPLICATE_SUPPRESSED', { code: 'ACTIVE_DEDUPE_KEY' });
  }

  a2aDuplicate() {
    this.state.task.duplicateCount += 1;
    this.emit('A2A_DUPLICATE_SUPPRESSED', { code: 'A2A_IDEMPOTENCY_KEY' });
  }

  a2aCancel() {
    this.state.cancellation.requested = true;
    this.state.cancellation.propagated = true;
    if (!['COMPLETED', 'FAILED'].includes(this.state.task.state)) this.setTask('CANCELED');
    this.emit('A2A_TASK_CANCELED', { code: 'CANCELED' });
  }

  evidenceStale() {
    this.state.evidence.fresh = false;
    const detectedAt = this.clock.now();
    this.state.health.events.push({ reason: 'STALE_EVIDENCE', detectedAt });
    this.emit('PLAN_HEALTH_EVENT', { reason: 'STALE_EVIDENCE' });
  }

  regulatoryUpdate() {
    this.state.evidence.fresh = false;
    this.state.health.events.push({ reason: 'REGULATORY_POLICY_CHANGED', detectedAt: this.clock.now() });
    this.emit('PLAN_HEALTH_EVENT', { reason: 'REGULATORY_POLICY_CHANGED' });
  }

  contradiction() {
    this.state.evidence.contradictory = true;
    this.emit('CONTRADICTORY_EVIDENCE', { code: 'CONFLICTING_EVIDENCE' });
  }

  approvalDelay() {
    this.setTask('WAITING_FOR_APPROVAL');
    this.emit('APPROVAL_PENDING', { code: 'APPROVAL_REQUIRED' });
  }

  approvalExpire() {
    if (this.state.task.state === 'WAITING_FOR_APPROVAL') this.setTask('FAILED');
    this.emit('APPROVAL_EXPIRED', { code: 'APPROVAL_EXPIRED' });
  }

  commitThenCrash() {
    if (this.state.commit.count === 0) {
      this.state.commit.count = 1;
      this.emit('COMMIT_RECORDED', { receipt: 'synthetic-receipt' });
    }
    this.state.worker.status = 'CRASHED';
    this.state.commit.reconciled = true;
    this.emit('COMMIT_RECOVERED_IDEMPOTENTLY', { code: 'RECEIPT_RECONCILED' });
  }

  cancelRace() {
    this.state.cancellation.requested = true;
    this.state.cancellation.propagated = true;
    this.setTask('CANCELED');
    this.state.cancellation.completionAfterCancelPrevented = true;
    this.emit('CANCEL_WON_RACE', { code: 'CANCEL_CONFIRMED' });
  }

  promptInjection() {
    this.state.evidence.promptInjectionContained = true;
    this.emit('UNTRUSTED_PROMPT_INJECTION_CONTAINED', { code: 'UNTRUSTED_DATA' });
  }

  idleMonitor() {
    const event = this.state.health.events.at(-1);
    if (event && this.state.health.reactionHours === null) {
      this.state.health.reactionHours = (this.clock.now().getTime() - event.detectedAt.getTime()) / 3600000;
    } else {
      this.state.health.unnecessaryActions += 1;
    }
    this.emit('PLAN_HEALTH_MONITOR_CHECK', { reactionHours: this.state.health.reactionHours });
  }

  runAction(action) {
    if (++this.state.actionCount > HARD_LIMITS.maxActions) throw new Error('Reliability scenario action budget exceeded.');
    const injectedCode = this.faultInjector?.consume(action.action);
    if (injectedCode) {
      this.emit('FAULT_INJECTED', { code: injectedCode, action: action.action });
      return;
    }
    const handler = {
      SUBMIT_TASK: () => this.submitTask(), PROVIDER_OUTAGE: () => this.providerOutage(), PROVIDER_RECOVER: () => this.providerRecover(),
      PROVIDER_REQUEST: () => this.providerRequest(), WORKER_CRASH: () => this.workerCrash(), WORKER_RESUME: () => this.workerResume(),
      STALE_WORKER_WRITE: () => this.staleWorkerWrite(), DUPLICATE_QUEUE: () => this.duplicateQueue(), A2A_DUPLICATE: () => this.a2aDuplicate(),
      A2A_CANCEL: () => this.a2aCancel(), EVIDENCE_STALE: () => this.evidenceStale(), REGULATORY_UPDATE: () => this.regulatoryUpdate(),
      CONTRADICTION: () => this.contradiction(), APPROVAL_DELAY: () => this.approvalDelay(), APPROVAL_EXPIRE: () => this.approvalExpire(),
      COMMIT_THEN_CRASH: () => this.commitThenCrash(), CANCEL_RACE: () => this.cancelRace(), PROMPT_INJECTION: () => this.promptInjection(),
      IDLE_MONITOR: () => this.idleMonitor(),
    }[action.action];
    if (!handler) throw new Error(`Unknown synthetic action: ${action.action}`);
    handler();
  }
}
