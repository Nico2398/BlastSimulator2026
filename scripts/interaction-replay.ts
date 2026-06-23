/**
 * BlastSimulator2026 — Interaction Replayer
 *
 * CLI script for replaying recorded interactions via Puppeteer. Reads an
 * InteractionRecording JSON file, launches the game in headless Chrome,
 * and replays every event in sequence with configurable timing.
 *
 * Supports multi-angle screenshots (--shots), animation frame capture
 * (--frames), and per-step state dump for comparison.
 *
 * Usage:
 *   npx tsx scripts/interaction-replay.ts --recording records/interactions/my-test.json
 *   npx tsx scripts/interaction-replay.ts --recording records/interactions/my-test.json --port 5174
 *   npx tsx scripts/interaction-replay.ts --recording records/interactions/my-test.json --shots "overview:0:45;closeup:90:10"
 *   npx tsx scripts/interaction-replay.ts --recording records/interactions/my-test.json --frames 3 --interval 100
 *   npx tsx scripts/interaction-replay.ts --recording records/interactions/my-test.json --viewport "1920x1080"
 *
 * Output: screenshots/replay-{name}/
 *   step-00-eventType.json   (state dump)
 *   step-00-eventType.png    (screenshot)
 *   step-00-eventType-shotname.png  (multi-angle shots)
 *   step-00-eventType-fN.png        (animation frames)
 *   report.json          (summary)
 *
 * @module interaction-replay
 */

import type {
  InteractionRecording,
  InteractionRecordEvent,
  ClickEvent,
  MouseMoveEvent,
  KeyEvent,
  ScrollEvent,
  WheelEvent,
  WaitEvent,
  AssertEvent,
  ViewportEvent,
  TypeEvent,
  WaitForSelectorEvent,
} from './interaction-types.js';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { resolveChromePath, LAUNCH_ARGS } from './shared/chrome.js';

// ── Constants ──

/** Default wait (ms) after executing a console command during replay. */
export const COMMAND_WAIT_MS = 800;

/** Default wait (ms) after a render frame is requested. */
export const RENDER_WAIT_MS = 500;

/** Minimum gap (ms) between consecutive replayed events. */
export const MIN_INTER_EVENT_MS = 50;

/** Milliseconds to wait after dismissing main menu. */
const MENU_DISMISS_MS = 300;

/** The expected format version for recording files. */
const EXPECTED_FORMAT_VERSION = 1;

/** Maps our button names to Puppeteer MouseButton values. */
const BUTTON_MAP: Record<string, 'left' | 'right' | 'middle'> = {
  left: 'left',
  right: 'right',
  middle: 'middle',
};

// ── Options ──

/**
 * Multi-angle shot definition for screenshot capture during replay.
 */
export interface ShotDef {
  name: string;
  yaw: number;
  pitch: number;
}

/**
 * Options for configuring the interaction replayer.
 */
export interface ReplayOptions {
  /** Path to the recording JSON file to replay. */
  recordingPath: string;
  /** Dev server port (default 5173). */
  port: number;
  /** Full URL override; takes precedence over port if set. */
  url?: string;
  /** Browser viewport dimensions (default 1280x720). */
  viewport: { width: number; height: number };
  /** Custom path to Chrome/Chromium executable. */
  puppeteerPath?: string;
  /** Directory to write replay output. */
  outputDir?: string;
  /** Multi-angle shot definitions captured after each step. */
  shots?: ShotDef[];
  /** Number of animation frames to capture per step (default 1). */
  frames?: number;
  /** Interval (ms) between animation frames (default 200). */
  intervalMs?: number;
}

// ── Helpers ──

/**
 * Parses the --shots argument into an array of ShotDef.
 * Format: "name:yaw:pitch;name:yaw:pitch"
 *
 * @param raw - The raw string value from --shots.
 * @returns Array of parsed shot definitions.
 */
