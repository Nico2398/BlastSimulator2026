// BlastSimulator2026 — Coverage run integration test (8.1)
// Verifies vitest --coverage works end-to-end: runs on a group of well-tested
// files, then checks coverage report files are created.
// Uses zero thresholds in subprocess to isolate from per-file gate config.

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

describe('npm run test:coverage execution (8.1)', () => {
  let coverageGenerated = false;

  beforeAll(() => {
    // Run coverage on a group of well-tested entity files.
    // Zero thresholds in subprocess to avoid interfering with per-file gate.
    try {
      execSync(
        'npx vitest run --coverage ' +
        '--coverage.thresholds.statements=0 --coverage.thresholds.branches=0 ' +
        '--coverage.thresholds.functions=0 --coverage.thresholds.lines=0 ' +
        '--coverage.thresholds.perFile=false ' +
        'tests/unit/entities/Employee.test.ts tests/unit/entities/Building.test.ts ' +
        '--reporter=verbose ' +
        '--exclude tests/unit/coverage/coverage-run.test.ts',
        {
          cwd: PROJECT_ROOT,
          timeout: 120_000,
          encoding: 'utf-8',
          stdio: 'pipe',
        },
      );
      coverageGenerated = true;
    } catch {
      coverageGenerated = false;
    }
  }, 130_000);

  it('exits with code 0 when coverage runs on a tested subset', () => {
    expect(coverageGenerated).toBe(true);
  });

  it('generates coverage/lcov.info file', () => {
    const lcovPath = resolve(PROJECT_ROOT, 'coverage', 'lcov.info');
    expect(existsSync(lcovPath)).toBe(true);
  });

  it('generates coverage/index.html file', () => {
    const htmlPath = resolve(PROJECT_ROOT, 'coverage', 'index.html');
    expect(existsSync(htmlPath)).toBe(true);
  });

  it('generates coverage/coverage-final.json file', () => {
    const jsonPath = resolve(PROJECT_ROOT, 'coverage', 'coverage-final.json');
    expect(existsSync(jsonPath)).toBe(true);
  });
});
