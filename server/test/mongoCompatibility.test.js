import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import {
  getMongoConnectionOptions,
  getMongoFlavor,
  omitUnsetOptionalUniqueFields,
  optionalUniqueIndex,
  validateMongoCompatibilityConfig,
} from '../config/mongoCompatibility.js';

const rootDir = fs.existsSync(path.join(process.cwd(), 'docker-compose.yml'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

function containsTypePartialFilter(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.partialFilterExpression?.$type) return true;
  return Object.values(value).some(containsTypePartialFilter);
}

test('production schema indexes use DocumentDB-compatible existence filters', () => {
  for (const [name, schema] of [['Recommendation', Recommendation.schema], ['AuditRecord', AuditRecord.schema]]) {
    assert.equal(containsTypePartialFilter(schema.indexes()), false, `${name} contains an unsupported $type partial filter`);
  }
});

test('optional unique fields are omitted when absent rather than persisted as null', () => {
  const omitted = omitUnsetOptionalUniqueFields({ idempotencyOperationId: null, profileCompletionCandidateId: undefined, value: 1 });
  assert.deepEqual(omitted, { value: 1 });
  assert.equal(Recommendation.schema.path('profileCompletionCandidateId').defaultValue, undefined);
  assert.equal(Recommendation.schema.path('idempotencyOperationId').defaultValue, undefined);
});

test('candidate, idempotency, and audit-chain uniqueness remains enforced', () => {
  const indexes = Recommendation.schema.indexes();
  for (const name of ['unique_profile_completion_candidate', 'unique_advisory_idempotency_operation']) {
    const index = indexes.find(([, options]) => options.name === name);
    assert.ok(index, `${name} index is missing`);
    assert.equal(index[1].unique, true);
    assert.deepEqual(index[1].partialFilterExpression, { [Object.keys(index[0])[0]]: { $exists: true } });
  }

  const auditIndex = AuditRecord.schema.indexes().find(([, options]) => options.name === 'unique_user_audit_chain_sequence');
  assert.ok(auditIndex, 'audit-chain uniqueness index is missing');
  assert.equal(auditIndex[1].unique, true);
  assert.deepEqual(auditIndex[1].partialFilterExpression, { chain_sequence: { $exists: true } });
});

test('startup warms every transaction collection before transactional persistence', () => {
  const source = fs.readFileSync(path.join(rootDir, 'server', 'services', 'advisoryPersistence.js'), 'utf8');
  for (const model of ['FinancialProfile', 'Recommendation', 'AuditRecord', 'AuditChainHead', 'IdempotencyKey']) {
    assert.match(source, new RegExp(`${model}\\.init\\(\\)`));
  }
  assert.ok(source.indexOf('FinancialProfile.init()') < source.indexOf('persistAdvisoryAtomically'));
});

test('MongoDB mode preserves caller options and is the default flavor', () => {
  assert.equal(getMongoFlavor({}), 'mongodb');
  const options = getMongoConnectionOptions({ MONGODB_FLAVOR: 'mongodb' }, { retryWrites: true, tls: false });
  assert.deepEqual(options, { retryWrites: true, tls: false });
});

test('DocumentDB mode disables retryable writes and enables certificate-verified TLS', () => {
  const options = getMongoConnectionOptions({
    MONGODB_FLAVOR: 'documentdb',
    MONGODB_TLS_CA_FILE: '/etc/ssl/docdb-ca.pem',
  }, { maxPoolSize: 10 });
  assert.equal(options.retryWrites, false);
  assert.equal(options.tls, true);
  assert.equal(options.tlsCAFile, '/etc/ssl/docdb-ca.pem');
  assert.equal(options.tlsAllowInvalidCertificates, undefined);
});

test('production DocumentDB configuration fails closed without the CA bundle', () => {
  const result = validateMongoCompatibilityConfig({ NODE_ENV: 'production', MONGODB_FLAVOR: 'documentdb' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('MONGODB_TLS_CA_FILE')));
  assert.equal(validateMongoCompatibilityConfig({ NODE_ENV: 'production', MONGODB_FLAVOR: 'documentdb', MONGODB_TLS_CA_FILE: '/ca.pem' }).valid, true);
});

test('invalid or insecure Mongo compatibility settings fail closed', () => {
  assert.throws(() => getMongoFlavor({ MONGODB_FLAVOR: 'atlas' }), /MONGODB_FLAVOR/);
  const result = validateMongoCompatibilityConfig({ MONGODB_TLS_ALLOW_INVALID_CERTS: 'true' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('certificate verification')));
});

test('shared index helper only emits existence-based partial filters', () => {
  assert.deepEqual(optionalUniqueIndex('idempotencyOperationId', 'test').options.partialFilterExpression, {
    idempotencyOperationId: { $exists: true },
  });
});
