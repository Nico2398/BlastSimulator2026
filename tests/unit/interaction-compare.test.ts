/**
 * Tests for the interaction comparison module.
 *
 * Validates argument parsing and the compareDirectories() function.
 *
 * @module tests/unit/interaction-compare
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import os from 'os';
import {
  parseCompareArgs,
  compareDirectories,
  type CompareOptions,
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
  /**
   * Creates a temporary directory with the given step files for testing.
   */
  function createTempStepDir(
    prefix: string,
    stepFiles: Array<{ step: number; type: string; data?: string }>,
  ): string {
    const tmpDir = resolve(os.tmpdir(), `int-cmp-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
    for (const sf of stepFiles) {
      const padded = String(sf.step).padStart(2, '0');
      if (sf.type === 'json') {
        writeFileSync(
          resolve(tmpDir, `step-${padded}-event.json`),
          sf.data ?? JSON.stringify({}),
        );
      } else {
        // Create a minimal valid PNG (just a small buffer so it's non-empty)
        writeFileSync(
          resolve(tmpDir, `step-${padded}-event.png`),
          Buffer.from(sf.data ?? 'dummy-png-data'),
        );
      }
    }
    return tmpDir;
  }

  it('returns a promise and resolves with CompareResult structure', async () => {
    const tmpBase = createTempStepDir('base', [
      { step: 0, type: 'png' },
      { step: 0, type: 'json' },
    ]);
    const tmpTarget = createTempStepDir('target', [
      { step: 0, type: 'png' },
      { step: 0, type: 'json' },
    ]);
    const tmpOut = resolve(os.tmpdir(), `int-cmp-out-${Date.now()}`);

    try {
      const result = await compareDirectories({
        baselineDir: tmpBase,
        targetDir: tmpTarget,
        outputDir: tmpOut,
      });
      expect(result).toHaveProperty('totalSteps');
      expect(result).toHaveProperty('matchedSteps');
      expect(result).toHaveProperty('divergedSteps');
      expect(result).toHaveProperty('screenshotDiffs');
      expect(result).toHaveProperty('stateDiffs');
      expect(result).toHaveProperty('reportPath');
      expect(result).toHaveProperty('pass');
      expect(typeof result.pass).toBe('boolean');
      expect(Array.isArray(result.screenshotDiffs)).toBe(true);
      expect(Array.isArray(result.stateDiffs)).toBe(true);
    } finally {
      try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(tmpTarget, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('rejects when baseline directory does not exist', async () => {
    await expect(
      compareDirectories({
        baselineDir: 'screenshots/nonexistent',
        targetDir: 'src', // exists
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

  it('accepts CompareOptions with custom threshold and resolves', async () => {
    const tmpBase = createTempStepDir('threshold-base', [
      { step: 0, type: 'json', data: JSON.stringify({ value: 1 }) },
    ]);
    const tmpTarget = createTempStepDir('threshold-target', [
      { step: 0, type: 'json', data: JSON.stringify({ value: 2 }) },
    ]);
    const tmpOut = resolve(os.tmpdir(), `int-cmp-thresh-${Date.now()}`);

    try {
      const result = await compareDirectories({
        baselineDir: tmpBase,
        targetDir: tmpTarget,
        outputDir: tmpOut,
        threshold: 0.5,
      });
      expect(result).toHaveProperty('pass');
      expect(result).toHaveProperty('stateDiffs');
      expect(result.screenshotDiffs).toHaveLength(0);
    } finally {
      try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(tmpTarget, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
