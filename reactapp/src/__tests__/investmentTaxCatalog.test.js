import { describe, expect, it } from 'vitest';
import { investmentDatabase } from '../investmentDatabase';

describe('investment catalog tax boundary', () => {
  it('does not expose legacy PPF or SSY exemption tags as a current tax conclusion', () => {
    for (const id of ['ppf', 'sukanya']) {
      const instrument = investmentDatabase.find(item => item.id === id);
      expect(instrument).toBeDefined();
      expect(instrument.taxation).not.toHaveProperty('taxFreeInterest', true);
      expect(instrument.taxation).not.toHaveProperty('section', '80C');
      expect(instrument.taxType).toBeNull();
      expect(instrument.taxEfficiencyScore).toBeNull();
      expect(instrument.staticData.taxation).not.toHaveProperty('taxFreeInterest', true);
    }
  });
});
