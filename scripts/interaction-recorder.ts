/**
 * BlastSimulator2026 — Interaction Recorder
 *
 * CLI script for recording user interactions via Puppeteer. Launches the
 * game in headless Chrome, attaches event listeners for mouse, keyboard,
 * scroll, wheel, and viewport changes, and saves the recorded sequence
 * as an InteractionRecording JSON file.
 *
 * Usage:
 *   npx tsx scripts/interaction-recorder.ts --name "my-test"
 *   npx tsx scripts/interaction-recorder.ts --name "my-test" --port 5174
 *   npx tsx scripts/interaction-recorder.ts --name "my-test" --viewport "1920x1080"
 *   npx tsx scripts/interaction-recorder.ts --name "my-test" --setup "new_game seed:42"
 *
 * Output: records/interactions/{name}.json
 *
 * @module interaction-recorder
 */

import type { InteractionRecording, InteractionRecordEvent } from './interaction-types.js';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Constants ──

/** Throttle interval (ms) between consecutive mousemove events. */
export const MOVE_THROTTLE_MS = 50;

/** Throttle interval (ms) between consecutive wheel events. */
export const WHEEL_THROTTLE_MS = 100;

/** Milliseconds to wait after dismissing the main menu. */
const MENU_DISMISS_MS = 300;

/** MS between polls for recording completion flag. */
const RECORD_POLL_MS = 200;

/** Maximum recording duration (5 minutes). */
const MAX_RECORD_DURATION_MS = 5 * 60 * 1000;

// ── Options ──

/**
 * Options for configuring the interaction recorder.
 */
export interface RecorderOptions {
  /** Name of the recording (used for filename and metadata). */
  name: string;
  /** Optional description of the recording scenario. */
  description?: string;
  /** Dev server port (default 5173). */
  port: number;
  /** Full URL override; takes precedence over port if set. */
  url?: string;
  /** Browser viewport dimensions (default 1280x720). */
  viewport: { width: number; height: number };
  /** Custom path to Chrome/Chromium executable. */
  puppeteerPath?: string;
  /** Directory to write recording file (default records/). */
  outputDir?: string;
  /** Console commands to execute before recording begins. */
  setupCommands?: string[];
}

// ── Helpers ──

/**
 * Resolves the Chrome/Chromium executable path from well-known locations.
 * @returns The path if found, or undefined.
 */
function resolveChromePath(): string | undefined {
  const candidates = [
    ...(process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : [
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/google-chrome',
          '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
        ]),
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * Builds an InteractionRecordEvent from a DOM MouseEvent.
 * @param type - The event type discriminant.
 * @param e - The DOM mouse event.
 * @returns A serializable interaction event.
 */
function mouseEventToRecord(
  type: 'click' | 'mousedown' | 'mouseup',
  e: MouseEvent,
): InteractionRecordEvent {
  return {
    type,
    timestamp: Date.now(),
    x: e.clientX,
    y: e.clientY,
    button: e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle',
    modifiers: {
      ctrl: e.ctrlKey || false,
      shift: e.shiftKey || false,
      alt: e.altKey || false,
      meta: e.metaKey || false,
    },
  } as InteractionRecordEvent;
}

/**
 * Builds an InteractionRecordEvent from a DOM KeyboardEvent.
 * @param type - The event type discriminant.
 * @param e - The DOM keyboard event.
 * @returns A serializable interaction event.
 */
function keyboardEventToRecord(
  type: 'keypress' | 'keydown' | 'keyup',
  e: KeyboardEvent,
): InteractionRecordEvent {
  return {
    type,
    timestamp: Date.now(),
    key: e.key,
    code: e.code,
    modifiers: {
      ctrl: e.ctrlKey || false,
      shift: e.shiftKey || false,
      alt: e.altKey || false,
      meta: e.metaKey || false,
    },
  } as InteractionRecordEvent;
}

// ── Functions ──

/**
 * Parses CLI arguments into a RecorderOptions object.
 * Supports --name, --description, --port, --url, --viewport, --puppeteer-path,
 * --setup, --output-dir flags.
 * Exits with code 1 if --name is missing.
 *
 * @returns Parsed recorder options.
 */
export function parseRecorderArgs(): RecorderOptions {
  const args = process.argv.slice(2);
  let name = '';
  let description: string | undefined;
  let port = 5173;
  let url: string | undefined;
  let viewport = { width: 1280, height: 720 };
  let puppeteerPath: string | undefined;
  let outputDir: string | undefined;
  let setupCommands: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--name' && i + 1 < args.length) {
      name = args[++i]!;
    } else if (arg === '--description' && i + 1 < args.length) {
      description = args[++i]!;
    } else if (arg === '--port' && i + 1 < args.length) {
      port = parseInt(args[++i]!, 10);
    } else if (arg === '--url' && i + 1 < args.length) {
      url = args[++i]!;
    } else if (arg === '--viewport' && i + 1 < args.length) {
      const parts = args[++i]!.split('x').map((v) => parseInt(v, 10));
      if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
        viewport = { width: parts[0]!, height: parts[1]! };
      } else {
        console.error(`Invalid viewport format: ${args[i]}. Use WxH (e.g. 1920x1080)`);
        process.exit(1);
      }
    } else if (arg === '--puppeteer-path' && i + 1 < args.length) {
      puppeteerPath = args[++i]!;
    } else if (arg === '--setup' && i + 1 < args.length) {
      setupCommands = args[++i]!.split(';').map((c) => c.trim()).filter(Boolean);
    } else if (arg === '--output-dir' && i + 1 < args.length) {
      outputDir = args[++i]!;
    }
  }

  if (!name) {
    console.error('ERROR: --name is required');
    process.exit(1);
  }

  const result: RecorderOptions = { name, port, viewport };
  if (description !== undefined) result.description = description;
  if (url !== undefined) result.url = url;
  if (puppeteerPath !== undefined) result.puppeteerPath = puppeteerPath;
  if (outputDir !== undefined) result.outputDir = outputDir;
  if (setupCommands !== undefined) result.setupCommands = setupCommands;
  return result;
}

