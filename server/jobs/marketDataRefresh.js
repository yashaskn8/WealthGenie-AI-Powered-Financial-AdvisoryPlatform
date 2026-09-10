/**
 * WealthGenie Market Data Cron Jobs
 * Refreshes live market data on a schedule.
 *
 * - AMFI NAVs: current universe plus one bounded seven-day historical window daily
 * - Primary market context: batched benchmark quotes plus cached daily history
 */

import {
  fetchAmfiHistoricalNavSnapshot,
  fetchAmfiProductSnapshot,
} from '../services/marketDataService.js';
import { getLiveMarketContext } from '../services/marketContextService.js';
import logger from '../utils/logger.js';

let activeJobStopper = null;

export const MARKET_CONTEXT_OPEN_REFRESH_MS = 8 * 60 * 1000;
export const MARKET_CONTEXT_CLOSED_REFRESH_MS = 30 * 60 * 1000;
export const MARKET_CONTEXT_HOLIDAY_REFRESH_MS = 2 * 60 * 60 * 1000;

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
    const [current, historical] = await Promise.all([
      fetchAmfiProductSnapshot({ forceRefresh: true }),
      fetchAmfiHistoricalNavSnapshot({ forceRefresh: true }),
    ]);
    logger.info('AMFI refresh completed', {
      currentProductCount: current.productCount,
      currentStatus: current.status,
      historicalProductCount: historical.productCount,
      historicalStatus: historical.status,
    });
  }));

  // During an NSE session, refresh the batched quote set frequently enough to
  // keep a recommendation-age snapshot inside the 15-minute open-session
  // contract. Outside a session, the scheduler backs off; the provider's
  // calendar remains the authority for holidays and session status.
  cancellations.push(scheduleAdaptiveJob('Primary Market Context', async () => {
    const result = await getLiveMarketContext({ forceQuoteRefresh: true });
    logger.info('Primary market context refresh completed', {
      context: result.context || null,
      status: result.status,
      marketSession: result.marketSnapshot?.marketSession?.status || 'UNKNOWN',
      recommendationUsability: result.recommendationUsability?.status || 'NOT_USABLE',
    });
    return result;
  }));

  logger.info('Market data refresh jobs scheduled');
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
  let running = false;

  // Preserve the startup warmup so caches populate shortly after boot.
  const warmup = setTimeout(async () => {
    if (running) return;
    running = true;
    try {
      await fn();
      logger.info(`${name}: initial run complete`);
    } catch (err) {
      logger.error(`${name}: initial run failed`, { error: err.message });
    } finally {
      running = false;
    }
  }, 5000);
  warmup.unref?.();

  const runScheduled = async () => {
    if (running) {
      logger.warn(`${name}: overlapping refresh skipped`);
      return;
    }
    running = true;
    try {
      await fn();
    } catch (err) {
      logger.error(`${name} failed`, { error: err.message });
    } finally {
      running = false;
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

export function getMarketContextRefreshDelay(result) {
  const session = result?.marketSnapshot?.marketSession?.status;
  if (session === 'MARKET_OPEN') return MARKET_CONTEXT_OPEN_REFRESH_MS;
  if (session === 'MARKET_HOLIDAY') return MARKET_CONTEXT_HOLIDAY_REFRESH_MS;
  return MARKET_CONTEXT_CLOSED_REFRESH_MS;
}

function scheduleAdaptiveJob(name, fn) {
  let timer = null;
  let stopped = false;
  let running = false;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    let result = null;
    try {
      result = await fn();
    } catch (error) {
      logger.error(`${name} failed`, { error: error.message });
    } finally {
      running = false;
      if (!stopped) {
        timer = setTimeout(run, getMarketContextRefreshDelay(result));
        timer.unref?.();
      }
    }
  };

  timer = setTimeout(run, 5000);
  timer.unref?.();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
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
