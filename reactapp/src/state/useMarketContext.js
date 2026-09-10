import { useEffect, useState } from 'react';
import * as api from '../services/api';

const OPEN_REFRESH_MS = 90_000;
const CLOSED_REFRESH_MS = 10 * 60_000;
const OPEN_REVALIDATE_MS = 60_000;
const CLOSED_REVALIDATE_MS = 5 * 60_000;

const store = {
  snapshot: null,
  error: null,
  isLoading: false,
  isRefreshing: false,
  lastResolvedAt: null,
};

const listeners = new Set();
let inFlight = null;
let pollTimer = null;
let consumerCount = 0;
let lifecycleBound = false;
let lifecycleRevalidate = null;

function emit() {
  listeners.forEach(listener => listener());
}

function currentCadence() {
  const status = store.snapshot?.marketSnapshot?.status;
  const session = store.snapshot?.marketSnapshot?.marketSession?.status;
  return status === 'CURRENT' || session === 'MARKET_OPEN' ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS;
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  if (consumerCount === 0) {
    pollTimer = null;
    return;
  }
  pollTimer = setTimeout(() => {
    pollTimer = null;
    requestMarketContext({ reason: 'poll' });
  }, currentCadence());
}

function shouldRevalidate() {
  if (!store.lastResolvedAt) return true;
  const age = Date.now() - store.lastResolvedAt;
  const threshold = store.snapshot?.marketSnapshot?.status === 'CURRENT'
    || store.snapshot?.marketSnapshot?.marketSession?.status === 'MARKET_OPEN'
    ? OPEN_REVALIDATE_MS
    : CLOSED_REVALIDATE_MS;
  return age >= threshold;
}

async function requestMarketContext({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!force && !shouldRevalidate()) return store.snapshot;

  store.isLoading = !store.snapshot;
  store.isRefreshing = Boolean(store.snapshot);
  emit();
  inFlight = api.getCurrentMarketContext()
    .then((snapshot) => {
      store.snapshot = snapshot;
      store.error = null;
      store.lastResolvedAt = Date.now();
      return snapshot;
    })
    .catch((error) => {
      if (error?.code !== 'REQUEST_ABORTED') {
        store.error = error?.message || 'Live market context request failed.';
      }
      return store.snapshot;
    })
    .finally(() => {
      store.isLoading = false;
      store.isRefreshing = false;
      inFlight = null;
      emit();
      schedulePoll();
    });
  return inFlight;
}

function bindLifecycle() {
  if (lifecycleBound || typeof window === 'undefined') return;
  lifecycleRevalidate = () => {
    if (document.visibilityState === 'hidden' || !shouldRevalidate()) return;
    requestMarketContext();
  };
  window.addEventListener('focus', lifecycleRevalidate);
  document.addEventListener('visibilitychange', lifecycleRevalidate);
  lifecycleBound = true;
}

function unbindLifecycle() {
  if (!lifecycleBound || typeof window === 'undefined') return;
  window.removeEventListener('focus', lifecycleRevalidate);
  document.removeEventListener('visibilitychange', lifecycleRevalidate);
  lifecycleRevalidate = null;
  lifecycleBound = false;
}

function subscribe(listener) {
  listeners.add(listener);
  consumerCount += 1;
  bindLifecycle();
  // Every newly mounted surface revalidates, while the module-level in-flight
  // promise guarantees that multiple consumers still produce one backend read.
  requestMarketContext({ force: true });
  return () => {
    listeners.delete(listener);
    consumerCount = Math.max(0, consumerCount - 1);
    if (consumerCount === 0) {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
}

export function useMarketContext() {
  const [, forceRender] = useState(0);
  useEffect(() => subscribe(() => forceRender(value => value + 1)), []);
  return {
    marketContext: store.snapshot,
    marketContextError: store.error,
    marketContextLoading: store.isLoading,
    marketContextRefreshing: store.isRefreshing,
    refreshMarketContext: () => requestMarketContext({ force: true }),
  };
}

export function resetMarketContextStoreForTest() {
  unbindLifecycle();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  store.snapshot = null;
  store.error = null;
  store.isLoading = false;
  store.isRefreshing = false;
  store.lastResolvedAt = null;
  inFlight = null;
  consumerCount = 0;
  listeners.clear();
}
