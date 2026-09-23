import AuditRecord from '../models/AuditRecord.js';
import AuditChainHead from '../models/AuditChainHead.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';

export const AUDIT_HASH_ALGORITHM = 'sha256';
export const AUDIT_SCHEMA_VERSION = '1.0';
export const AUDIT_GENESIS_HASH = 'GENESIS';

export function auditHashPayload(record) {
  const payload = {
    schema_version: record.schema_version,
    hash_algorithm: record.hash_algorithm,
    previous_hash: record.previous_hash,
    chain_sequence: record.chain_sequence,
    audit_record_id: String(record._id),
    user_id: String(record.userId),
    profile_id: String(record.profileId),
    recommendation_id: String(record.recommendationId),
    correlation_id: record.correlationId,
    trace_id: record.traceId || '',
    model_version: record.version_id,
    regulatory_rule_version: record.regulatory_rule_version,
    canonical_inputs: record.inputs,
    recommendation_output: record.recommendations,
    cited_rag_chunk_ids: record.cited_rag_chunk_ids || [],
    engine: record.engine,
    timestamp: record.timestamp,
  };
  // Preserve the existing v1 hash for historical events; allocation
  // transitions opt into the additional explicitly versioned payload field.
  if (record.allocation_transition) payload.allocation_transition = record.allocation_transition;
  return payload;
}

export function calculateAuditRecordHash(record) {
  return canonicalSha256(auditHashPayload(record));
}

export async function prepareAuditChainEntry(baseRecord, session) {
  let head = await AuditChainHead.findById(baseRecord.userId).session(session).lean();
  if (!head) {
    const [created] = await AuditChainHead.create([{
      _id: baseRecord.userId,
      sequence: 0,
      lastRecordHash: AUDIT_GENESIS_HASH,
      lastAuditRecordId: null,
    }], { session });
    head = created.toObject();
  }

  const record = {
    ...baseRecord,
    previous_hash: head.lastRecordHash,
    chain_sequence: head.sequence + 1,
    hash_algorithm: AUDIT_HASH_ALGORITHM,
    schema_version: AUDIT_SCHEMA_VERSION,
  };
  record.record_hash = calculateAuditRecordHash(record);
  return { record, previousSequence: head.sequence };
}

export async function advanceAuditChainHead(entry, session) {
  const advanced = await AuditChainHead.updateOne({
    _id: entry.record.userId,
    sequence: entry.previousSequence,
    lastRecordHash: entry.record.previous_hash,
  }, {
    $set: {
      sequence: entry.record.chain_sequence,
      lastRecordHash: entry.record.record_hash,
      lastAuditRecordId: entry.record._id,
    },
  }, { session });

  if (advanced.matchedCount !== 1) {
    const error = new Error('Concurrent audit-chain update conflict. Retry the advisory transaction.');
    error.code = 'AUDIT_CHAIN_CONFLICT';
    throw error;
  }
}

export async function verifyAuditChain(userId) {
  const records = await AuditRecord.find({
    userId,
    record_hash: { $exists: true },
  }).sort({ chain_sequence: 1 }).lean();

  const errors = [];
  let expectedPreviousHash = AUDIT_GENESIS_HASH;
  let expectedSequence = 1;

  for (const record of records) {
    if (record.chain_sequence !== expectedSequence) {
      errors.push({
        auditRecordId: String(record._id),
        field: 'chain_sequence',
        expected: expectedSequence,
        actual: record.chain_sequence,
      });
    }
    if (record.previous_hash !== expectedPreviousHash) {
      errors.push({
        auditRecordId: String(record._id),
        field: 'previous_hash',
        expected: expectedPreviousHash,
        actual: record.previous_hash,
      });
    }

    const calculatedHash = calculateAuditRecordHash(record);
    if (record.record_hash !== calculatedHash) {
      errors.push({
        auditRecordId: String(record._id),
        field: 'record_hash',
        expected: calculatedHash,
        actual: record.record_hash,
      });
    }

    expectedPreviousHash = record.record_hash;
    expectedSequence += 1;
  }

  const head = await AuditChainHead.findById(userId).lean();
  if (records.length > 0 && (!head
      || head.sequence !== records.at(-1).chain_sequence
      || head.lastRecordHash !== records.at(-1).record_hash)) {
    errors.push({
      field: 'chain_head',
      expected: records.length ? records.at(-1).record_hash : AUDIT_GENESIS_HASH,
      actual: head?.lastRecordHash || null,
    });
  }

  return {
    valid: errors.length === 0,
    checkedRecords: records.length,
    headSequence: head?.sequence || 0,
    errors,
  };
}
