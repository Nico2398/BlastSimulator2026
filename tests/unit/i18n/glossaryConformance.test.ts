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
// Expected RED on this branch: en.json/fr.json still contain "Emboutez",
// "géomètre", "géologue", "Gestionnaire", "responsable", "Conducteur",
// "conducteur", "étude sismique", "Employee panel", "Vehicle(s) panel",
// "Blast Plan", "Construire", "Bâtir", "Deals", "Setup", "Réglages" in
// various keys — see the per-concept `note` field in glossary.ts for exactly
// which keys. The implementer's fix is to rename every hit to the concept's
// canonical wording.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { GLOSSARY } from '../../../src/core/i18n/glossary.js';
import type { LocaleTerm } from '../../../src/core/i18n/glossary.js';

const LOCALE_DATA: Record<'en' | 'fr', Record<string, string>> = {
  en: enLocale as Record<string, string>,
  fr: frLocale as Record<string, string>,
};

/** Every key in `locale` whose value contains `term` as a substring. */
function findHits(locale: 'en' | 'fr', term: string): string[] {
  const data = LOCALE_DATA[locale];
  return Object.entries(data)
    .filter(([, value]) => value.includes(term))
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
            const hits = findHits(locale, synonym);
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
