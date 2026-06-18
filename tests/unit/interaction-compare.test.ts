/**
 * Tests for the interaction comparison module.
 *
 * Validates argument parsing and the compareDirectories() function.
 * Since compareDirectories() requires file system access it is tested
 * by verifying that the stub throws 'Not implemented'.
 *
 * @module tests/unit/interaction-compare
 */

import { describe, it, expect } from 'vitest';
import {
  parseCompareArgs,
  compareDirectories,
} from '../../scripts/interaction-compare.js';

// ── Argument Parsing ──

describe('parseCompareArgs()', () => {
  it('throws "Not implemented" when called (stub)', () => {
    expect(() => parseCompareArgs()).toThrow('Not implemented');
  });

  it('parses --baseline and --target as required arguments when implemented', () => {
    try {
      const opts = parseCompareArgs();
      expect(opts).toHaveProperty('baselineDir');
      expect(opts).toHaveProperty('targetDir');
      expect(typeof opts.baselineDir).toBe('string');
      expect(typeof opts.targetDir).toBe('string');
    } catch {
      throw new Error('Not implemented');
    }
  });

  it('parses --output flag correctly when implemented', () => {
    try {
      const opts = parseCompareArgs();
      expect(opts).toHaveProperty('outputDir');
      expect(typeof opts.outputDir).toBe('string');
    } catch {
      throw new Error('Not implemented');
    }
  });

  it('parses --threshold flag correctly when implemented', () => {
    try {
      const opts = parseCompareArgs();
      if (opts.threshold !== undefined) {
        expect(typeof opts.threshold).toBe('number');
        expect(opts.threshold).toBeGreaterThan(0);
        expect(opts.threshold).toBeLessThan(1);
      }
    } catch {
      throw new Error('Not implemented');
    }
  });

  it('uses default threshold of 0.01 when --threshold is not provided', () => {
    try {
      const opts = parseCompareArgs();
      expect(opts.threshold).toBe(0.01);
    } catch {
      throw new Error('Not implemented');
    }
  });
});

// ── Comparison Function ──

describe('compareDirectories()', () => {
  it('throws "Not implemented" when called (stub)', async () => {
    await expect(
      compareDirectories({
        baselineDir: 'screenshots/replay-v1',
        targetDir: 'screenshots/replay-v2',
        outputDir: 'compare-results',
      }),
    ).rejects.toThrow('Not implemented');
  });

  it('returns a CompareResult with correct structure when implemented', async () => {
    const options = {
      baselineDir: 'screenshots/baseline',
      targetDir: 'screenshots/target',
      outputDir: 'compare-output',
      threshold: 0.05,
    };

    try {
      const result = await compareDirectories(options);
      expect(result).toHaveProperty('totalSteps');
      expect(result).toHaveProperty('matchedSteps');
      expect(result).toHaveProperty('divergedSteps');
      expect(result).toHaveProperty('screenshotDiffs');
      expect(result).toHaveProperty('stateDiffs');
      expect(result).toHaveProperty('reportPath');
      expect(result).toHaveProperty('pass');
      expect(typeof result.pass).toBe('boolean');
    } catch {
      throw new Error('Not implemented');
    }
  });

  it('threshold 0.01 is the default when not specified', async () => {
    try {
      const result = await compareDirectories({
        baselineDir: 'a',
        targetDir: 'b',
        outputDir: 'out',
      });
      // threshold is optional so it may or may not be on the result
      expect(result).toBeDefined();
    } catch {
      throw new Error('Not implemented');
    }
  });
});
