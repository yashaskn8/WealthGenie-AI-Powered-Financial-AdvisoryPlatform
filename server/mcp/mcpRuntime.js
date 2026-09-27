import { randomUUID } from 'node:crypto';

function abortReason(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createMcpRuntime({ toolTimeoutMs = 30000, shutdownGraceMs = 10000 } = {}) {
  let phase = 'STARTING';
  const active = new Map();
  let idleWaiters = [];

  function notifyIdle() {
    if (active.size !== 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function waitForIdle() {
    if (active.size === 0) return Promise.resolve();
    return new Promise(resolve => idleWaiters.push(resolve));
  }

  function assertAccepting() {
    if (phase !== 'READY') {
      const error = abortReason('MCP_DRAINING', 'MCP is not accepting new work.');
      error.status = 503;
      throw error;
    }
  }

  function acquireRequest(controller = new AbortController()) {
    assertAccepting();
    const id = randomUUID();
    active.set(id, { type: 'request', controller });
    let released = false;
    return Object.freeze({
      signal: controller.signal,
      abort: reason => controller.abort(reason),
      release() {
        if (released) return false;
        released = true;
        active.delete(id);
        notifyIdle();
        return true;
      },
    });
  }

  function startTool(executor, parentSignal) {
    assertAccepting();
    const id = randomUUID();
    const controller = new AbortController();
    const record = { type: 'tool', controller };
    active.set(id, record);
    let parentAbortHandler;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = (code, message) => {
      if (controller.signal.aborted) return;
      const reason = abortReason(code, message);
      controller.abort(reason);
      rejectAbort(reason);
    };
    if (parentSignal) {
      parentAbortHandler = () => abort('MCP_CLIENT_CANCELLED', 'The MCP request was cancelled.');
      if (parentSignal.aborted) parentAbortHandler();
      else parentSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
    const timer = setTimeout(() => abort('MCP_TOOL_TIMEOUT', 'MCP tool execution exceeded its time budget.'), toolTimeoutMs);
    timer.unref?.();

    const work = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason || abortReason('MCP_CLIENT_CANCELLED', 'The MCP request was cancelled.');
      return executor(controller.signal);
    });
    // Keep capacity and shutdown accounting attached to the real work, not to
    // the client-facing timeout race. An executor that ignores AbortSignal
    // therefore cannot free a permit while continuing in the background.
    const settled = work.finally(() => {
      clearTimeout(timer);
      if (parentSignal && parentAbortHandler) parentSignal.removeEventListener('abort', parentAbortHandler);
      active.delete(id);
      notifyIdle();
    });
    void settled.catch(() => {});
    return Object.freeze({ result: Promise.race([work, aborted]), settled, signal: controller.signal });
  }

  async function drain({ graceMs = shutdownGraceMs } = {}) {
    if (phase === 'STOPPED') return { drained: active.size === 0, remaining: active.size };
    phase = 'DRAINING';
    let resolveDeadline;
    const deadline = new Promise(resolve => { resolveDeadline = resolve; });
    const timer = setTimeout(() => resolveDeadline(false), Math.max(0, graceMs));
    timer.unref?.();
    const drained = await Promise.race([waitForIdle().then(() => true), deadline]);
    clearTimeout(timer);
    if (!drained) {
      for (const record of active.values()) {
        if (!record.controller.signal.aborted) {
          record.controller.abort(abortReason('MCP_SHUTDOWN', 'MCP is shutting down.'));
        }
      }
      // Bound shutdown even if an injected/non-cooperative executor ignores
      // cancellation. Production tools are pure synchronous calculations with
      // bounded input sizes and cannot hold external resources.
      await Promise.race([waitForIdle(), new Promise(resolve => {
        const forceTimer = setTimeout(resolve, 1000);
        forceTimer.unref?.();
      })]);
    }
    phase = 'STOPPED';
    return { drained: active.size === 0, remaining: active.size };
  }

  return Object.freeze({
    markReady() {
      if (phase === 'STARTING') phase = 'READY';
    },
    acquireRequest,
    startTool,
    drain,
    snapshot() { return Object.freeze({ phase, activeRequests: [...active.values()].filter(item => item.type === 'request').length, activeTools: [...active.values()].filter(item => item.type === 'tool').length }); },
    isReady() { return phase === 'READY'; },
  });
}
