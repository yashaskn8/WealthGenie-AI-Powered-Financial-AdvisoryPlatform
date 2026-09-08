/**
 * WealthGenie Market Data Cron Jobs
 * Refreshes live market data on a schedule.
 *
 * - AMFI NAVs: one bounded official-report refresh daily
 * - Upstox benchmark quotes: one two-instrument request every 2 hours
 */

import { fetchAmfiProductSnapshot, fetchBenchmarkQuotes } from '../services/marketDataService.js';

let activeJobStopper = null;

/**
 * Start all scheduled market data refresh jobs.
 * Call this once in server.js after DB and Redis are connected.
 */
export function startMarketDataRefreshJobs() {
  stopMarketDataRefreshJobs();
  const cancellations = [];
  // Daily AMFI NAV refresh at 23:30 IST (18:00 UTC)
  // AMFI publishes updated NAVs around 23:00 IST
  cancellations.push(scheduleJob('0 18 * * *', 'AMFI NAV Refresh', async () => {
    const result = await fetchAmfiProductSnapshot({ forceRefresh: true });
    console.info(`[CRON] AMFI: ${result.productCount} products, status ${result.status}`);
  }));

  // A single batched request refreshes NIFTY 50 and India VIX every 2 hours.
  cancellations.push(scheduleJob('0 */2 * * *', 'Upstox Benchmark Quotes', async () => {
    const result = await fetchBenchmarkQuotes({ forceRefresh: true });
    console.info(`[CRON] Upstox benchmarks: ${result.availableFactCount} available, status ${result.status}`);
  }));

  console.info('[CRON] Market data refresh jobs scheduled');
  activeJobStopper = () => cancellations.forEach(cancel => cancel());
  return activeJobStopper;
}

export function stopMarketDataRefreshJobs() {
  activeJobStopper?.();
  activeJobStopper = null;
}

/**
 * Simple cron scheduler using setTimeout/setInterval.
 * Supports the cron shapes used by this app: "minute hour * * *" and "minute * / 2 * * *".
 */
function scheduleJob(cronExpr, name, fn) {
  const { initialDelayMs, intervalMs } = getScheduleTiming(cronExpr);
  let interval = null;

  // Preserve the startup warmup so caches populate shortly after boot.
  const warmup = setTimeout(async () => {
    try {
      await fn();
      console.info(`[CRON] ${name}: initial run complete`);
    } catch (err) {
      console.error(`[CRON] ${name}: initial run failed:`, err.message);
    }
  }, 5000);
  warmup.unref?.();

  const runScheduled = async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[CRON] ${name} failed:`, err.message);
    }
  };

  const scheduledStart = setTimeout(() => {
    runScheduled();
    interval = setInterval(runScheduled, intervalMs);
    interval.unref?.();
  }, initialDelayMs);
  scheduledStart.unref?.();

  return () => {
    clearTimeout(warmup);
    clearTimeout(scheduledStart);
    if (interval) clearInterval(interval);
  };
}

function getScheduleTiming(cronExpr, now = new Date()) {
  const [minutePart, hourPart] = cronExpr.split(' ');
  const fallback = {
    initialDelayMs: 6 * 60 * 60 * 1000,
    intervalMs: 6 * 60 * 60 * 1000,
  };
  const minute = Number(minutePart);

  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return fallback;
  }

  if (hourPart === '*/2') {
    const next = new Date(now);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(minute);

    const currentHour = now.getUTCHours();
    const nextEvenHour = currentHour % 2 === 0 ? currentHour : currentHour + 1;
    next.setUTCHours(nextEvenHour);
    if (next <= now) {
      next.setUTCHours(next.getUTCHours() + 2);
    }

    return {
      initialDelayMs: next.getTime() - now.getTime(),
      intervalMs: 2 * 60 * 60 * 1000,
    };
  }

  const hour = Number(hourPart);
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
    const next = new Date(now);
    next.setUTCSeconds(0, 0);
    next.setUTCHours(hour, minute);
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    return {
      initialDelayMs: next.getTime() - now.getTime(),
      intervalMs: 24 * 60 * 60 * 1000,
    };
  }

  return fallback;
}
