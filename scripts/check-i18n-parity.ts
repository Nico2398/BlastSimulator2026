/**
 * BlastSimulator2026 — i18n Parity Checker
 *
 * Compares src/core/i18n/locales/en.json against fr.json and flags any key
 * whose fr value is byte-identical to the en value (i.e. left untranslated),
 * unless the key appears in LOCALE_SHARED_VALUE_ALLOWLIST
 * (src/core/i18n/localeSharedValuesAllowlist.ts).
 *
 * Also reports key-set drift: a key present in one locale and missing from the
 * other renders as its own raw key at runtime, which no test notices.
 *
 * Usage:
 *   npx tsx scripts/check-i18n-parity.ts
 *   npx tsx scripts/check-i18n-parity.ts --json
 *
 * Exit code: 0 when every non-allowlisted key differs between locales and both
 * key sets match, 1 otherwise.
 *
 * @module check-i18n-parity
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import { LOCALE_SHARED_VALUE_ALLOWLIST } from '../src/core/i18n/localeSharedValuesAllowlist.js';

const ROOT = resolve(import.meta.dirname, '..');
const LOCALE_DIR = resolve(ROOT, 'src', 'core', 'i18n', 'locales');

type LocaleData = Record<string, string>;

interface ParityReport {
  /** Keys whose fr value equals the en value and are not allowlisted. */
  untranslated: string[];
  /** Allowlisted keys whose values now differ — the entry is dead weight. */
  staleAllowlist: string[];
  /** Keys present in en.json but absent from fr.json. */
  missingInFr: string[];
  /** Keys present in fr.json but absent from en.json. */
  missingInEn: string[];
}

function loadLocale(name: string): LocaleData {
  return JSON.parse(readFileSync(resolve(LOCALE_DIR, `${name}.json`), 'utf8')) as LocaleData;
}

export function checkParity(en: LocaleData, fr: LocaleData): ParityReport {
  const allowed = new Set(LOCALE_SHARED_VALUE_ALLOWLIST);
  const untranslated: string[] = [];
  const identical = new Set<string>();

  for (const key of Object.keys(en)) {
    if (!(key in fr)) continue;
    if (fr[key] !== en[key]) continue;
    identical.add(key);
    if (!allowed.has(key)) untranslated.push(key);
  }

  return {
    untranslated,
    staleAllowlist: LOCALE_SHARED_VALUE_ALLOWLIST.filter(k => !identical.has(k)),
    missingInFr: Object.keys(en).filter(k => !(k in fr)),
    missingInEn: Object.keys(fr).filter(k => !(k in en)),
  };
}

function main(): void {
  const en = loadLocale('en');
  const fr = loadLocale('fr');
  const report = checkParity(en, fr);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`en.json: ${Object.keys(en).length} keys   fr.json: ${Object.keys(fr).length} keys`);
    console.log(`allowlisted shared values: ${LOCALE_SHARED_VALUE_ALLOWLIST.length}`);

    for (const key of report.missingInFr) console.log(`MISSING IN fr.json: ${key}`);
    for (const key of report.missingInEn) console.log(`MISSING IN en.json: ${key}`);
    for (const key of report.staleAllowlist) {
      console.log(`STALE ALLOWLIST ENTRY (values now differ): ${key}`);
    }
    for (const key of report.untranslated) {
      console.log(`UNTRANSLATED: ${key} = ${JSON.stringify(en[key])}`);
    }

    const failures = report.untranslated.length + report.missingInFr.length + report.missingInEn.length;
    console.log(
      failures === 0
        ? 'i18n parity OK — every non-allowlisted key is translated.'
        : `i18n parity FAILED — ${report.untranslated.length} untranslated, `
          + `${report.missingInFr.length + report.missingInEn.length} orphaned keys.`,
    );
  }

  const failed = report.untranslated.length > 0
    || report.missingInFr.length > 0
    || report.missingInEn.length > 0;
  process.exit(failed ? 1 : 0);
}

main();
