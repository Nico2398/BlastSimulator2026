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

    it('includes npm run test:integration', () => {
      const script = pkg.scripts['validate'];
      expect(script).toContain('npm run test:integration');
    });

    it('includes npm run test:scenarios', () => {
      const script = pkg.scripts['validate'];
      expect(script).toContain('npm run test:scenarios');
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
