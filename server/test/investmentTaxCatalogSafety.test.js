import test from 'node:test';
import assert from 'node:assert/strict';
import { investmentDatabase } from '../data/investmentDatabase.js';

test('server catalog does not expose legacy PPF/SSY static tax labels as authority', () => {
  for (const id of ['ppf', 'sukanya']) {
    const instrument = investmentDatabase.find(item => item.id === id);
    assert.ok(instrument);
    assert.equal(instrument.taxation.status, 'TAX_CLASSIFICATION_UNAVAILABLE');
    assert.equal(instrument.taxation.taxFreeInterest, undefined);
    assert.equal(instrument.taxation.section, undefined);
    assert.equal(instrument.dynamicData.taxType, 'eee'); // Internal legacy tag only.
    assert.doesNotMatch(JSON.stringify(instrument.staticData), /taxFreeInterest|"section":"80C"|tax-free interest/i);
  }
});
