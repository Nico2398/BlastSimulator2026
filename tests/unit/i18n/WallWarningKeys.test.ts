// BlastSimulator2026 — wall-warning i18n keys exist in both locales, translated (#1943)
import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import fr from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const KEYS = [
  'ui.blast_workshop.preview.wall_warning',
  'ui.blast_workshop.preflight.warn_wall_slump',
  'ui.survey.wall_overlay_toggle_tip',
];
const enMap = en as Record<string, string>;
const frMap = fr as Record<string, string>;

describe('wall warning i18n keys', () => {
  for (const key of KEYS) {
    it(`${key} exists in en and fr and is translated`, () => {
      expect(enMap[key], 'en').toBeTruthy();
      expect(frMap[key], 'fr').toBeTruthy();
      expect(frMap[key]).not.toBe(enMap[key]);
    });
  }

  for (const key of KEYS.slice(0, 2)) {
    it(`${key} interpolates height, rock and safe height in both locales`, () => {
      for (const map of [enMap, frMap]) {
        expect(map[key]).toContain('{height}');
        expect(map[key]).toContain('{rock}');
        expect(map[key]).toContain('{safe}');
      }
    });
  }
});
