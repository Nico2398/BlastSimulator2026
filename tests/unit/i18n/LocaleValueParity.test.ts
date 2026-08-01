// BlastSimulator2026 — fr.json value parity against en.json (issue #457, bug 2)
//
// ~921+ of 2743 fr.json values are byte-identical to en.json — left
// untranslated, concentrated in event.*.title / event.*.opt#. This test
// computes the actual set of untranslated keys directly from the locale
// files and requires it to exactly match LOCALE_SHARED_VALUE_ALLOWLIST
// (src/core/i18n/localeSharedValuesAllowlist.ts), which starts empty on this
// branch. It is expected to fail (RED) until the implementer translates
// fr.json and/or populates the allowlist for any keys that are legitimately
// shared (proper nouns, numeric-only strings, symbols).
//
// It also pins key-set parity: en.json and fr.json must declare exactly the
// same set of keys, so a translation can never silently fall back to a
// missing key in one locale.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { LOCALE_SHARED_VALUE_ALLOWLIST } from '../../../src/core/i18n/localeSharedValuesAllowlist.js';

const en: Record<string, string> = enLocale as Record<string, string>;
const fr: Record<string, string> = frLocale as Record<string, string>;

/** Keys present in both locale files whose values are byte-identical. */
function computeUntranslatedKeys(): string[] {
  const enKeys = new Set(Object.keys(en));
  const frKeys = new Set(Object.keys(fr));
  const shared = [...enKeys].filter((k) => frKeys.has(k));
  return shared.filter((k) => en[k] === fr[k]).sort();
}

describe('en.json / fr.json — key-set parity', () => {
  it('declare exactly the same set of keys', () => {
    const enKeys = new Set(Object.keys(en));
    const frKeys = new Set(Object.keys(fr));

    const missingFromFr = [...enKeys].filter((k) => !frKeys.has(k)).sort();
    const missingFromEn = [...frKeys].filter((k) => !enKeys.has(k)).sort();

    expect(missingFromFr, `keys present in en.json but missing from fr.json:\n${missingFromFr.join('\n')}`).toEqual([]);
    expect(missingFromEn, `keys present in fr.json but missing from en.json:\n${missingFromEn.join('\n')}`).toEqual([]);
  });

  it('have the same total key count', () => {
    expect(Object.keys(fr).length, 'fr.json key count must match en.json key count').toBe(Object.keys(en).length);
  });
});

describe('en.json / fr.json — value parity against the allowlist', () => {
  it('every key whose fr value is byte-identical to its en value is on LOCALE_SHARED_VALUE_ALLOWLIST, and vice versa', () => {
    const untranslated = computeUntranslatedKeys();
    const allowlist = [...LOCALE_SHARED_VALUE_ALLOWLIST].sort();

    // Symmetric diff, printed so the implementer/fixer can act on it directly.
    const untranslatedSet = new Set(untranslated);
    const allowlistSet = new Set(allowlist);

    const untranslatedNotAllowlisted = untranslated.filter((k) => !allowlistSet.has(k));
    const allowlistedButActuallyDifferent = allowlist.filter((k) => !untranslatedSet.has(k));

    expect(
      untranslatedNotAllowlisted,
      `${untranslatedNotAllowlisted.length} key(s) are untranslated (fr === en) but not on ` +
        `LOCALE_SHARED_VALUE_ALLOWLIST — translate them in fr.json, or add them to the allowlist ` +
        `if they are legitimately shared (proper nouns, numbers, symbols):\n` +
        untranslatedNotAllowlisted.slice(0, 50).map((k) => `  ${k}: "${en[k]}"`).join('\n') +
        (untranslatedNotAllowlisted.length > 50 ? `\n  ...and ${untranslatedNotAllowlisted.length - 50} more` : ''),
    ).toEqual([]);

    expect(
      allowlistedButActuallyDifferent,
      `${allowlistedButActuallyDifferent.length} key(s) are on LOCALE_SHARED_VALUE_ALLOWLIST but their ` +
        `en/fr values now differ — remove them from the allowlist:\n` +
        allowlistedButActuallyDifferent.join('\n'),
    ).toEqual([]);
  });

  it('reports the exact untranslated key set for readability (informational count check)', () => {
    // A concrete regression bound: the audit found ~921 of 2743 keys
    // untranslated. This is not a magic threshold to tune toward — it fails
    // whenever any non-allowlisted key is untranslated, which the assertion
    // above already enforces. This second assertion exists purely so a
    // failure here prints the count alongside the full list above.
    const untranslated = computeUntranslatedKeys();
    const nonAllowlisted = untranslated.filter((k) => !LOCALE_SHARED_VALUE_ALLOWLIST.includes(k));
    expect(nonAllowlisted.length, `${nonAllowlisted.length} untranslated, non-allowlisted key(s) remain`).toBe(0);
  });
});

describe('event.*.title / event.*.opt# keys — translation concentration point', () => {
  it('no event.*.title or event.*.opt# key is left byte-identical between en and fr', () => {
    const eventKeys = Object.keys(en).filter(
      (k) => /^event\..*\.(title|opt\d+)$/.test(k) && !LOCALE_SHARED_VALUE_ALLOWLIST.includes(k),
    );
    const untranslated = eventKeys.filter((k) => en[k] === fr[k]);
    expect(
      untranslated,
      `${untranslated.length}/${eventKeys.length} event.*.title / event.*.opt# keys are untranslated:\n` +
        untranslated.slice(0, 30).join('\n') +
        (untranslated.length > 30 ? `\n...and ${untranslated.length - 30} more` : ''),
    ).toEqual([]);
  });
});
