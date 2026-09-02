// BlastSimulator2026 — known text-correctness defects (issue #492, section 1).
//
// src/core/i18n/glossary.ts's `KNOWN_TEXT_DEFECTS` records text that is
// simply wrong relative to the actual UI, or a straight typo — distinct from
// the "many names, one concept" terminology drift covered by
// glossaryConformance.test.ts. One assertion target per defect:
//   - tutorial.step2 / step4 / step11 / step13 (fr): "Emboutez" (to
//     dent/stamp) where "Embauchez" (to hire) is meant.
//
// #923: the tutorial.step1 defect (speed controls said to be in the
// top-right corner) is gone along with the standalone 'time-speed' step it
// belonged to — the key no longer exists in either locale, and
// KNOWN_TEXT_DEFECTS no longer records it.
//
// Every case below is fixed and green; this suite guards against a
// regression reintroducing any of these defects.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { KNOWN_TEXT_DEFECTS } from '../../../src/core/i18n/glossary.js';

const en: Record<string, string> = enLocale as Record<string, string>;
const fr: Record<string, string> = frLocale as Record<string, string>;

describe('KNOWN_TEXT_DEFECTS — sanity', () => {
  it('lists the 4 Emboutez typos as fr defects', () => {
    // #923: tutorial.step1 (the old speed-controls-location text) no longer
    // exists — the standalone 'time-speed' step it belonged to is gone, and
    // KNOWN_TEXT_DEFECTS no longer records it (glossary.ts).
    expect(KNOWN_TEXT_DEFECTS.find((d) => d.key === 'tutorial.step1')).toBeUndefined();

    const typoKeys = ['tutorial.step2', 'tutorial.step4', 'tutorial.step11', 'tutorial.step13'];
    for (const key of typoKeys) {
      const defect = KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr');
      expect(defect, `glossary.ts must record a fr Emboutez defect for ${key}`).toBeTruthy();
    }
  });
});

describe('fr.json — "Emboutez" typo replaced with "Embauchez" (to hire)', () => {
  const typoKeys = ['tutorial.step2', 'tutorial.step4', 'tutorial.step11', 'tutorial.step13'] as const;

  for (const key of typoKeys) {
    it(`fr.json "${key}" does not contain the "Emboutez" typo`, () => {
      expect(fr[key]).not.toMatch(/Emboutez/);
    });

    it(`fr.json "${key}" contains "Embauchez" instead`, () => {
      expect(fr[key]).toMatch(/Embauchez/);
    });
  }
});

describe('en.json — the equivalent tutorial hire steps use "Hire", unaffected by the fr typo', () => {
  const hireKeys = ['tutorial.step2', 'tutorial.step4', 'tutorial.step11', 'tutorial.step13'] as const;

  for (const key of hireKeys) {
    it(`en.json "${key}" contains "Hire"`, () => {
      expect(en[key]).toMatch(/Hire/i);
    });
  }
});
