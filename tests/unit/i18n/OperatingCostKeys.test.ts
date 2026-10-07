import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const KEYS = [
  'ui.finances.category.vehicle_maintenance',
  'ui.finances.operating_cost',
  'ui.finances.operating_cost_payroll',
  'ui.finances.operating_cost_buildings',
  'ui.finances.operating_cost_vehicles',
  'ui.finances.operating_cost_fuel',
  'ui.finances.operating_cost_tip',
  'ui.finances.runway_sustainable',
];

describe('operating cost i18n keys (#1375)', () => {
  for (const key of KEYS) {
    it(`${key} exists in en and fr`, () => {
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect((fr as Record<string, string>)[key]).toBeTruthy();
    });
  }
});
