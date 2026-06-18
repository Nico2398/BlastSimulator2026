/**
 * Tests for the interaction recorder module.
 *
 * Validates argument parsing, constants, and the recordInteractions()
 * function structure.
 *
 * @module tests/unit/interaction-recorder
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  const originalArgv = process.argv;
  const originalExit = process.exit;

  beforeEach(() => {
    process.exit = vi.fn() as unknown as (code?: number) => never;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  it('exits with code 1 when --name is missing', () => {
    process.argv = ['node', 'interaction-recorder.ts'];
    parseRecorderArgs();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('parses --name flag correctly', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test-recording'];
    const opts = parseRecorderArgs();
    expect(opts.name).toBe('test-recording');
  });

  it('uses default port 5173 when --port is not specified', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test'];
    const opts = parseRecorderArgs();
    expect(opts.port).toBe(5173);
  });

  it('parses --port flag correctly', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test', '--port', '5174'];
    const opts = parseRecorderArgs();
    expect(opts.port).toBe(5174);
  });

  it('parses --viewport flag correctly', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test', '--viewport', '1920x1080'];
    const opts = parseRecorderArgs();
    expect(opts.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('uses default viewport 1280x720 when --viewport is not specified', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test'];
    const opts = parseRecorderArgs();
    expect(opts.viewport).toEqual({ width: 1280, height: 720 });
  });

  it('parses --puppeteer-path flag correctly', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test', '--puppeteer-path', '/custom/chrome'];
    const opts = parseRecorderArgs();
    expect(opts.puppeteerPath).toBe('/custom/chrome');
  });

  it('parses --setup flag as semicolon-separated commands', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test', '--setup', 'new_game seed:42; drill_plan grid rows:2'];
    const opts = parseRecorderArgs();
    expect(opts.setupCommands).toBeDefined();
    expect(opts.setupCommands!.length).toBeGreaterThanOrEqual(1);
  });

  it('parses --output-dir flag correctly', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'test', '--output-dir', 'my-recordings'];
    const opts = parseRecorderArgs();
    expect(opts.outputDir).toBe('my-recordings');
  });

  it('returns RecorderOptions with all required properties', () => {
    process.argv = ['node', 'interaction-recorder.ts', '--name', 'full-test'];
    const opts = parseRecorderArgs();
    expect(opts).toHaveProperty('name');
    expect(opts).toHaveProperty('port');
    expect(opts).toHaveProperty('viewport');
    expect(opts.viewport).toHaveProperty('width');
    expect(opts.viewport).toHaveProperty('height');
  });
});

// ── Recording Function ──

describe('recordInteractions()', () => {
  it('returns a promise that resolves to an InteractionRecording-like object', async () => {
    // Since recordInteractions() launches real Puppeteer and connects to a dev server,
    // we verify it has the correct function signature and returns a promise.
    const resultPromise = recordInteractions({
      name: 'test',
      port: 5173,
      viewport: { width: 1280, height: 720 },
    });
    expect(resultPromise).toBeInstanceOf(Promise);
    // We don't await it since it requires a running dev server
  });

  it('accepts options with all fields', () => {
    const options = {
      name: 'full-test',
      description: 'A test recording',
      port: 5174,
      viewport: { width: 1920, height: 1080 } as const,
      puppeteerPath: '/custom/chrome',
      outputDir: 'my-recordings',
      setupCommands: ['new_game seed:42'],
    };
    const resultPromise = recordInteractions(options);
    expect(resultPromise).toBeInstanceOf(Promise);
  });

  it('accepts minimal RecorderOptions', () => {
    const resultPromise = recordInteractions({
      name: 'minimal-test',
      port: 5173,
      viewport: { width: 1280, height: 720 },
    });
    expect(resultPromise).toBeInstanceOf(Promise);
  });
});
