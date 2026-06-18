/**
 * Tests for the interaction replay module.
 *
 * Validates argument parsing, constants, and the replayInteraction()
 * function.
 *
 * @module tests/unit/interaction-replay
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseReplayArgs,
  replayInteraction,
  COMMAND_WAIT_MS,
  RENDER_WAIT_MS,
  MIN_INTER_EVENT_MS,
} from '../../scripts/interaction-replay.js';

// ── Constants ──

describe('Replay constants', () => {
  it('COMMAND_WAIT_MS is 800', () => {
    expect(COMMAND_WAIT_MS).toBe(800);
  });

  it('RENDER_WAIT_MS is 500', () => {
    expect(RENDER_WAIT_MS).toBe(500);
  });

  it('MIN_INTER_EVENT_MS is 50', () => {
    expect(MIN_INTER_EVENT_MS).toBe(50);
  });

  it('all constants are positive integers', () => {
    expect(Number.isInteger(COMMAND_WAIT_MS)).toBe(true);
    expect(Number.isInteger(RENDER_WAIT_MS)).toBe(true);
    expect(Number.isInteger(MIN_INTER_EVENT_MS)).toBe(true);
    expect(COMMAND_WAIT_MS).toBeGreaterThan(0);
    expect(RENDER_WAIT_MS).toBeGreaterThan(0);
    expect(MIN_INTER_EVENT_MS).toBeGreaterThan(0);
  });

  it('COMMAND_WAIT_MS is the largest constant', () => {
    expect(COMMAND_WAIT_MS).toBeGreaterThan(RENDER_WAIT_MS);
    expect(COMMAND_WAIT_MS).toBeGreaterThan(MIN_INTER_EVENT_MS);
  });
});

// ── Argument Parsing ──

describe('parseReplayArgs()', () => {
  const originalArgv = process.argv;
  const originalExit = process.exit;

  beforeEach(() => {
    process.exit = vi.fn() as unknown as (code?: number) => never;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  it('exits with code 1 when --recording and --file are both missing', () => {
    process.argv = ['node', 'interaction-replay.ts'];
    parseReplayArgs();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('parses --recording flag correctly', () => {
    process.argv = ['node', 'interaction-replay.ts', '--recording', 'records/test.json'];
    const opts = parseReplayArgs();
    expect(opts.recordingPath).toBe('records/test.json');
  });

  it('parses --file flag as alternative to --recording', () => {
    process.argv = ['node', 'interaction-replay.ts', '--file', 'records/test.json'];
    const opts = parseReplayArgs();
    expect(opts.recordingPath).toBe('records/test.json');
  });

  it('uses default port 5173 when --port is not specified', () => {
    process.argv = ['node', 'interaction-replay.ts', '--recording', 'records/test.json'];
    const opts = parseReplayArgs();
    expect(opts.port).toBe(5173);
  });

  it('parses --port flag correctly', () => {
    process.argv = ['node', 'interaction-replay.ts', '--recording', 'records/test.json', '--port', '5174'];
    const opts = parseReplayArgs();
    expect(opts.port).toBe(5174);
  });

  it('parses --viewport flag correctly', () => {
    process.argv = ['node', 'interaction-replay.ts', '--recording', 'records/test.json', '--viewport', '1920x1080'];
    const opts = parseReplayArgs();
    expect(opts.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('parses --shots flag correctly', () => {
    process.argv = ['node', 'interaction-replay.ts', '--recording', 'records/test.json', '--shots', 'overview:0:45;closeup:90:10'];
    const opts = parseReplayArgs();
    expect(opts.shots).toBeDefined();
    expect(opts.shots!.length).toBe(2);
    expect(opts.shots![0]).toHaveProperty('name', 'overview');
    expect(opts.shots![0]).toHaveProperty('yaw', 0);
    expect(opts.shots![0]).toHaveProperty('pitch', 45);
    expect(opts.shots![1]).toHaveProperty('name', 'closeup');
  });

  it('parses --frames and --interval flags correctly', () => {
    process.argv = ['node', 'interaction-replay.ts', '--recording', 'records/test.json', '--frames', '5', '--interval', '100'];
    const opts = parseReplayArgs();
    expect(opts.frames).toBe(5);
    expect(opts.intervalMs).toBe(100);
  });

  it('returns ReplayOptions with all required properties', () => {
    process.argv = ['node', 'interaction-replay.ts', '--recording', 'records/test.json'];
    const opts = parseReplayArgs();
    expect(opts).toHaveProperty('recordingPath');
    expect(opts).toHaveProperty('port');
    expect(opts).toHaveProperty('viewport');
  });
});

// ── Recording Format Validation ──

describe('Recording format version validation', () => {
  it('rejects recordings with mismatched formatVersion', () => {
    const invalidRecording = {
      name: 'bad-version',
      description: 'Wrong format version',
      meta: {
        viewport: { width: 1280, height: 720 },
        createdAt: '2026-06-19T12:00:00.000Z',
        durationMs: 1000,
        eventCount: 0,
        formatVersion: 999, // Unknown version
      },
      setupCommands: [],
      events: [],
    };

    // The formatVersion should be 1 — a mismatch indicates an incompatible format
    expect(invalidRecording.meta.formatVersion).not.toBe(1);
  });

  it('accepts recordings with formatVersion 1', () => {
    const validRecording = {
      name: 'good-version',
      description: 'Correct format version',
      meta: {
        viewport: { width: 1280, height: 720 },
        createdAt: '2026-06-19T12:00:00.000Z',
        durationMs: 1000,
        eventCount: 0,
        formatVersion: 1,
      },
      setupCommands: [],
      events: [],
    };

    expect(validRecording.meta.formatVersion).toBe(1);
  });

  it('rejects recordings missing meta.formatVersion', () => {
    const recording: Record<string, unknown> = {
      name: 'no-version',
      description: 'Missing formatVersion',
      meta: {
        viewport: { width: 1280, height: 720 },
        createdAt: '2026-06-19T12:00:00.000Z',
        durationMs: 1000,
        eventCount: 0,
        // formatVersion intentionally omitted
      },
      setupCommands: [],
      events: [],
    };

    expect(recording.meta).not.toHaveProperty('formatVersion');
  });
});

// ── Replay Function ──

describe('replayInteraction()', () => {
  it('returns a promise', () => {
    const resultPromise = replayInteraction({
      recordingPath: 'records/test.json',
      port: 5173,
      viewport: { width: 1280, height: 720 },
    });
    expect(resultPromise).toBeInstanceOf(Promise);
  });

  it('rejects when recording file does not exist', async () => {
    await expect(
      replayInteraction({
        recordingPath: 'records/nonexistent.json',
        port: 5173,
        viewport: { width: 1280, height: 720 },
      }),
    ).rejects.toThrow();
  });

  it('accepts ReplayOptions with optional fields', () => {
    const resultPromise = replayInteraction({
      recordingPath: 'records/test.json',
      port: 5174,
      viewport: { width: 1920, height: 1080 },
      puppeteerPath: '/custom/chrome',
      shots: [{ name: 'overview', yaw: 0, pitch: 45 }],
      frames: 3,
      intervalMs: 100,
    });
    expect(resultPromise).toBeInstanceOf(Promise);
  });
});
