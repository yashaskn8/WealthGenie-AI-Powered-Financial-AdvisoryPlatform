import mongoose from 'mongoose';
import InvestmentProduct from '../../models/InvestmentProduct.js';
import MarketObservation from '../../models/MarketObservation.js';
import { AVAILABILITY } from './contracts.js';

export const MARKET_HISTORY_CANDLE_KIND = 'MARKET_HISTORY_CANDLE';
export const MARKET_CONTEXT_SNAPSHOT_KIND = 'MARKET_CONTEXT_SNAPSHOT';
export const MARKET_CONTEXT_CANONICAL_ID = 'market:context:primary';

export function buildProductOperations(snapshot) {
  return (snapshot?.products || []).map(product => ({
    updateOne: {
      filter: { canonicalProductId: product.canonicalProductId },
      update: {
        $set: {
          ...product,
          lastVerifiedAt: new Date(snapshot.fetchedAt),
        },
      },
      upsert: true,
    },
  }));
}

export function buildObservationOperations(snapshot) {
  return (snapshot?.facts || [])
    .filter(fact => fact.availabilityStatus === AVAILABILITY.AVAILABLE
      && Number.isFinite(fact.value) && fact.observedAt && fact.fetchedAt)
    .map(fact => ({
      updateOne: {
        filter: {
          kind: fact.kind,
          'source.provider': fact.source.provider,
          'source.instrumentId': fact.source.instrumentId,
          observedAt: new Date(fact.observedAt),
        },
        update: {
          $set: {
            schemaVersion: fact.schemaVersion,
            kind: fact.kind,
            canonicalProductId: fact.canonicalProductId,
            value: fact.value,
            currency: fact.currency,
            unit: fact.unit,
            observedAt: new Date(fact.observedAt),
            providerTimestamp: fact.providerTimestamp ? new Date(fact.providerTimestamp) : null,
            effectiveTradingDate: fact.effectiveTradingDate ?? null,
            effectiveFrom: fact.effectiveFrom ?? null,
            effectiveTo: fact.effectiveTo ?? null,
            publicationDate: fact.publicationDate ?? null,
            lastFetchedAt: new Date(fact.fetchedAt),
            dataClass: fact.dataClass ?? null,
            semanticClass: fact.semanticClass ?? 'OBSERVED',
            availabilityStatus: AVAILABILITY.AVAILABLE,
            freshness: fact.freshness,
            source: fact.source,
            metrics: fact.metrics,
          },
          $setOnInsert: { firstFetchedAt: new Date(fact.fetchedAt) },
        },
        upsert: true,
      },
    }));
}

export function buildHistoryObservationOperations(snapshot) {
  if (snapshot?.status !== AVAILABILITY.AVAILABLE
      || !snapshot.fetchedAt
      || !Array.isArray(snapshot.candles)) return [];

  return snapshot.candles
    .filter(candle => Number.isFinite(candle?.close) && candle.timestamp && snapshot.source?.provider
      && snapshot.source?.instrumentId && snapshot.source?.url)
    .map(candle => ({
      updateOne: {
        filter: {
          kind: MARKET_HISTORY_CANDLE_KIND,
          'source.provider': snapshot.source.provider,
          'source.instrumentId': snapshot.source.instrumentId,
          observedAt: new Date(candle.timestamp),
        },
        update: {
          $set: {
            schemaVersion: snapshot.schemaVersion,
            kind: MARKET_HISTORY_CANDLE_KIND,
            canonicalProductId: snapshot.instrumentKey,
            value: candle.close,
            currency: null,
            unit: 'INDEX_POINTS',
            observedAt: new Date(candle.timestamp),
            providerTimestamp: candle.timestamp ? new Date(candle.timestamp) : null,
            effectiveTradingDate: candle.effectiveTradingDate ?? null,
            effectiveFrom: null,
            effectiveTo: null,
            publicationDate: null,
            lastFetchedAt: new Date(snapshot.fetchedAt),
            dataClass: snapshot.dataClass ?? 'DAILY',
            semanticClass: 'OBSERVED',
            availabilityStatus: AVAILABILITY.AVAILABLE,
            freshness: snapshot.freshness,
            source: snapshot.source,
            metrics: {
              open: candle.open ?? null,
              high: candle.high ?? null,
              low: candle.low ?? null,
              close: candle.close,
              volume: candle.volume ?? null,
              openInterest: candle.openInterest ?? null,
            },
          },
          $setOnInsert: { firstFetchedAt: new Date(snapshot.fetchedAt) },
        },
        upsert: true,
      },
    }));
}

