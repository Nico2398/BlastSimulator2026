// BlastSimulator2026 — Locale Shared Values Allowlist
// Keys whose en.json and fr.json values are legitimately identical (proper
// nouns, numbers-only strings, symbols) and must not be flagged as
// untranslated by the i18n parity check.
//
// Pure data — no side effects — so it is importable from Node scripts
// (scripts/check-i18n-parity.ts) and browser code alike.

/** Dot-separated i18n keys allowed to hold byte-identical en/fr values. */
export const LOCALE_SHARED_VALUE_ALLOWLIST: string[] = [];
