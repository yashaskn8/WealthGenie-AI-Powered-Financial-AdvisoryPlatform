const TEST_ENVIRONMENTS = new Set(['test', 'evaluation', 'reliability']);

export class FaultInjector {
  constructor({ enabled = false, environment = process.env.NODE_ENV || 'development', faults = [] } = {}) {
    if (environment === 'production') {
      const error = new Error('Reliability fault injection is unavailable in production.');
      error.code = 'RELIABILITY_FAULT_INJECTION_FORBIDDEN';
      throw error;
    }
    if (enabled && !TEST_ENVIRONMENTS.has(environment)) {
      const error = new Error('Fault injection requires an explicit test/evaluation environment.');
      error.code = 'RELIABILITY_FAULT_INJECTION_TEST_ONLY';
      throw error;
    }
    this.enabled = Boolean(enabled);
    this.environment = environment;
    this.faults = new Map();
    faults.forEach(fault => this.add(fault));
  }

  add({ action, count = 1, code = 'INJECTED_FAILURE' } = {}) {
    if (!this.enabled) return false;
    if (!action || !Number.isInteger(count) || count < 1 || count > 10) throw new Error('Invalid reliability fault.');
    this.faults.set(action, { remaining: count, code: String(code).slice(0, 80) });
    return true;
  }

  consume(action) {
    if (!this.enabled || !this.faults.has(action)) return null;
    const fault = this.faults.get(action);
    fault.remaining -= 1;
    if (fault.remaining <= 0) this.faults.delete(action);
    return fault.code;
  }

  availableInProduction() { return false; }
}
