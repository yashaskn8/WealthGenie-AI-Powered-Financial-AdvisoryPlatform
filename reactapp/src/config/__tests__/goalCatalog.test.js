import { describe, it, expect } from 'vitest';
import { GOAL_TYPES, getGoalTypeById, getGoalTypeByLabel, hexToRgb } from '../goalCatalog';

describe('presentation-only goal catalog', () => {
  it('exports only display metadata for all eight custom-goal presets', () => {
    expect(GOAL_TYPES).toHaveLength(8);
    const ids = GOAL_TYPES.map(g => g.id);
    expect(ids).toEqual([
      'retirement',
      'emergency_fund',
      'home_purchase',
      'child_education',
      'vehicle',
      'wealth_growth',
      'tax_saving',
      'custom',
    ]);
    GOAL_TYPES.forEach(goal => {
      expect(Object.keys(goal).sort()).toEqual(['Icon', 'color', 'id', 'label']);
    });
  });

  it('correctly maps getGoalTypeById for exact and normalized IDs', () => {
    expect(getGoalTypeById('retirement')?.label).toBe('Retirement');
    expect(getGoalTypeById('emergency_fund')?.label).toBe('Emergency Fund');
    expect(getGoalTypeById('home-purchase')?.id).toBe('home_purchase');
    expect(getGoalTypeById('child education')?.id).toBe('child_education');
    expect(getGoalTypeById('nonexistent')).toBeNull();
  });

  it('correctly maps getGoalTypeByLabel for exact and case-insensitive labels', () => {
    expect(getGoalTypeByLabel('Retirement')?.id).toBe('retirement');
    expect(getGoalTypeByLabel('emergency fund')?.id).toBe('emergency_fund');
    expect(getGoalTypeByLabel('Home Purchase')?.id).toBe('home_purchase');
    expect(getGoalTypeByLabel('nonexistent')).toBeNull();
  });

  it('correctly converts hex colors to RGB strings via hexToRgb', () => {
    expect(hexToRgb('#f59e0b')).toBe('245, 158, 11');
    expect(hexToRgb('#10b981')).toBe('16, 185, 129');
    expect(hexToRgb('invalid')).toBeNull();
  });
});
