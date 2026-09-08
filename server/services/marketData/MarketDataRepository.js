import mongoose from 'mongoose';
import InvestmentProduct from '../../models/InvestmentProduct.js';
import MarketObservation from '../../models/MarketObservation.js';
import { AVAILABILITY } from './contracts.js';

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
            lastFetchedAt: new Date(fact.fetchedAt),
            dataClass: fact.dataClass ?? null,
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
  const observationOperations = buildObservationOperations(snapshot);
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
