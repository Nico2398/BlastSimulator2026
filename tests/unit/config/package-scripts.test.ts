// BlastSimulator2026 — Integration & scenario npm scripts tests (8.1)
// Verifies package.json defines test:integration and test:scenarios scripts
// that invoke vitest with the correct target paths.

import { describe, it, expect } from 'vitest';
import pkg from '../../../package.json' with { type: 'json' };

describe('integration & scenario npm scripts (8.1)', () => {
  describe('test:integration script', () => {
    it('exists in package.json scripts', () => {
      expect(pkg.scripts).toHaveProperty('test:integration');
    });

    it('uses vitest run (not vitest watch)', () => {
      const script = pkg.scripts['test:integration'];
      expect(script).toContain('vitest run');
    });

    it('runs tests from tests/integration/', () => {
      const script = pkg.scripts['test:integration'];
      expect(script).toContain('tests/integration');
    });
  });

  describe('test:scenarios script', () => {
    it('exists in package.json scripts', () => {
      expect(pkg.scripts).toHaveProperty('test:scenarios');
    });

    it('uses vitest run (not vitest watch)', () => {
      const script = pkg.scripts['test:scenarios'];
      expect(script).toContain('vitest run');
    });

    it('runs the scenario-defs test suite', () => {
      const script = pkg.scripts['test:scenarios'];
      expect(script).toContain('tests/unit/scenario-defs.test.ts');
    });
  });
});
