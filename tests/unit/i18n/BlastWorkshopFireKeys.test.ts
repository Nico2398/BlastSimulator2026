// BlastSimulator2026 — Blast Workshop fire labels are translated, not left as "Blast" (#2103)
import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import fr from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const KEYS = [
  'ui.blast_workshop.step.fire',
  'ui.blast_workshop.footer.fire',
  'ui.blast_workshop.preflight.detonate',
];
const enMap = en as Record<string, string>;
const frMap = fr as Record<string, string>;

describe('blast workshop fire labels i18n', () => {
  for (const key of KEYS) {
    it(`${key} has a non-empty French value that differs from English`, () => {
      expect(enMap[key], 'en').toBeTruthy();
      expect(frMap[key], 'fr').toBeTruthy();
      expect(frMap[key]!.trim().length).toBeGreaterThan(0);
      expect(frMap[key]).not.toBe(enMap[key]);
    });

    it(`${key} French value does not read "Blast"`, () => {
      expect(frMap[key]).not.toMatch(/\bblast\b/i);
    });
  }
});
