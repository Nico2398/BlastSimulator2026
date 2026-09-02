// BlastSimulator2026 — Coverage npm scripts tests (8.1)
// Verifies package.json defines coverage-related scripts and dependencies.
// On the skeleton, the devDependency test FAILS because @vitest/coverage-v8
// is not installed. After implementer adds the dependency, all tests PASS.

import { describe, it, expect } from 'vitest';
import pkg from '../../../package.json' with { type: 'json' };

const COVERAGE_FLAG = '--coverage';

describe('coverage npm scripts (8.1)', () => {
  describe('test:coverage script', () => {
    it('exists in package.json scripts', () => {
      expect(pkg.scripts).toHaveProperty('test:coverage');
    });

    it('contains the --coverage flag', () => {
      const script = pkg.scripts['test:coverage'];
      expect(script).toContain(COVERAGE_FLAG);
    });

    it('uses vitest run (not vitest watch)', () => {
      const script = pkg.scripts['test:coverage'];
      expect(script).toContain('vitest run');
    });
  });

  describe('validate script', () => {
    it('exists in package.json scripts', () => {
      expect(pkg.scripts).toHaveProperty('validate');
    });

    it('includes npm run test:coverage (coverage gate)', () => {
      const script = pkg.scripts['validate'];
      expect(script).toContain('npm run test:coverage');
    });

    // `validate` used to name test:integration and test:scenarios one by one,
    // on top of a test:coverage run that had already executed both. It runs
    // the whole suite once instead — a superset of the two, and of the lint
    // and benchmark directories the coverage config excludes. The guarantee is
    // unchanged, so it is asserted against the new shape: `test` must stay
    // unfiltered, or a future path filter there would quietly shrink what
    // `validate` covers while still reading as "npm run test".
    it('runs the whole suite, which subsumes the integration and scenario-def tests', () => {
      expect(pkg.scripts['validate']).toContain('npm run test ');
      expect(pkg.scripts['test']).toBe('vitest run');
    });

    it('includes tsc type-check', () => {
      const script = pkg.scripts['validate'];
      expect(script).toContain('tsc --noEmit');
    });

    it('includes vite build', () => {
      const script = pkg.scripts['validate'];
      expect(script).toContain('vite build');
    });
  });

  describe('@vitest/coverage-v8 dependency', () => {
    it('is listed in devDependencies', () => {
      // FAILS on skeleton: @vitest/coverage-v8 is not yet installed
      expect(pkg.devDependencies).toHaveProperty('@vitest/coverage-v8');
    });

    it('has a valid semver version string', () => {
      const version = pkg.devDependencies['@vitest/coverage-v8'];
      expect(version).toBeDefined();
      expect(version).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
    });
  });
});
