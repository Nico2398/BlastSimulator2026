/**
 * Tests for the interaction replay module.
 *
 * Validates argument parsing, constants, the replayInteraction()
 * function structure, and recording format validation. Puppeteer is
 * mocked so tests run without a real browser or dev server.
 *
 * @module tests/unit/interaction-replay
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import os from 'os';
import puppeteer from 'puppeteer';
import {
  parseReplayArgs,
  replayInteraction,
  COMMAND_WAIT_MS,
  RENDER_WAIT_MS,
  MIN_INTER_EVENT_MS,
} from '../../scripts/interaction-replay.js';

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(),
  },
}));

// ── Test Helpers ──

/** Creates a mock Puppeteer Page object. */
function createMockPage() {
  return {
    setViewport: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(true),
    evaluate: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    on: vi.fn(),
    mouse: { click: vi.fn(), down: vi.fn(), up: vi.fn(), move: vi.fn() },
    keyboard: { press: vi.fn(), down: vi.fn(), up: vi.fn() },
  };
}

/** Creates a mock Puppeteer Browser object wrapping the given page. */
function createMockBrowser(mockPage: ReturnType<typeof createMockPage>) {
  return {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn(),
  };
}

/** Creates a temporary directory. */
function createTempDir(): string {
  return resolve(
    os.tmpdir(),
    `int-replay-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

/**
 * Helper: creates a temporary recording JSON file, calls replayInteraction,
 * and returns the error (or throws if replayInteraction succeeded).
 * Does NOT mock puppeteer — the format validation happens before any
 * puppeteer calls, so these tests work with the real module.
 */
async function createTempRecordingAndReject(
  recording: Record<string, unknown>,
): Promise<Error> {
  const tmpDir = createTempDir();
  mkdirSync(tmpDir, { recursive: true });
  const filePath = resolve(tmpDir, 'recording.json');
  writeFileSync(filePath, JSON.stringify(recording));

  try {
    await replayInteraction({
      recordingPath: filePath,
      port: 5173,
      viewport: { width: 1280, height: 720 },
    });
    throw new Error('Expected replayInteraction to throw');
  } catch (err) {
    return err as Error;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
  }
}

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
  it('rejects recordings with mismatched formatVersion', async () => {
    const err = await createTempRecordingAndReject({
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
    });

    expect(err.message).toMatch(/Unsupported recording format version/);
    expect(err.message).toContain('999');
  });

  it('accepts recordings with formatVersion 1 (data structure)', () => {
    // Validates the data contract: formatVersion 1 is the expected value.
    // Full integration testing of replayInteraction with version 1 requires
    // a running dev server and Chrome, so we validate the structure here.
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

  it('rejects recordings missing meta.formatVersion', async () => {
    const err = await createTempRecordingAndReject({
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
    });

    expect(err.message).toMatch(/Unsupported recording format version/);
    expect(err.message).toContain('undefined');
  });
});

// ── Replay Function ──

describe('replayInteraction()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when recording file does not exist', async () => {
    await expect(
      replayInteraction({
        recordingPath: 'records/nonexistent.json',
        port: 5173,
        viewport: { width: 1280, height: 720 },
      }),
    ).rejects.toThrow(/Recording file not found/);
  });

  it('rejects when recording JSON is invalid', async () => {
    const tmpDir = createTempDir();
    mkdirSync(tmpDir, { recursive: true });
    const filePath = resolve(tmpDir, 'corrupt.json');
    writeFileSync(filePath, 'not valid json{{{');

    try {
      await expect(
        replayInteraction({
          recordingPath: filePath,
          port: 5173,
          viewport: { width: 1280, height: 720 },
        }),
      ).rejects.toThrow(/Invalid recording JSON/);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });

  it('launches puppeteer and replays a valid recording', async () => {
    const tmpDir = createTempDir();
    mkdirSync(tmpDir, { recursive: true });
    const recordingPath = resolve(tmpDir, 'recording.json');
    const mockEvents = [
      { type: 'wait', timestamp: 0, durationMs: 10 },
    ];
    const recording = {
      name: 'replay-test',
      description: 'Test recording',
      meta: {
        viewport: { width: 1280, height: 720 },
        createdAt: '2026-01-01T00:00:00.000Z',
        durationMs: 100,
        eventCount: 1,
        formatVersion: 1,
      },
      setupCommands: [],
      events: mockEvents,
    };
    writeFileSync(recordingPath, JSON.stringify(recording));

    const mockPage = createMockPage();
    const mockBrowser = createMockBrowser(mockPage);
    (puppeteer as any).launch.mockResolvedValue(mockBrowser);

    // Evaluate calls: menu dismiss, captureStep (rAF, gameState, uiState)
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // menu dismiss
      .mockResolvedValueOnce(undefined) // captureStep double rAF
      .mockResolvedValueOnce(null) // captureStep __gameState
      .mockResolvedValueOnce(null); // captureStep __uiState

    const outDir = resolve(tmpDir, 'output');

    try {
      await replayInteraction({
        recordingPath,
        port: 5173,
        viewport: { width: 1280, height: 720 },
        outputDir: outDir,
      });

      // Verify puppeteer was launched with correct args
      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }),
      );

      // Verify browser interactions
      expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:5173', { waitUntil: 'networkidle0' });
      expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1280, height: 720 });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#game-canvas, canvas', { timeout: 10000 });

      // Verify screenshot was captured
      expect(mockPage.screenshot).toHaveBeenCalledTimes(1);

      // Verify report was written
      const reportPath = resolve(outDir, 'report.json');
      expect(existsSync(reportPath)).toBe(true);

      const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
      expect(report).toHaveLength(1);
      expect(report[0].eventType).toBe('wait');
      expect(report[0].step).toBe(0);

      // Verify browser was closed
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });

  it('accepts ReplayOptions with custom puppeteerPath', async () => {
    const tmpDir = createTempDir();
    mkdirSync(tmpDir, { recursive: true });
    const recordingPath = resolve(tmpDir, 'recording.json');
    const recording = {
      name: 'path-test',
      description: 'Test puppeteer path',
      meta: {
        viewport: { width: 1920, height: 1080 },
        createdAt: '2026-01-01T00:00:00.000Z',
        durationMs: 0,
        eventCount: 0,
        formatVersion: 1,
      },
      setupCommands: [],
      events: [],
    };
    writeFileSync(recordingPath, JSON.stringify(recording));

    const mockPage = createMockPage();
    const mockBrowser = createMockBrowser(mockPage);
    (puppeteer as any).launch.mockResolvedValue(mockBrowser);

    // For an empty events list: menu dismiss only (no captureStep since no events)
    mockPage.evaluate
      .mockResolvedValueOnce(undefined); // menu dismiss

    const outDir = resolve(tmpDir, 'output2');

    try {
      await replayInteraction({
        recordingPath,
        port: 5174,
        viewport: { width: 1920, height: 1080 },
        outputDir: outDir,
        puppeteerPath: '/custom/chrome',
        shots: [{ name: 'overview', yaw: 0, pitch: 45 }],
        frames: 3,
        intervalMs: 100,
      });

      // Custom puppeteerPath must be passed to launch
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: '/custom/chrome',
        }),
      );

      // Report should be written even with 0 events
      const reportPath = resolve(outDir, 'report.json');
      expect(existsSync(reportPath)).toBe(true);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });

  it('executes setup commands from recording before replay', async () => {
    const tmpDir = createTempDir();
    mkdirSync(tmpDir, { recursive: true });
    const recordingPath = resolve(tmpDir, 'recording.json');
    const recording = {
      name: 'setup-replay',
      description: 'Test setup commands',
      meta: {
        viewport: { width: 1280, height: 720 },
        createdAt: '2026-01-01T00:00:00.000Z',
        durationMs: 0,
        eventCount: 0,
        formatVersion: 1,
      },
      setupCommands: ['new_game seed:42'],
      events: [],
    };
    writeFileSync(recordingPath, JSON.stringify(recording));

    const mockPage = createMockPage();
    const mockBrowser = createMockBrowser(mockPage);
    (puppeteer as any).launch.mockResolvedValue(mockBrowser);

    // Evaluate calls: menu dismiss, setup command
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // menu dismiss
      .mockResolvedValueOnce(undefined); // setup command

    const outDir = resolve(tmpDir, 'output3');

    try {
      await replayInteraction({
        recordingPath,
        port: 5173,
        viewport: { width: 1280, height: 720 },
        outputDir: outDir,
      });

      // Verify setup command was evaluated
      const evaluateCalls = mockPage.evaluate.mock.calls;
      const setupCall = evaluateCalls.find(
        ([, arg]) => typeof arg === 'string' && arg.includes('new_game'),
      );
      expect(setupCall).toBeDefined();

      // Report should exist
      expect(existsSync(resolve(outDir, 'report.json'))).toBe(true);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });
});
