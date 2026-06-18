/**
 * Tests for the interaction comparison module.
 *
 * Validates argument parsing and the compareDirectories() function.
 *
 * @module tests/unit/interaction-compare
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCompareArgs,
  compareDirectories,
} from '../../scripts/interaction-compare.js';

// ── Argument Parsing ──

describe('parseCompareArgs()', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;

  beforeEach(() => {
    process.exit = vi.fn() as unknown as (code?: number) => never;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  it('exits with code 1 when --baseline and --target are missing', () => {
    process.argv = ['node', 'interaction-compare.ts'];
    parseCompareArgs();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when only --baseline is provided', () => {
    process.argv = ['node', 'interaction-compare.ts', '--baseline', 'dir1'];
    parseCompareArgs();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('parses --baseline and --target correctly', () => {
    process.argv = ['node', 'interaction-compare.ts', '--baseline', 'screenshots/v1', '--target', 'screenshots/v2'];
    const opts = parseCompareArgs();
    expect(opts.baselineDir).toBe('screenshots/v1');
    expect(opts.targetDir).toBe('screenshots/v2');
  });

  it('parses --output flag correctly', () => {
    process.argv = ['node', 'interaction-compare.ts', '--baseline', 'a', '--target', 'b', '--output', 'my-results'];
    const opts = parseCompareArgs();
    expect(opts.outputDir).toBe('my-results');
  });

  it('uses default output dir "compare-results" when --output is not specified', () => {
    process.argv = ['node', 'interaction-compare.ts', '--baseline', 'a', '--target', 'b'];
    const opts = parseCompareArgs();
    expect(opts.outputDir).toBe('compare-results');
  });

  it('parses --threshold flag correctly', () => {
    process.argv = ['node', 'interaction-compare.ts', '--baseline', 'a', '--target', 'b', '--threshold', '0.05'];
    const opts = parseCompareArgs();
    expect(opts.threshold).toBe(0.05);
  });

  it('uses default threshold of 0.01 when --threshold is not provided', () => {
    process.argv = ['node', 'interaction-compare.ts', '--baseline', 'a', '--target', 'b'];
    const opts = parseCompareArgs();
    expect(opts.threshold).toBe(0.01);
  });

  it('returns CompareOptions with all required properties', () => {
    process.argv = ['node', 'interaction-compare.ts', '--baseline', 'a', '--target', 'b'];
    const opts = parseCompareArgs();
    expect(opts).toHaveProperty('baselineDir');
    expect(opts).toHaveProperty('targetDir');
    expect(opts).toHaveProperty('outputDir');
    expect(opts).toHaveProperty('threshold');
  });
});

// ── Comparison Function ──

describe('compareDirectories()', () => {
  it('returns a promise', () => {
    const resultPromise = compareDirectories({
      baselineDir: 'screenshots/replay-v1',
      targetDir: 'screenshots/replay-v2',
      outputDir: 'compare-results',
    });
    expect(resultPromise).toBeInstanceOf(Promise);
  });

  it('rejects when baseline directory does not exist', async () => {
    await expect(
      compareDirectories({
        baselineDir: 'screenshots/nonexistent',
        targetDir: 'screenshots/replay-v2',
        outputDir: 'compare-output',
      }),
    ).rejects.toThrow();
  });

  it('rejects when target directory does not exist', async () => {
    await expect(
      compareDirectories({
        baselineDir: 'src', // exists
        targetDir: 'nonexistent-dir-xyz',
        outputDir: 'compare-output',
      }),
    ).rejects.toThrow();
  });

  it('accepts CompareOptions with custom threshold', () => {
    const resultPromise = compareDirectories({
      baselineDir: 'a',
      targetDir: 'b',
      outputDir: 'c',
      threshold: 0.1,
    });
    expect(resultPromise).toBeInstanceOf(Promise);
  });
});
