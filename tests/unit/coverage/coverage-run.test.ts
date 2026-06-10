// BlastSimulator2026 — Coverage run integration test (8.1)
// Verifies vitest --coverage works end-to-end: runs on a group of well-tested
// files, then checks coverage report files are created.
// Uses zero thresholds in subprocess to isolate from per-file gate config.
// Uses separate temp output dir to conflict with parent coverage run.

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
const EXEC_TIMEOUT = 120_000; // 120s for vitest --coverage subprocess
const BEFOREALL_TIMEOUT = 130_000; // slightly above EXEC_TIMEOUT for beforeAll hook

describe('npm run test:coverage execution (8.1)', () => {
  let coverageDir: string;
  let coverageSucceeded = false;

  beforeAll(() => {
    coverageDir = mkdtempSync(resolve(tmpdir(), 'coverage-test-'));
    try {
      execSync(
        'npx vitest run --coverage ' +
        '--coverage.thresholds.statements=0 --coverage.thresholds.branches=0 ' +
        '--coverage.thresholds.functions=0 --coverage.thresholds.lines=0 ' +
        `--coverage.reportsDirectory="${coverageDir}" ` +
        '--coverage.thresholds.perFile=false ' +
        'tests/unit/entities/Employee.test.ts tests/unit/entities/Building.test.ts ' +
        '--reporter=verbose ' +
        '--exclude tests/unit/coverage/coverage-run.test.ts',
        {
          cwd: PROJECT_ROOT,
          timeout: EXEC_TIMEOUT,
          encoding: 'utf-8',
          stdio: 'pipe',
        },
      );
      coverageSucceeded = true;
    } catch {
      coverageSucceeded = false;
    }
  }, BEFOREALL_TIMEOUT);

  it('exits with code 0 when coverage runs on a tested subset', () => {
    expect(coverageSucceeded).toBe(true);
  });

  it.each(['lcov.info', 'index.html', 'coverage-final.json'] as const)(
    'generates coverage/%s',
    (file) => {
      expect(existsSync(resolve(coverageDir, file))).toBe(true);
    },
  );
});
