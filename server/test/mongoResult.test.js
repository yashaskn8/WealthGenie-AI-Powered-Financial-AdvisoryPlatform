import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapMongoDocument } from '../services/mongoResult.js';

test('Mongo result normalization preserves direct documents and unwraps driver metadata', () => {
  const document = { _id: 'capacity', value: 'domain-field' };
  assert.equal(unwrapMongoDocument(document), document);
  assert.equal(unwrapMongoDocument({ value: document, ok: 1, lastErrorObject: { updatedExisting: true } }), document);
});

test('Mongo result normalization preserves a failed compare-and-swap as null', () => {
  assert.equal(unwrapMongoDocument(null), null);
  assert.equal(unwrapMongoDocument({ value: null, ok: 1, lastErrorObject: { n: 0 } }), null);
});
