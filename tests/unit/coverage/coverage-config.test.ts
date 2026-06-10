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

    it.each(['text', 'json', 'html', 'lcov'] as const)('reporter includes %s', (reporter) => {
      expect(coverage?.reporter).toContain(reporter);
    });
  });

  describe('coverage include/exclude', () => {
    it('include pattern is src/**', () => {
      expect(coverage?.include).toContain('src/**');
    });

    it.each([
      ['test files (**/*.test.ts)', 'src/**/*.test.ts'],
      ['spec files (**/*.spec.ts)', 'src/**/*.spec.ts'],
      ['declaration files (**/*.d.ts)', 'src/**/*.d.ts'],
      ['__tests__ directories', 'src/**/__tests__/**'],
      ['__mocks__ directories', 'src/**/__mocks__/**'],
    ] as const)('exclude excludes %s', (_, pattern) => {
      expect(coverage?.exclude).toContain(pattern);
    });
  });

  describe('coverage thresholds', () => {
    it('thresholds has perFile set to true', () => {
      expect(coverage?.thresholds.perFile).toBe(true);
    });

    it.each(['statements', 'branches', 'functions', 'lines'] as const)(
      '%s threshold is greater than 0',
      (key) => {
        expect(coverage?.thresholds[key]).toBeGreaterThan(0);
      },
    );
  });
});