export function buildMarketContextObservationOperation(published) {
  const snapshot = published?.marketContext?.marketSnapshot;
  const nifty = snapshot?.observedFacts?.find(fact => fact?.key === 'nifty50Current');
  if (!snapshot || !Number.isFinite(nifty?.value) || !nifty.observedAt || !nifty.source?.provider
      || !nifty.source?.instrumentId || !nifty.source?.url || !published.storedAt) return null;

  const fetchedAt = nifty.fetchedAt || published.storedAt;
  return {
    updateOne: {
      filter: {
        kind: MARKET_CONTEXT_SNAPSHOT_KIND,
        'source.provider': nifty.source.provider,
        'source.instrumentId': nifty.source.instrumentId,
        observedAt: new Date(nifty.observedAt),
      },
      update: {
        $set: {
          schemaVersion: snapshot.schemaVersion,
          kind: MARKET_CONTEXT_SNAPSHOT_KIND,
          canonicalProductId: MARKET_CONTEXT_CANONICAL_ID,
          value: nifty.value,
          currency: null,
          unit: nifty.unit || 'INDEX_POINTS',
          observedAt: new Date(nifty.observedAt),
          providerTimestamp: nifty.observedAt ? new Date(nifty.observedAt) : null,
          effectiveTradingDate: nifty.observedAt.slice(0, 10),
          effectiveFrom: null,
          effectiveTo: null,
          publicationDate: null,
          lastFetchedAt: new Date(fetchedAt),
          dataClass: nifty.dataClass || 'LIVE',
          semanticClass: 'POLICY_OUTPUT',
          availabilityStatus: AVAILABILITY.AVAILABLE,
          freshness: nifty.freshness || { status: 'UNKNOWN', ageSeconds: null, maxAgeSeconds: null },
          source: nifty.source,
          metrics: { close: nifty.value },
          snapshotPayload: published,
        },
        $setOnInsert: { firstFetchedAt: new Date(fetchedAt) },
      },
      upsert: true,
    },
  };
}

export async function readLatestPersistedMarketContext({ ObservationModel = MarketObservation } = {}) {
  if (ObservationModel === MarketObservation && mongoose.connection.readyState !== 1) return null;
  const observation = await ObservationModel.findOne({
    kind: MARKET_CONTEXT_SNAPSHOT_KIND,
    availabilityStatus: AVAILABILITY.AVAILABLE,
  }).sort({ observedAt: -1 }).lean();
  return observation?.snapshotPayload || null;
}

export async function persistMarketContextSnapshot(
  published,
  { ObservationModel = MarketObservation } = {},
) {
  if (ObservationModel === MarketObservation && mongoose.connection.readyState !== 1) {
    return { status: 'PERSISTENCE_UNAVAILABLE', observationWrites: 0 };
  }
  const operation = buildMarketContextObservationOperation(published);
  if (!operation) return { status: 'NOT_PERSISTED', observationWrites: 0 };
  await ObservationModel.bulkWrite([operation], { ordered: true });
  return { status: 'PERSISTED', observationWrites: 1 };
}

export async function persistVerifiedMarketSnapshot(
  snapshot,
  { ProductModel = InvestmentProduct, ObservationModel = MarketObservation } = {},
) {
  if (mongoose.connection.readyState !== 1 && ProductModel === InvestmentProduct) {
    return {
      status: 'PERSISTENCE_UNAVAILABLE',
      productWrites: 0,
      observationWrites: 0,
    };
  }

  const productOperations = buildProductOperations(snapshot);
  const observationOperations = [
    ...buildObservationOperations(snapshot),
    ...buildHistoryObservationOperations(snapshot),
  ];
  const batchSize = 1000;
  for (let offset = 0; offset < productOperations.length; offset += batchSize) {
    await ProductModel.bulkWrite(productOperations.slice(offset, offset + batchSize), { ordered: false });
  }
  for (let offset = 0; offset < observationOperations.length; offset += batchSize) {
    await ObservationModel.bulkWrite(
      observationOperations.slice(offset, offset + batchSize),
      { ordered: false },
    );
  }
  return {
    status: 'PERSISTED',
    productWrites: productOperations.length,
    observationWrites: observationOperations.length,
  };
}