/**
 * Injects event listeners into the page that record all interactions
 * into `window.__recordingBuffer`. Each listener serializes the event
 * into the appropriate InteractionRecordEvent shape with a timestamp.
 * Mousemove and wheel are throttled to MOVE_THROTTLE_MS / WHEEL_THROTTLE_MS.
 * Pressing Escape sets `window.__recordingComplete = true`.
 *
 * This function is evaluated in-page via page.evaluate.
 */
function injectEventListenersCode(): string {
  return `
    (function() {
      if (window.__recordingBuffer) return; // already injected

      const buffer = [];
      window.__recordingBuffer = buffer;
      window.__recordingComplete = false;

      const MOVE_THROTTLE = ${MOVE_THROTTLE_MS};
      const WHEEL_THROTTLE = ${WHEEL_THROTTLE_MS};
      let lastMoveTime = 0;
      let lastWheelTime = 0;

      function mouseEvent(type, e) {
        var button = 'left';
        if (e.button === 2) button = 'right';
        else if (e.button === 1) button = 'middle';
        buffer.push({
          type: type,
          timestamp: Date.now(),
          x: e.clientX,
          y: e.clientY,
          button: button,
          modifiers: { ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey, meta: !!e.metaKey }
        });
      }

      document.addEventListener('click', function(e) { mouseEvent('click', e); }, true);
      document.addEventListener('mousedown', function(e) { mouseEvent('mousedown', e); }, true);
      document.addEventListener('mouseup', function(e) { mouseEvent('mouseup', e); }, true);

      document.addEventListener('mousemove', function(e) {
        var now = Date.now();
        if (now - lastMoveTime < MOVE_THROTTLE) return;
        lastMoveTime = now;
        buffer.push({ type: 'mousemove', timestamp: now, x: e.clientX, y: e.clientY });
      }, true);

      document.addEventListener('keydown', function(e) {
        buffer.push({
          type: 'keydown', timestamp: Date.now(), key: e.key, code: e.code,
          modifiers: { ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey, meta: !!e.metaKey }
        });
        if (e.key === 'Escape') {
          window.__recordingComplete = true;
        }
      }, true);

      document.addEventListener('keyup', function(e) {
        buffer.push({
          type: 'keyup', timestamp: Date.now(), key: e.key, code: e.code,
          modifiers: { ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey, meta: !!e.metaKey }
        });
      }, true);

      document.addEventListener('keypress', function(e) {
        buffer.push({
          type: 'keypress', timestamp: Date.now(), key: e.key, code: e.code,
          modifiers: { ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey, meta: !!e.metaKey }
        });
      }, true);

      document.addEventListener('wheel', function(e) {
        var now = Date.now();
        if (now - lastWheelTime < WHEEL_THROTTLE) return;
        lastWheelTime = now;
        buffer.push({
          type: 'wheel', timestamp: now,
          x: e.clientX, y: e.clientY,
          deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ
        });
      }, true);

      document.addEventListener('scroll', function() {
        buffer.push({
          type: 'scroll', timestamp: Date.now(),
          x: window.scrollX, y: window.scrollY
        });
      }, true);

      // Viewport tracking via resize
      var lastVw = window.innerWidth, lastVh = window.innerHeight;
      window.addEventListener('resize', function() {
        var w = window.innerWidth, h = window.innerHeight;
        if (w !== lastVw || h !== lastVh) {
          lastVw = w; lastVh = h;
          buffer.push({ type: 'viewport', timestamp: Date.now(), width: w, height: h });
        }
      }, true);
    })();
  `;
}

