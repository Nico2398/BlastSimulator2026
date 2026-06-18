/**
 * Tests for the interaction recorder module.
 *
 * Validates argument parsing, constants, and the recordInteractions()
 * function. Since recordInteractions() requires Puppeteer it is tested
 * by verifying that the stub throws 'Not implemented'.
 *
 * @module tests/unit/interaction-recorder
 */

import { describe, it, expect } from 'vitest';
import {
  parseRecorderArgs,
  recordInteractions,
  MOVE_THROTTLE_MS,
  WHEEL_THROTTLE_MS,
} from '../../scripts/interaction-recorder.js';

// ── Constants ──

describe('Recorder constants', () => {
  it('MOVE_THROTTLE_MS is 50', () => {
    expect(MOVE_THROTTLE_MS).toBe(50);
  });

  it('WHEEL_THROTTLE_MS is 100', () => {
    expect(WHEEL_THROTTLE_MS).toBe(100);
  });

  it('MOVE_THROTTLE_MS is a positive integer', () => {
    expect(Number.isInteger(MOVE_THROTTLE_MS)).toBe(true);
    expect(MOVE_THROTTLE_MS).toBeGreaterThan(0);
  });

  it('WHEEL_THROTTLE_MS is a positive integer', () => {
    expect(Number.isInteger(WHEEL_THROTTLE_MS)).toBe(true);
    expect(WHEEL_THROTTLE_MS).toBeGreaterThan(0);
  });

  it('WHEEL_THROTTLE_MS is greater than MOVE_THROTTLE_MS', () => {
    expect(WHEEL_THROTTLE_MS).toBeGreaterThan(MOVE_THROTTLE_MS);
  });
});

// ── Argument Parsing ──

describe('parseRecorderArgs()', () => {
  it('throws "Not implemented" when called (stub)', () => {
    expect(() => parseRecorderArgs()).toThrow('Not implemented');
  });

  it('parses --name flag correctly when implemented', () => {
    // This test will fail until parseRecorderArgs is implemented.
    // It documents expected behavior: --name should set options.name.
    try {
      const opts = parseRecorderArgs();
      // If it doesn't throw, validate behavior
      expect(opts).toHaveProperty('name');
    } catch {
      // Expected: stub throws — re-throw to keep test failing
      throw new Error('Not implemented');
    }
  });

  it('parses --viewport flag correctly when implemented', () => {
    try {
      const opts = parseRecorderArgs();
      expect(opts.viewport).toHaveProperty('width');
      expect(opts.viewport).toHaveProperty('height');
    } catch {
      throw new Error('Not implemented');
    }
  });
});

// ── Recording Function ──

describe('recordInteractions()', () => {
  it('throws "Not implemented" when called (stub)', async () => {
    await expect(
      recordInteractions({
        name: 'test',
        port: 5173,
        viewport: { width: 1280, height: 720 },
      }),
    ).rejects.toThrow('Not implemented');
  });

  it('returns a valid InteractionRecording when implemented', async () => {
    const options = {
      name: 'my-test',
      description: 'A test recording',
      port: 5173,
      viewport: { width: 1920, height: 1080 },
      setupCommands: ['new_game seed:42'],
    };

    try {
      const recording = await recordInteractions(options);
      expect(recording).toHaveProperty('name');
      expect(recording).toHaveProperty('meta');
      expect(recording.meta).toHaveProperty('formatVersion');
      expect(Array.isArray(recording.events)).toBe(true);
      expect(Array.isArray(recording.setupCommands)).toBe(true);
    } catch {
      throw new Error('Not implemented');
    }
  });

  it('accepts minimal RecorderOptions without optional fields', async () => {
    try {
      const recording = await recordInteractions({
        name: 'minimal-test',
        port: 5173,
        viewport: { width: 1280, height: 720 },
      });
      expect(recording).toBeDefined();
    } catch {
      throw new Error('Not implemented');
    }
  });
});
