import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthEngineMetadata } from '../app.js';

test('health financial metadata follows the India fiscal-year rollover at IST midnight', () => {
  const beforeRollover = buildHealthEngineMetadata(new Date('2026-03-31T18:29:59.999Z'));
  const atRollover = buildHealthEngineMetadata(new Date('2026-03-31T18:30:00.000Z'));

  assert.equal(beforeRollover.tax, 'FY2025-26');
  assert.equal(beforeRollover.post_tax, 'FY2025-26 compliance');
  assert.equal(atRollover.tax, 'FY2026-27');
  assert.equal(atRollover.post_tax, 'FY2026-27 compliance');
  assert.equal(typeof atRollover.tax_policy_version, 'string');
  assert.ok(atRollover.projection_assumption_version);
});
