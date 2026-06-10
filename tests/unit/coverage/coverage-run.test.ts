// BlastSimulator2026 — Coverage run integration test (8.1)
// Executes npm run test:coverage and verifies report files are created.
// On the skeleton this FAILS because @vitest/coverage-v8 is not installed.
// After implementer installs the package, all tests PASS.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

describe('npm run test:coverage execution (8.1)', () => {
  it('exits with code 0 when coverage runs', () => {
    // FAILS on skeleton: @vitest/coverage-v8 missing causes vitest to fail
    const result = execSync('npm run test:coverage -- --reporter=verbose', {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(result).toBeDefined();
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
