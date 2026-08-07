// BlastSimulator2026 — known text-correctness defects (issue #492, section 1).
//
// src/core/i18n/glossary.ts's `KNOWN_TEXT_DEFECTS` records text that is
// simply wrong relative to the actual UI, or a straight typo — distinct from
// the "many names, one concept" terminology drift covered by
// glossaryConformance.test.ts. One assertion target per defect:
//   - tutorial.step1 (both locales): says the speed controls are in the
//     top-right corner of the top HUD bar; src/ui/shell/TopBar.ts appends
//     them 3rd from the left (`balanceWrap, dayWrap, speedWrap, ...`), i.e.
//     left of center, not the right.
//   - tutorial.step2 / step4 / step11 / step13 (fr): "Emboutez" (to
//     dent/stamp) where "Embauchez" (to hire) is meant.
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
  it('lists tutorial.step1 as a both-locale defect and the 4 Emboutez typos as fr defects', () => {
    const step1 = KNOWN_TEXT_DEFECTS.find((d) => d.key === 'tutorial.step1');
    expect(step1, 'glossary.ts must record a tutorial.step1 defect').toBeTruthy();
    expect(step1?.locale).toBe('both');

    const typoKeys = ['tutorial.step2', 'tutorial.step4', 'tutorial.step11', 'tutorial.step13'];
    for (const key of typoKeys) {
      const defect = KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr');
      expect(defect, `glossary.ts must record a fr Emboutez defect for ${key}`).toBeTruthy();
    }
  });
});

describe('tutorial.step1 — names the actual (left) location of the speed controls', () => {
  it('en.json no longer claims the speed controls are in the top-right corner', () => {
    expect(en['tutorial.step1']).not.toMatch(/top[- ]right/i);
  });

  it('en.json describes the speed controls as being toward the left of the top bar', () => {
    expect(en['tutorial.step1']).toMatch(/left/i);
  });

  it('fr.json no longer claims the speed controls are "en haut à droite"', () => {
    expect(fr['tutorial.step1']).not.toMatch(/en haut à droite/i);
    expect(fr['tutorial.step1']).not.toMatch(/à droite/i);
  });

  it('fr.json describes the speed controls as being toward the left ("gauche") of the top bar', () => {
    expect(fr['tutorial.step1']).toMatch(/gauche/i);
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