function parseShotsArg(raw: string): ShotDef[] {
  return raw.split(';').map((s) => s.trim()).filter(Boolean).map((part) => {
    const [shotName, yawStr, pitchStr] = part.split(':');
    return {
      name: shotName ?? '',
      yaw: parseFloat(yawStr ?? '0'),
      pitch: parseFloat(pitchStr ?? '0'),
    };
  }).filter((s) => s.name && !isNaN(s.yaw) && !isNaN(s.pitch));
}

// ── Functions ──

/**
 * Parses CLI arguments into a ReplayOptions object.
 * Supports --recording, --file, --port, --url, --viewport, --puppeteer-path,
 * --shots, --frames, --interval flags.
 * Exits with code 1 on invalid input or missing required arguments.
 *
 * @returns Parsed replay options.
 */
export function parseReplayArgs(): ReplayOptions {
  const args = process.argv.slice(2);
  let recordingPath = '';
  let port = 5173;
  let url: string | undefined;
  let viewport = { width: 1280, height: 720 };
  let puppeteerPath: string | undefined;
  let outputDir: string | undefined;
  let shots: ShotDef[] | undefined;
  let frames: number | undefined;
  let intervalMs: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--recording' || arg === '--file') && i + 1 < args.length) {
      recordingPath = args[++i]!;
    } else if (arg === '--port' && i + 1 < args.length) {
      port = parseInt(args[++i]!, 10);
    } else if (arg === '--url' && i + 1 < args.length) {
      url = args[++i]!;
    } else if (arg === '--viewport' && i + 1 < args.length) {
      const parts = args[++i]!.split('x').map((v) => parseInt(v, 10));
      if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
        viewport = { width: parts[0]!, height: parts[1]! };
      } else {
        console.error(`ERROR: Invalid viewport format "${args[i]}". Expected format: WxH (e.g. 1920x1080)`);
        process.exit(1);
      }
    } else if (arg === '--puppeteer-path' && i + 1 < args.length) {
      puppeteerPath = args[++i]!;
    } else if (arg === '--output-dir' && i + 1 < args.length) {
      outputDir = args[++i]!;
    } else if (arg === '--shots' && i + 1 < args.length) {
      shots = parseShotsArg(args[++i]!);
    } else if (arg === '--frames' && i + 1 < args.length) {
      frames = parseInt(args[++i]!, 10);
    } else if (arg === '--interval' && i + 1 < args.length) {
      intervalMs = parseInt(args[++i]!, 10);
    }
  }

  if (!recordingPath) {
    console.error('ERROR: --recording or --file is required');
    process.exit(1);
  }

  const result: ReplayOptions = { recordingPath, port, viewport };
  if (url !== undefined) result.url = url;
  if (puppeteerPath !== undefined) result.puppeteerPath = puppeteerPath;
  if (outputDir !== undefined) result.outputDir = outputDir;
  if (shots !== undefined) result.shots = shots;
  if (frames !== undefined) result.frames = frames;
  if (intervalMs !== undefined) result.intervalMs = intervalMs;
  return result;
}

/**
 * Captures a screenshot and state dump for the current replay step.
 *
 * @param page - Puppeteer page object.
 * @param stepIndex - Current step index.
 * @param eventType - Type of the event being replayed.
 * @param label - Optional label for the step filename.
 * @param outDir - Directory to save files in.
 * @returns Object with screenshot path and state data.
 */
