// BlastSimulator2026 — scripts/check-i18n-parity.ts CLI behavior (issue #457, bug 2)
//
// The script's own header comment documents the contract: exit 0 when every
// non-allowlisted key differs between en.json/fr.json, exit 1 when at least
// one untranslated key is found. The skeleton on this branch is a stub that
// always exits 0 regardless of input — so this test is expected to fail RED
// until the script is implemented, because the real fr.json currently has
// hundreds of untranslated keys and LOCALE_SHARED_VALUE_ALLOWLIST is empty.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

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

describe('scripts/check-i18n-parity.ts (issue #457)', () => {
  it('exits non-zero while fr.json has untranslated, non-allowlisted keys', () => {
    const result = runParityCheck();
    expect(result.status, 'script must exit non-zero when untranslated keys exist').toBe(1);
  }, EXEC_TIMEOUT + 10_000);

  it('prints at least one offending key so a human can act on the failure', () => {
    const result = runParityCheck();
    // Concrete known-untranslated key from the issue #457 audit — event.*
    // titles/options are where the untranslated values are concentrated.
    expect(result.stdout.length, 'script must print something about the failure').toBeGreaterThan(0);
  }, EXEC_TIMEOUT + 10_000);
});
