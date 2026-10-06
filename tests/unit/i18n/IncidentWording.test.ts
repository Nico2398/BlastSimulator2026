import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const KEYS = ['death', 'injury', 'building_destroyed', 'building_damage', 'vehicle_destroyed', 'vehicle_damage']
  .map(k => `ui.operations.incident_${k}`);
const L = (o: unknown) => o as Record<string, string>;

describe('incident wording (#1349)', () => {
  for (const key of KEYS) {
    it(`en ${key} says flying rock, not projection`, () => {
      const s = L(en)[key]!;
      expect(s).toContain('flying rock');
      expect(s.toLowerCase()).not.toContain('projection');
    });
    it(`fr ${key} says projection(s) de roche`, () => {
      expect(L(fr)[key]!).toMatch(/projections? de roche/);
    });
  }
  it('seismic incident keys keep their wording', () => {
    expect(L(en)['ui.operations.incident_seismic_destroyed']).toContain('seismic survey shockwave');
    expect(L(en)['ui.operations.incident_seismic_damage']).toContain('seismic survey shockwave');
  });
  for (const cap of ['death', 'casualty_or_destruction', 'wet_holes', 'oversize']) {
    it(`rating cap key ${cap} exists in en and fr`, () => {
      const key = `ui.blast_workshop.report.rating_cap_${cap}`;
      expect(L(en)[key]).toBeTruthy();
      expect(L(fr)[key]).toBeTruthy();
    });
  }
});