async function captureStep(
  page: puppeteer.Page,
  stepIndex: number,
  eventType: string,
  label: string | undefined,
  outDir: string,
): Promise<{ screenshotPath: string; statePath: string; stateData: Record<string, unknown> }> {
  const paddedIdx = String(stepIndex).padStart(2, '0');
  const slug = label ? `${eventType}-${label.replace(/[^a-z0-9_-]/gi, '_')}` : eventType;

  // Wait for render to settle
  await new Promise((r) => setTimeout(r, RENDER_WAIT_MS));

  // Force render frames
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => {
    requestAnimationFrame(() => r(undefined));
  })));
  await new Promise((r) => setTimeout(r, RENDER_WAIT_MS));

  // Capture screenshot
  const screenshotPath = resolve(outDir, `step-${paddedIdx}-${slug}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  // Capture state
  const gameState: Record<string, unknown> | null = await page.evaluate(() => {
    if (typeof (window as any).__gameState === 'function') {
      return (window as any).__gameState();
    }
    return null;
  });

  const uiState: Record<string, unknown> | null = await page.evaluate(() => {
    if (typeof (window as any).__uiState === 'function') {
      return (window as any).__uiState();
    }
    return null;
  });

  const stateData: Record<string, unknown> = {
    step: stepIndex,
    eventType,
    label,
    gameState,
    uiState,
  };

  const statePath = resolve(outDir, `step-${paddedIdx}-${slug}.json`);
  writeFileSync(statePath, JSON.stringify(stateData, null, 2));

  return { screenshotPath, statePath, stateData };
}

/**
 * Captures multi-angle shots for a replay step.
 *
 * @param page - Puppeteer page object.
 * @param stepIndex - Current step index.
 * @param slug - Event slug for filename.
 * @param shots - Array of shot definitions.
 * @param outDir - Directory to save files in.
 * @returns Array of captured shot file paths.
 */
async function captureShots(
  page: puppeteer.Page,
  stepIndex: number,
  slug: string,
  shots: ShotDef[],
  outDir: string,
): Promise<string[]> {
  const paddedIdx = String(stepIndex).padStart(2, '0');
  const paths: string[] = [];

  for (const shot of shots) {
    await page.evaluate(
      ({ y, p }: { y: number; p: number }) => {
        (window as any).__cameraOrbit(y, p);
      },
      { y: shot.yaw, p: shot.pitch },
    );
    await new Promise((r) => setTimeout(r, RENDER_WAIT_MS));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => {
      requestAnimationFrame(() => r(undefined));
    })));
    await new Promise((r) => setTimeout(r, RENDER_WAIT_MS));

    const shotPath = resolve(outDir, `step-${paddedIdx}-${slug}-${shot.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    paths.push(shotPath);
  }

  // Reset camera after shots
  if (shots.length > 0) {
    await page.evaluate(() => (window as any).__cameraReset());
    await new Promise((r) => setTimeout(r, RENDER_WAIT_MS));
  }

  return paths;
}

/**
 * Captures animation frames for a replay step.
 *
 * @param page - Puppeteer page object.
 * @param stepIndex - Current step index.
 * @param slug - Event slug for filename.
 * @param frames - Number of frames to capture.
 * @param intervalMs - Interval between frames in ms.
 * @param outDir - Directory to save files in.
 * @returns Array of captured frame file paths.
 */
async function captureFrames(
  page: puppeteer.Page,
  stepIndex: number,
  slug: string,
  frames: number,
  intervalMs: number,
  outDir: string,
): Promise<string[]> {
  const paddedIdx = String(stepIndex).padStart(2, '0');
  const paths: string[] = [];

  for (let f = 0; f < frames; f++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => {
      requestAnimationFrame(() => r(undefined));
    })));
    const framePath = resolve(outDir, `step-${paddedIdx}-${slug}-f${f}.png`);
    await page.screenshot({ path: framePath, fullPage: false });
    paths.push(framePath);
  }

  return paths;
}

/**
 * Replays a single interaction event on the given Puppeteer page.
 * Handles all event types: click, mousedown, mouseup, mousemove,
 * keypress, keydown, keyup, scroll, wheel, wait, assert, viewport.
 *
 * @param page - Puppeteer page object.
 * @param event - The event to replay.
 */
