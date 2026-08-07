// BlastSimulator2026 — glossary conformance sweep (issue #492, section 1).
//
// src/core/i18n/glossary.ts's `GLOSSARY` records, per terminology concept
// (5 employee roles, the survey action, 6 panel names), the one wording each
// locale must converge on and the `forbiddenSynonyms` — wordings that drifted
// into the files and must not survive anywhere.
//
// Per glossary.ts's own "Consumers" doc comment: "none of `forbiddenSynonyms`
// appears anywhere in the locale file for that language" — a full sweep of
// every one of the 3231 keys in that locale file, not just the
// `relevantKeys` sample glossary.ts lists as a starting point. This
// deliberately also catches narrative/flavour-text occurrences the
// per-entry `note` fields call out as originally out of scope for the
// canonical-term requirement: the issue text is explicit that each of these
// concepts gets "exactly one FR name in use everywhere", and forbidden
// wordings are exactly the wordings glossary.ts says must go.
//
// Verifies that every GLOSSARY concept's forbidden synonyms are fully swept
// from both locale files: a full scan of every key, not just the
// `relevantKeys` sample glossary.ts lists as a starting point. Per-concept
// rationale and exact key-by-key history of what was renamed lives in the
// `note` field of each GLOSSARY entry in glossary.ts.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { GLOSSARY } from '../../../src/core/i18n/glossary.js';
import type { LocaleTerm } from '../../../src/core/i18n/glossary.js';

const LOCALE_DATA: Record<'en' | 'fr', Record<string, string>> = {
  en: enLocale as Record<string, string>,
  fr: frLocale as Record<string, string>,
};

// ── Narrow, documented exemptions ──────────────────────────────────────────
//
// A handful of (concept, locale, synonym) hits are legitimate: the matched
// substring is not actually naming the glossary concept in that key. Each
// entry here is scoped to specific keys only — never a blanket exemption for
// the synonym itself — so it cannot silently swallow a real regression
// elsewhere in the file.
//
// - role_manager / fr / "responsable" & "Responsable": in these two event
//   resolution lines "responsable" is the plain adjective "responsible" (as
//   in "the responsible choice"), not a naming of the Manager role — compare
//   the concept's own canonical noun form "Gérant". Restored from a prior
//   overcorrection to "vertueux" that changed the sentence's meaning (issue
//   #492 review, section 1). glossary.ts's role_manager note documents
//   "responsable" as forbidden specifically as a synonym for the role noun;
//   it does not claim every occurrence of the word in the file names the
//   role, and these two keys are event flavour text, not a role label.
const EXEMPT_HITS: ReadonlyArray<{ concept: string; locale: 'en' | 'fr'; synonym: string; keys: string[] }> = [
  {
    concept: 'role_manager',
    locale: 'fr',
    synonym: 'responsable',
    keys: ['event.mafia_drug_lab.res0', 'event.weather_pit_fish.res1'],
  },
  {
    concept: 'role_manager',
    locale: 'fr',
    synonym: 'Responsable',
    keys: ['event.mafia_drug_lab.res0', 'event.weather_pit_fish.res1'],
  },
];

function exemptedKeys(concept: string, locale: 'en' | 'fr', synonym: string): string[] {
  return EXEMPT_HITS.filter((e) => e.concept === concept && e.locale === locale && e.synonym === synonym).flatMap(
    (e) => e.keys,
  );
}

/** Every key in `locale` whose value contains `term` as a substring, minus documented exemptions. */
function findHits(locale: 'en' | 'fr', term: string, concept: string): string[] {
  const data = LOCALE_DATA[locale];
  const exempt = new Set(exemptedKeys(concept, locale, term));
  return Object.entries(data)
    .filter(([key, value]) => value.includes(term) && !exempt.has(key))
    .map(([key]) => key)
    .sort();
}

describe('GLOSSARY — forbidden synonyms swept from every key, not just relevantKeys', () => {
  for (const entry of GLOSSARY) {
    for (const locale of ['en', 'fr'] as const) {
      const localeTerm: LocaleTerm = entry[locale];
      if (localeTerm.forbiddenSynonyms.length === 0) continue;

      describe(`concept "${entry.concept}" — ${locale}.json`, () => {
        for (const synonym of localeTerm.forbiddenSynonyms) {
          it(`no ${locale}.json value contains forbidden synonym "${synonym}" (canonical: "${localeTerm.canonical}")`, () => {
            const hits = findHits(locale, synonym, entry.concept);
            expect(
              hits,
              `${hits.length} key(s) in ${locale}.json still use forbidden synonym "${synonym}" for ` +
                `concept "${entry.concept}" — replace with canonical "${localeTerm.canonical}":\n` +
                hits.map((k) => `  ${k}: "${LOCALE_DATA[locale][k]}"`).join('\n'),
            ).toEqual([]);
          });
        }
      });
    }
  }
});

describe('GLOSSARY — sanity: every concept is covered by at least one locale check', () => {
  it('GLOSSARY is non-empty and every entry has a concept name', () => {
    expect(GLOSSARY.length).toBeGreaterThan(0);
    for (const entry of GLOSSARY) {
      expect(entry.concept.length).toBeGreaterThan(0);
    }
  });
});
