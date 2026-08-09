/**
 * BlastSimulator2026 — Shared Puppeteer Utilities
 *
 * Common Puppeteer browser initialization and interaction step execution
 * functions shared between scenario-interaction-runner.ts and
 * run-all-scenarios.ts to avoid code duplication.
 *
 * @module shared/puppeteer-utils
 */

import puppeteer from 'puppeteer';
import type { Browser, Page, PuppeteerLaunchOptions } from 'puppeteer';
import { resolve } from 'path';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './chrome.js';
import { executeActionOnPage } from './interaction-executor.js';
import type { ScenarioStepDef } from './scenario-types.js';

/** Default timeout for scenario steps in seconds. */
export const DEFAULT_STEP_TIMEOUT = 60;

/** Screenshot directory path. */
export const SCREENSHOT_DIR = resolve(import.meta.dirname ?? process.cwd(), '..', '..', 'screenshots');

/**
 * Pause after a UI-mutating action so the next frame's `uiManager.update` runs
 * before the following action depends on it. 200 ms is the floor at which the
 * surveyor-hire race clears locally; 300 ms leaves margin for a slower CI
 * runner. Only the actions below pay it — reads and explicit waits already
 * block, and commands run synchronously in the game, not the DOM.
 */
const INTERACTION_SETTLE_MS = 300;
const SETTLE_AFTER = new Set([
  'click', 'clickSelector', 'pickTile', 'dragTiles', 'mousedown', 'mouseup', 'type',
]);

/**
 * Browser initialization options.
 */
export interface BrowserInitOptions {
  port: number;
  puppeteerPath?: string;
  viewport?: { width: number; height: number };
}

/**
 * Result from browser initialization.
 */
export interface BrowserInitResult {
  browser: Browser;
  page: Page;
}

/**
 * Initialize a Puppeteer browser with a page navigated to the dev server.
 * Handles browser launch, page creation, viewport setup, navigation,
 * and menu dismissal.
 *
 * @param options - Browser initialization options.
 * @returns Browser and page objects.
 */