/**
 * Launches Puppeteer, attaches to the game, and records all user
 * interactions until the user signals completion (Escape key or
 * maximum duration reached).
 *
 * @param options - Recording configuration.
 * @returns A promise that resolves to the recorded InteractionRecording.
 */
export async function recordInteractions(options: RecorderOptions): Promise<InteractionRecording> {
  const outputDir = options.outputDir ?? 'records';
  const interactionsDir = resolve(process.cwd(), outputDir, 'interactions');
  mkdirSync(interactionsDir, { recursive: true });

  const devServerUrl = options.url ?? `http://localhost:${options.port}`;

  const executablePath = options.puppeteerPath
    ?? process.env.PUPPETEER_EXECUTABLE_PATH
    ?? resolveChromePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const startTime = Date.now();

  try {
    const page = await browser.newPage();
    await page.setViewport(options.viewport);

    console.log(`Navigating to ${devServerUrl}...`);
    await page.goto(devServerUrl, { waitUntil: 'networkidle0' });

    // Wait for the game canvas to be present
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
    console.log('Game canvas detected.');

    // Dismiss main menu
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise((r) => setTimeout(r, MENU_DISMISS_MS));

    // Execute setup commands
    if (options.setupCommands) {
      for (const command of options.setupCommands) {
        console.log(`Executing setup command: ${command}`);
        await page.evaluate((cmd: string) => {
          if (typeof (window as any).__gameConsole === 'function') {
            return (window as any).__gameConsole(cmd);
          }
          console.warn('__gameConsole not available');
          return undefined;
        }, command);
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    // Inject event listeners
    await page.evaluate(injectEventListenersCode());
    console.log('Event listeners injected. Recording... (press Escape to stop)');

    // Poll until recording is complete (Escape key pressed or timeout)
    const maxDuration = MAX_RECORD_DURATION_MS;
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > maxDuration) {
        console.log('Maximum recording duration reached. Stopping.');
        break;
      }

      const isComplete = await page.evaluate(() => {
        return !!(window as any).__recordingComplete;
      });

      if (isComplete) {
        console.log('Recording stopped by Escape key.');
        break;
      }

      await new Promise((r) => setTimeout(r, RECORD_POLL_MS));
    }

    // Extract the recorded events
    const events: InteractionRecordEvent[] = await page.evaluate(() => {
      return (window as any).__recordingBuffer ?? [];
    });

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    const recording: InteractionRecording = {
      name: options.name,
      description: options.description ?? '',
      meta: {
        viewport: { width: options.viewport.width, height: options.viewport.height },
        createdAt: new Date().toISOString(),
        durationMs,
        eventCount: events.length,
        formatVersion: 1,
      },
      setupCommands: options.setupCommands ?? [],
      events,
    };

    // Save recording to file
    const recordingPath = resolve(interactionsDir, `${options.name}.json`);
    writeFileSync(recordingPath, JSON.stringify(recording, null, 2));
    console.log(`Recording saved: ${recordingPath}`);
    console.log(`Recorded ${events.length} events over ${durationMs}ms`);

    return recording;
  } finally {
    await browser.close();
  }
}

/**
 * Entry point for CLI execution. Parses arguments and starts recording.
 */
async function main(): Promise<void> {
  const options = parseRecorderArgs();
  await recordInteractions(options);
}

// ── CLI Entry ──

// Only run main() when executed directly, not when imported by tests
if (!process.env.VITEST) {
  main().catch((err: unknown) => {
    console.error('Recording failed:', err);
    process.exit(1);
  });
}
