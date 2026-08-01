// BlastSimulator2026 — scripts/check-i18n-parity.ts CLI behavior (issue #457, bug 2)
//
// The script's own header comment documents the contract: exit 0 when every
// non-allowlisted key differs between en.json/fr.json and both key sets match,
// exit 1 when at least one untranslated or orphaned key is found.
//
// The RED version of this file asserted `status === 1` against the *real*
// locale files, which was correct only while fr.json still held hundreds of
// untranslated values. Issue #457 translates fr.json in full, so on the fixed
// tree the real locales are at parity and the CLI must exit 0 — asserting 1
// would pin the suite to the very bug the issue removes. The exit-1 branch is
// covered here through checkParity() with fixture locales instead, which
// exercises the same detection logic that decides the exit code.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { checkParity } from '../../../scripts/check-i18n-parity.js';
import { LOCALE_SHARED_VALUE_ALLOWLIST } from '../../../src/core/i18n/localeSharedValuesAllowlist.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
const EXEC_TIMEOUT = 30_000;

interface RunResult {
  status: number;
  stdout: string;
}

function runParityCheck(): RunResult {
  try {
    const stdout = execFileSync('npx', ['tsx', 'scripts/check-i18n-parity.ts'], {
      cwd: PROJECT_ROOT,
      timeout: EXEC_TIMEOUT,
      encoding: 'utf-8',
    });
    return { status: 0, stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? '' };
  }
}

describe('scripts/check-i18n-parity.ts CLI (issue #457)', () => {
  it('exits zero on the real locales — fr.json is fully translated', () => {
    const result = runParityCheck();
    expect(
      result.status,
      `script must exit 0 once every non-allowlisted key is translated. stdout:\n${result.stdout}`,
    ).toBe(0);
  }, EXEC_TIMEOUT + 10_000);

  it('prints the per-locale key counts so a human can act on the report', () => {
    const result = runParityCheck();
    expect(result.stdout.length, 'script must print something about the result').toBeGreaterThan(0);
    expect(result.stdout).toContain('en.json:');
    expect(result.stdout).toContain('fr.json:');
  }, EXEC_TIMEOUT + 10_000);
});

describe('checkParity() — the detection behind the exit code (issue #457)', () => {
  it('flags a non-allowlisted key whose fr value is byte-identical to en', () => {
    const report = checkParity(
      { 'ui.demo.thing': 'Blast', 'ui.demo.other': 'Rock' },
      { 'ui.demo.thing': 'Blast', 'ui.demo.other': 'Roche' },
    );
    expect(report.untranslated).toEqual(['ui.demo.thing']);
    expect(report.missingInEn).toEqual([]);
    expect(report.missingInFr).toEqual([]);
  });

  it('reports nothing when every non-allowlisted key differs', () => {
    const report = checkParity({ 'ui.demo.thing': 'Rock' }, { 'ui.demo.thing': 'Roche' });
    expect(report.untranslated).toEqual([]);
  });

  it('does not flag an allowlisted key that legitimately shares its value', () => {
    const allowlisted = LOCALE_SHARED_VALUE_ALLOWLIST[0]!;
    const report = checkParity({ [allowlisted]: 'Shared' }, { [allowlisted]: 'Shared' });
    expect(report.untranslated).toEqual([]);
    expect(report.staleAllowlist).not.toContain(allowlisted);
  });

  it('reports an allowlist entry whose values now differ as stale', () => {
    const allowlisted = LOCALE_SHARED_VALUE_ALLOWLIST[0]!;
    const report = checkParity({ [allowlisted]: 'Rock' }, { [allowlisted]: 'Roche' });
    expect(report.staleAllowlist).toContain(allowlisted);
  });

  it('reports key-set drift in both directions', () => {
    const report = checkParity({ 'only.en': 'A' }, { 'only.fr': 'B' });
    expect(report.missingInFr).toEqual(['only.en']);
    expect(report.missingInEn).toEqual(['only.fr']);
  });

  it('returns an empty report for two empty locales', () => {
    const report = checkParity({}, {});
    expect(report.untranslated).toEqual([]);
    expect(report.missingInEn).toEqual([]);
    expect(report.missingInFr).toEqual([]);
  });
});
