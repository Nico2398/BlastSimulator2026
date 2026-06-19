/**
 * Tests for the interaction recorder module.
 *
 * Validates argument parsing, constants, and the recordInteractions()
 * function structure. Puppeteer is mocked so tests run without a real
 * browser or dev server.
 *
 * @module tests/unit/interaction-recorder
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { resolve } from 'path';
import os from 'os';
import puppeteer from 'puppeteer';
import {
  parseRecorderArgs,
  recordInteractions,
  MOVE_THROTTLE_MS,
  WHEEL_THROTTLE_MS,
} from '../../scripts/interaction-recorder.js';

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

/** Creates a temporary directory for recording output. */
function createTempDir(): string {
  return resolve(
    os.tmpdir(),
    `int-rec-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records interactions and returns a formatted InteractionRecording', async () => {
    const mockEvents = [
      { type: 'click', timestamp: 100, x: 100, y: 200, button: 'left', modifiers: {} },
    ];

    const mockPage = createMockPage();
    const mockBrowser = createMockBrowser(mockPage);
    (puppeteer as any).launch.mockResolvedValue(mockBrowser);

    // Set up evaluate sequence: menu dismiss, inject listeners, poll (false→true), extract
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // menu dismiss
      .mockResolvedValueOnce(undefined) // inject listeners
      .mockResolvedValueOnce(false) // first poll — not complete
      .mockResolvedValueOnce(true) // second poll — complete
      .mockResolvedValueOnce(mockEvents); // extract buffer

    const tmpDir = createTempDir();

    try {
      const result = await recordInteractions({
        name: 'rec-test',
        port: 5173,
        viewport: { width: 1280, height: 720 },
        outputDir: tmpDir,
      });

      expect(result.name).toBe('rec-test');
      expect(result.meta.formatVersion).toBe(1);
      expect(result.events).toEqual(mockEvents);
      expect(result.setupCommands).toEqual([]);
      expect(result.meta.eventCount).toBe(mockEvents.length);

      // Verify recording file was written to disk
      const recordingPath = resolve(tmpDir, 'interactions', 'rec-test.json');
      expect(existsSync(recordingPath)).toBe(true);

      const savedRecording = JSON.parse(readFileSync(recordingPath, 'utf-8'));
      expect(savedRecording.name).toBe('rec-test');
      expect(savedRecording.events).toHaveLength(1);
      expect(savedRecording.meta.formatVersion).toBe(1);

      // Verify puppeteer interaction
      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }),
      );
      expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:5173', { waitUntil: 'networkidle0' });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#game-canvas, canvas', { timeout: 10000 });
      expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1280, height: 720 });
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });

  it('executes setup commands during recording', async () => {
    const mockEvents: Array<Record<string, unknown>> = [];

    const mockPage = createMockPage();
    const mockBrowser = createMockBrowser(mockPage);
    (puppeteer as any).launch.mockResolvedValue(mockBrowser);

    // Sequence: menu dismiss, setup command, inject listeners, poll false, poll true, extract
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // menu dismiss
      .mockResolvedValueOnce(undefined) // setup command
      .mockResolvedValueOnce(undefined) // inject listeners
      .mockResolvedValueOnce(false) // first poll
      .mockResolvedValueOnce(true) // second poll — complete
      .mockResolvedValueOnce(mockEvents); // extract

    const tmpDir = createTempDir();

    try {
      const result = await recordInteractions({
        name: 'setup-test',
        port: 5173,
        viewport: { width: 1280, height: 720 },
        outputDir: tmpDir,
        setupCommands: ['new_game seed:42'],
      });

      expect(result.setupCommands).toEqual(['new_game seed:42']);
      expect(result.events).toEqual([]);
      expect(result.meta.eventCount).toBe(0);

      // Verify evaluate was called with the setup command string
      const evaluateCalls = mockPage.evaluate.mock.calls;
      const setupCall = evaluateCalls.find(
        ([, arg]) => typeof arg === 'string' && arg.includes('new_game'),
      );
      expect(setupCall).toBeDefined();
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });

  it('accepts RecorderOptions with all optional fields', async () => {
    const mockPage = createMockPage();
    const mockBrowser = createMockBrowser(mockPage);
    (puppeteer as any).launch.mockResolvedValue(mockBrowser);

    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // menu dismiss
      .mockResolvedValueOnce(undefined) // setup command 1
      .mockResolvedValueOnce(undefined) // setup command 2
      .mockResolvedValueOnce(undefined) // inject listeners
      .mockResolvedValueOnce(false) // first poll
      .mockResolvedValueOnce(true) // second poll
      .mockResolvedValueOnce([]); // extract

    const tmpDir = createTempDir();

    try {
      const result = await recordInteractions({
        name: 'full-options-test',
        description: 'A test recording with all fields',
        port: 5174,
        viewport: { width: 1920, height: 1080 },
        outputDir: tmpDir,
        puppeteerPath: '/custom/chrome',
        setupCommands: ['new_game seed:42', 'drill_plan grid rows:2'],
      });

      expect(result.name).toBe('full-options-test');
      expect(result.description).toBe('A test recording with all fields');
      expect(result.setupCommands).toHaveLength(2);
      expect(result.meta.viewport).toEqual({ width: 1920, height: 1080 });

      // Custom puppeteerPath should be passed to launch
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: '/custom/chrome',
        }),
      );
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });

  it('sanitizes recording names for filesystem safety', async () => {
    const mockPage = createMockPage();
    const mockBrowser = createMockBrowser(mockPage);
    (puppeteer as any).launch.mockResolvedValue(mockBrowser);

    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // menu dismiss
      .mockResolvedValueOnce(undefined) // inject listeners
      .mockResolvedValueOnce(false) // first poll
      .mockResolvedValueOnce(true) // second poll
      .mockResolvedValueOnce([]); // extract

    const tmpDir = createTempDir();

    try {
      const result = await recordInteractions({
        name: 'unsafe/name:with*chars<>|',
        port: 5173,
        viewport: { width: 1280, height: 720 },
        outputDir: tmpDir,
      });

      // The name in metadata should be the original
      expect(result.name).toBe('unsafe/name:with*chars<>|');

      // The file on disk should use the sanitized version
      const interactionsDir = resolve(tmpDir, 'interactions');
      const files = readdirSync(interactionsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      expect(jsonFiles).toHaveLength(1);

      // Sanitization replaces non-alphanumeric (except - and _) with _
      expect(jsonFiles[0]).toBe('unsafe_name_with_chars___.json');
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  });
});