export async function replayEvent(
  page: puppeteer.Page,
  event: InteractionRecordEvent,
): Promise<void> {
  const eventType = event.type;

  switch (eventType) {
    case 'click': {
      const clickEvent = event as ClickEvent;
      const btn = BUTTON_MAP[clickEvent.button] ?? 'left';
      await page.mouse.click(clickEvent.x, clickEvent.y, { button: btn });
      break;
    }
    case 'mousedown': {
      const mouseDownEvent = event as ClickEvent;
      const btn = BUTTON_MAP[mouseDownEvent.button] ?? 'left';
      await page.mouse.down({ button: btn });
      break;
    }
    case 'mouseup': {
      const mouseUpEvent = event as ClickEvent;
      const btn = BUTTON_MAP[mouseUpEvent.button] ?? 'left';
      await page.mouse.up({ button: btn });
      break;
    }
    case 'mousemove': {
      const moveEvent = event as MouseMoveEvent;
      await page.mouse.move(moveEvent.x, moveEvent.y);
      break;
    }
    case 'keypress': {
      const keyPressEvent = event as KeyEvent;
      await page.keyboard.press(keyPressEvent.key);
      break;
    }
    case 'keydown': {
      const keyDownEvent = event as KeyEvent;
      await page.keyboard.down(keyDownEvent.key);
      break;
    }
    case 'keyup': {
      const keyUpEvent = event as KeyEvent;
      await page.keyboard.up(keyUpEvent.key);
      break;
    }
    case 'scroll': {
      const scrollEvent = event as ScrollEvent;
      await page.evaluate(
        (x: number, y: number) => window.scrollTo(x, y),
        scrollEvent.x,
        scrollEvent.y,
      );
      break;
    }
    case 'wheel': {
      const wheelEvent = event as WheelEvent;
      await page.evaluate(
        (evt: { x: number; y: number; deltaX: number; deltaY: number; deltaZ: number }) => {
          const wheelEvt = new WheelEvent('wheel', {
            clientX: evt.x,
            clientY: evt.y,
            deltaX: evt.deltaX,
            deltaY: evt.deltaY,
            deltaZ: evt.deltaZ,
            bubbles: true,
            cancelable: true,
          });
          document.dispatchEvent(wheelEvt);
        },
        {
          x: wheelEvent.x,
          y: wheelEvent.y,
          deltaX: wheelEvent.deltaX,
          deltaY: wheelEvent.deltaY,
          deltaZ: wheelEvent.deltaZ,
        },
      );
      break;
    }
    case 'wait': {
      const waitEvent = event as WaitEvent;
      const durationMs = waitEvent.durationMs ?? 0;
      await new Promise((r) => setTimeout(r, durationMs));
      break;
    }
    case 'assert': {
      const assertEvent = event as AssertEvent;
      console.log(`  Assert: selector=${assertEvent.selector}, eval=${assertEvent.eval}`);

      if (assertEvent.eval) {
        // Validate eval string length to prevent abuse
        if (assertEvent.eval.length > 200) {
          console.warn(`  Warning: Assert eval string is unusually long (${assertEvent.eval.length} chars). This may be a security concern.`);
        }

        try {
          const result = await page.evaluate((expr: string) => {
            try {
              // eslint-disable-next-line no-eval
              return eval(expr);
            } catch {
              return { __error: `Eval failed: ${expr}` };
            }
          }, assertEvent.eval);
          console.log(`  Assert eval result:`, result);

          if (assertEvent.expectedValue !== undefined) {
            const expected = assertEvent.expectedValue;
            const passed = JSON.stringify(result) === JSON.stringify(expected);
            if (!passed) {
              console.warn(`  Assert FAILED: expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
            }
          }
        } catch (err: unknown) {
          console.warn(`  Assert eval error:`, err);
        }
      }

      if (assertEvent.gameStatePath) {
        const stateVal = await page.evaluate((path: string) => {
          const state = typeof (window as any).__gameState === 'function'
            ? (window as any).__gameState()
            : null;
          if (!state) return null;
          return path.split('.').reduce((obj: any, key: string) => obj?.[key], state);
        }, assertEvent.gameStatePath);
        console.log(`  Game state [${assertEvent.gameStatePath}]:`, stateVal);

        if (assertEvent.expectedValue !== undefined) {
          const passed = JSON.stringify(stateVal) === JSON.stringify(assertEvent.expectedValue);
          if (!passed) {
            console.warn(`  Assert FAILED: expected ${JSON.stringify(assertEvent.expectedValue)}, got ${JSON.stringify(stateVal)}`);
          }
        }
      }

      if (assertEvent.uiStatePath) {
        const stateVal = await page.evaluate((path: string) => {
          const uiState = typeof (window as any).__uiState === 'function'
            ? (window as any).__uiState()
            : null;
          if (!uiState) return null;
          return path.split('.').reduce((obj: any, key: string) => obj?.[key], uiState);
        }, assertEvent.uiStatePath);
        console.log(`  UI state [${assertEvent.uiStatePath}]:`, stateVal);

        if (assertEvent.expectedValue !== undefined) {
          const passed = JSON.stringify(stateVal) === JSON.stringify(assertEvent.expectedValue);
          if (!passed) {
            console.warn(`  Assert FAILED: expected ${JSON.stringify(assertEvent.expectedValue)}, got ${JSON.stringify(stateVal)}`);
          }
        }
      }
      break;
    }
    case 'viewport': {
      const viewportEvent = event as ViewportEvent;
      await page.setViewport({
        width: viewportEvent.width,
        height: viewportEvent.height,
      });
      break;
    }
    case 'type': {
      const typeEvent = event as TypeEvent;
      await page.type(typeEvent.selector, typeEvent.text, { delay: typeEvent.delay });
      break;
    }
    case 'waitForSelector': {
      const waitForSelectorEvent = event as WaitForSelectorEvent;
      await page.waitForSelector(waitForSelectorEvent.selector, {
        timeout: waitForSelectorEvent.timeout ?? 10000,
      });
      break;
    }
    default:
      console.warn(`Unknown event type: ${event.type}`);
      break;
  }
}

/**
 * Loads a recording from disk and replays every interaction event in
 * sequence via Puppeteer. Captures screenshots and state dumps at each
 * step for later comparison.
 *
 * @param options - Replay configuration.
 * @returns A promise that resolves when replay completes.
 */
export async function replayInteraction(options: ReplayOptions): Promise<void> {
  // Validate recording path
  const recordingPath = resolve(process.cwd(), options.recordingPath);
  if (!existsSync(recordingPath)) {
    throw new Error(`Recording file not found: ${recordingPath}`);
  }

  // Load and parse recording
  const rawRecording = readFileSync(recordingPath, 'utf-8');
  let recording: InteractionRecording;
  try {
    recording = JSON.parse(rawRecording) as InteractionRecording;
  } catch {
    throw new Error(`Invalid recording JSON file: ${recordingPath}. The file may be corrupted or not valid JSON.`);
  }

  // Validate format version
  if (recording.meta.formatVersion !== EXPECTED_FORMAT_VERSION) {
    throw new Error(
      `Unsupported recording format version: ${recording.meta.formatVersion}. Expected: ${EXPECTED_FORMAT_VERSION}. Record the interactions again with a compatible version.`,
    );
  }

  // Set up output directory (name sanitized to prevent path traversal)
  const safeName = recording.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const defaultOutputDir = `screenshots/replay-${safeName}`;
  const outDir = resolve(process.cwd(), options.outputDir ?? defaultOutputDir);
  mkdirSync(outDir, { recursive: true });

  const devServerUrl = options.url ?? `http://localhost:${options.port}`;

  const executablePath = options.puppeteerPath
    ?? process.env.PUPPETEER_EXECUTABLE_PATH
    ?? resolveChromePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: LAUNCH_ARGS,
  });

  const stepResults: Array<{
    step: number;
    eventType: string;
    label?: string;
    screenshotPath: string;
    shotPaths: string[];
    framePaths: string[];
  }> = [];

  try {
    const page = await browser.newPage();
    await page.setViewport(options.viewport);

    console.log(`Navigating to ${devServerUrl}...`);
    await page.goto(devServerUrl, { waitUntil: 'networkidle0' });

    // Wait for game canvas
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
    console.log('Game canvas detected.');

    // Dismiss main menu
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise((r) => setTimeout(r, MENU_DISMISS_MS));

    // Execute setup commands from recording
    for (const command of recording.setupCommands) {
      console.log(`Executing setup command: ${command}`);
      await page.evaluate((cmd: string) => {
        if (typeof (window as any).__gameConsole === 'function') {
          return (window as any).__gameConsole(cmd);
        }
        return undefined;
      }, command);
      await new Promise((r) => setTimeout(r, COMMAND_WAIT_MS));
    }

    const framesCount = options.frames ?? 1;
    const framesInterval = options.intervalMs ?? 200;
    const shots = options.shots ?? [];
    let lastTimestamp = 0;

    // Replay each event
    for (let i = 0; i < recording.events.length; i++) {
      const event = recording.events[i]!;

      // Respect timing between events (minimum 50ms gap)
      if (lastTimestamp > 0 && event.timestamp) {
        const elapsed = event.timestamp - lastTimestamp;
        const waitTime = Math.max(elapsed, MIN_INTER_EVENT_MS);
        if (waitTime > 0) {
          await new Promise((r) => setTimeout(r, waitTime));
        }
      }
      lastTimestamp = event.timestamp;

      const eventType = event.type;
      const label = event.label;
      const takeScreenshot = event.screenshot !== false; // default true

      console.log(`Step ${i}: ${eventType}${label ? ` (${label})` : ''}`);

      // Delegate event execution to the reusable replay function
      await replayEvent(page, event);

      // Build event slug for filenames
      const slug = label
        ? `${eventType}-${label.replace(/[^a-z0-9_-]/gi, '_')}`
        : eventType;

      // Capture screenshot and state after each event (or when screenshot flag is set)
      if (takeScreenshot) {
        const { screenshotPath } = await captureStep(page, i, eventType, label, outDir);
        console.log(`  Screenshot: ${screenshotPath}`);

        // Multi-angle shots
        const shotPaths: string[] = [];
        if (shots.length > 0) {
          const paths = await captureShots(page, i, slug, shots, outDir);
          shotPaths.push(...paths);
          for (const p of paths) {
            console.log(`  Shot: ${p}`);
          }
        }

        // Animation frames
        const framePaths: string[] = [];
        if (framesCount > 1) {
          const paths = await captureFrames(page, i, slug, framesCount, framesInterval, outDir);
          framePaths.push(...paths);
          for (const p of paths) {
            console.log(`  Frame: ${p}`);
          }
        }

        stepResults.push({
          step: i,
          eventType,
          label,
          screenshotPath,
          shotPaths,
          framePaths,
        });
      }
    }

    // Save report
    const reportPath = resolve(outDir, 'report.json');
    const report = stepResults.map((r) => ({
      step: r.step,
      eventType: r.eventType,
      label: r.label,
      screenshot: r.screenshotPath,
      shots: r.shotPaths,
      frames: r.framePaths,
    }));
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReplay complete. Report: ${reportPath}`);
    console.log(`Replayed ${recording.events.length} events.`);
  } finally {
    await browser.close();
  }
}

/**
 * Entry point for CLI execution. Parses arguments and starts replay.
 */
async function main(): Promise<void> {
  const options = parseReplayArgs();
  await replayInteraction(options);
}

// ── CLI Entry ──

// Only run main() when executed directly, not when imported by tests
if (!process.env.VITEST) {
  main().catch((err: unknown) => {
    console.error('Replay failed:', err);
    process.exit(1);
  });
}