export async function initBrowser(options: BrowserInitOptions): Promise<BrowserInitResult> {
  const { port, puppeteerPath, viewport = { width: 1280, height: 720 } } = options;
  const launchOptions: PuppeteerLaunchOptions = {
    headless: true,
    args: LAUNCH_ARGS,
    executablePath: puppeteerPath ?? resolveChromePathOrThrow(),
  };

  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  await page.setViewport(viewport);

  // `scenarioMode=1` tells main.ts to skip its own real-time auto-tick loop —
  // a Puppeteer-driven run only advances simulation time via scripted `tick N`
  // commands, so checkpoints stay reproducible instead of racing wall-clock
  // time spent on clicks, waits, and screenshots (#406).
  const devServerUrl = `http://localhost:${port}/?scenarioMode=1`;
  console.log(`Navigating to ${devServerUrl}...`);
  // 'networkidle0' never resolves once the post-processing composer
  // (EffectComposer + OutputPass, #458 T5.1) is in the render loop — root
  // cause not fully pinned down after investigation, but consistently
  // reproducible and unrelated to any actual pending request (confirmed via
  // request-tracking: 0 pending at timeout). 'domcontentloaded' plus the
  // canvas-selector wait immediately below is the real readiness signal
  // anyway and has proven reliable in every manual repro.
  await page.goto(devServerUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
  console.log('Game canvas detected. Waiting for initialization...');

  // The main menu overlay starts visible, same as a real player would see it.
  // Scenarios that begin with `new_game` tear it down themselves the moment
  // that command runs (see main.ts's console bridge) — forcing it hidden
  // here, before any scenario step executes, broke scenarios that inspect
  // the menu itself (main-menu-visual.json, #408).

  return { browser, page };
}

/**
 * Interaction step execution result.
 */
export interface InteractionStepResult {
  commandOutput: string;
  gameState: Record<string, unknown> | null;
  uiState: Record<string, unknown> | null;
  screenshotPaths: string[];
}

/**
 * Execute interaction actions for a single scenario step.
 * Handles action execution, screenshot capture, and state extraction.
 *
 * @param page - Puppeteer page object.
 * @param step - The scenario step to execute.
 * @param enableScreenshots - Whether to capture screenshots.
 * @param outDir - Output directory for screenshots.
 * @param paddedIdx - Zero-padded step index for filenames.
 * @param cmdSlug - Command slug for filenames.
 * @returns Interaction step result with state and screenshots.
 */
export async function executeInteractionActions(
  page: Page,
  step: ScenarioStepDef,
  enableScreenshots: boolean,
  outDir: string,
  paddedIdx: string,
  cmdSlug: string,
): Promise<InteractionStepResult> {
  const screenshotPaths: string[] = [];
  let screenshotIndex = 0;

  if (!step.interaction || step.interaction.length === 0) {
    console.warn(`  Step: interaction mode but no interaction defined, skipping.`);
    return { commandOutput: '', gameState: null, uiState: null, screenshotPaths };
  }

  // Execute interaction actions
  for (const action of step.interaction) {
    if (action.type === 'screenshot' && enableScreenshots) {
      const ssPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-ss${screenshotIndex}.png`);
      await captureFrame(page, ssPath);
      screenshotPaths.push(ssPath);
      console.log(`  Screenshot [${screenshotIndex}]: ${ssPath}`);
      screenshotIndex++;
    } else if (action.type !== 'screenshot') {
      await executeActionOnPage(page, action, step);
      // A click that mutates the DOM — opening a panel, then clicking a control
      // inside it — needs the panel's next-frame `uiManager.update` to run
      // before the following action reads or clicks that control. The playtest
      // driver settles after every action for exactly this; the interaction
      // scenarios did not, so a hire button clicked in the same beat its panel
      // opened fired against a not-yet-live control and the click was lost
      // (the tutorial-interactive surveyor hire, which stalled the whole run).
      // Only the mutating actions pay it; reads and explicit waits do not.
      if (SETTLE_AFTER.has(action.type)) {
        await new Promise(r => setTimeout(r, INTERACTION_SETTLE_MS));
      }
    }
  }

  // Reset tick accumulator
  await page.evaluate(() => {
    if (typeof (window as any).__resetTickAccumulator === 'function') {
      (window as any).__resetTickAccumulator();
    }
  });

  // Extract game state
  const gameState = await page.evaluate(() => {
    if (typeof (window as any).__gameState === 'function') {
      return (window as any).__gameState();
    }
    return null;
  });

  // Extract UI state
  const uiState = await page.evaluate(() => {
    if (typeof (window as any).__uiState === 'function') {
      return (window as any).__uiState();
    }
    return null;
  });

  // Capture command output
  const commandOutput = await page.evaluate(() => {
    if (typeof (window as any).__gameState === 'function') {
      const state = (window as any).__gameState();
      if (state && state.lastCommandOutput) return String(state.lastCommandOutput);
    }
    return '';
  });

  return { commandOutput, gameState, uiState, screenshotPaths };
}

/**
 * Wait for render frames to flush.
 * In headless Chrome, requestAnimationFrame may not fire on the expected
 * schedule, so we wait for one rAF plus a fallback timeout to ensure
 * the GPU has flushed.
 *
 * @param page - Puppeteer page object.
 * @param frames - Number of animation frames to wait for (default 3).
 */
/**
 * Suspend the game's draw loop for a harness that only reads the DOM and
 * game state (#475).
 *
 * Every CDP call waits on the main thread, and the terrain material costs
 * seconds per frame under software rasterisation — that wait, not the
 * simulation, is what makes the browser suites take tens of minutes. The
 * simulation, camera and rAF all keep running; only the draw stops. Capture
 * through `captureFrame` afterwards so screenshots still show a real frame.
 *
 * A no-op against a page that predates the bridge, so a harness pointed at an
 * older build still works.
 */
export async function suspendDrawing(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __setRenderEnabled?: (enabled: boolean) => void };
    w.__setRenderEnabled?.(false);
  });
}

/** Resume the draw loop suspended by `suspendDrawing`. */
export async function resumeDrawing(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __setRenderEnabled?: (enabled: boolean) => void };
    w.__setRenderEnabled?.(true);
  });
}

/**
 * Screenshot the page, drawing one frame first so the capture shows current
 * state even when `suspendDrawing` has stopped the loop from drawing.
 *
 * Every capture in every harness goes through here — a `page.screenshot` that
 * skips it would silently save whatever was on the canvas when drawing was
 * suspended.
 */
export async function captureFrame(page: Page, path: string): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __renderFrame?: () => void };
    w.__renderFrame?.();
  });
  await page.screenshot({ path, fullPage: false });
}

export async function waitOneFrame(page: Page, frames = 3): Promise<void> {
  // Wait for one rAF frame (triggers render loop's next frame)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  // Fallback delay: give GPU time to flush in headless Chrome
  await new Promise(r => setTimeout(r, 50 * frames));
}
