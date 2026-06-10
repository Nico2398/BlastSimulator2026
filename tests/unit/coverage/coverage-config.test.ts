// BlastSimulator2026 — Coverage config structure tests (8.1)
// Verifies vitest.config.ts coverage properties and thresholds.
// On the skeleton, threshold tests FAIL because all values are 0.
// After implementer fills in real values, all tests PASS.

import { describe, it, expect } from 'vitest';
import vitestConfig from '../../../vitest.config.ts';

type Thresholds = {
  perFile: boolean;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
};

type CoverageConfig = {
  provider: string;
  reporter: string[];
  include: string[];
  exclude: string[];
  thresholds: Thresholds;
};

describe('vitest coverage configuration (8.1)', () => {
  const config = vitestConfig as { test?: { coverage?: CoverageConfig } };
  const coverage = config.test?.coverage;

  it('config exports a test property', () => {
    expect(config.test).toBeDefined();
  });

  it('test config has a coverage property', () => {
    expect(coverage).toBeDefined();
  });

  describe('coverage provider', () => {
    it('coverage provider is set to v8', () => {
      expect(coverage?.provider).toBe('v8');
    });
  });

  describe('coverage reporters', () => {
    it('reporter is an array', () => {
      expect(Array.isArray(coverage?.reporter)).toBe(true);
    });

    it('reporter includes text', () => {
      expect(coverage?.reporter).toContain('text');
    });

    it('reporter includes json', () => {
      expect(coverage?.reporter).toContain('json');
    });

    it('reporter includes html', () => {
      expect(coverage?.reporter).toContain('html');
    });

    it('reporter includes lcov', () => {
      expect(coverage?.reporter).toContain('lcov');
    });
  });

  describe('coverage include/exclude', () => {
    it('include pattern is src/**', () => {
      expect(coverage?.include).toContain('src/**');
    });

    it('exclude excludes test files (**/*.test.ts)', () => {
      expect(coverage?.exclude).toContain('src/**/*.test.ts');
    });

    it('exclude excludes spec files (**/*.spec.ts)', () => {
      expect(coverage?.exclude).toContain('src/**/*.spec.ts');
    });

    it('exclude excludes declaration files (**/*.d.ts)', () => {
      expect(coverage?.exclude).toContain('src/**/*.d.ts');
    });

    it('exclude excludes __tests__ directories', () => {
      expect(coverage?.exclude).toContain('src/**/__tests__/**');
    });

    it('exclude excludes __mocks__ directories', () => {
      expect(coverage?.exclude).toContain('src/**/__mocks__/**');
    });
  });

  describe('coverage thresholds', () => {
    it('thresholds has perFile set to true', () => {
      expect(coverage?.thresholds.perFile).toBe(true);
    });

    it('statements threshold is greater than 0', () => {
      expect(coverage?.thresholds.statements).toBeGreaterThan(0);
    });

    it('branches threshold is greater than 0', () => {
      expect(coverage?.thresholds.branches).toBeGreaterThan(0);
    });

    it('functions threshold is greater than 0', () => {
      expect(coverage?.thresholds.functions).toBeGreaterThan(0);
    });

    it('lines threshold is greater than 0', () => {
      expect(coverage?.thresholds.lines).toBeGreaterThan(0);
    });
  });
});
