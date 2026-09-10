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
import type { CommandTraceEntry } from './interaction-executor.js';
import { waitForUiUpdate } from './interaction-driver.js';
import type { ScenarioStepDef } from './scenario-types.js';

/** Default timeout for scenario steps in seconds. */
export const DEFAULT_STEP_TIMEOUT = 60;

/**
 * How long to wait for the game canvas after `domcontentloaded` (#1021).
 *
 * Not a game-behaviour budget — it is a cold-start budget. Every
 * interaction-mode shard launches its own browser, and up to ten of them run
 * concurrently on a 2-core `ubuntu-latest` runner with no GPU, so Chrome +
 * Vite + the first WebGL context can take well past ten seconds to paint a
 * canvas that is not in any way broken. At the previous flat `10000` this
 * failed whole shards before a single scenario step ran — reproduced on
 * `main` itself (run `34335332230`), on PR #1019 twice, and on PR #1030's
 * shard 7/10. The scenarios' own per-step timeouts still bound real hangs;
 * this one only has to outlast a slow start.
 */
export const CANVAS_READY_TIMEOUT_MS = 30000;

/** Screenshot directory path. */
export const SCREENSHOT_DIR = resolve(import.meta.dirname ?? process.cwd(), '..', '..', 'screenshots');

/**
 * Actions after which the next step depends on this frame's `uiManager.update`
 * having run — see `waitForUiUpdate`. Reads and explicit waits already block,
 * and commands run synchronously in the game, not the DOM, so only these pay it.
 */
const SETTLE_AFTER = new Set([
  'click', 'clickSelector', 'pickTile', 'dragTiles', 'mousedown', 'mouseup', 'type',
  // Both may perform a real click (only when not already open/active) that
  // opens a panel or switches a step tab — a following action in the same
  // step reading or clicking inside it needs that frame settled first.
  'ensurePanel', 'ensureStep',
]);

/**
 * Browser initialization options.
 */
export interface BrowserInitOptions {
  port: number;
  puppeteerPath?: string;
  viewport?: { width: number; height: number };
  /** Canvas-ready budget; defaults to `CANVAS_READY_TIMEOUT_MS`. */
  canvasTimeoutMs?: number;
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
  const {
    port,
    puppeteerPath,
    viewport = { width: 1280, height: 720 },
    canvasTimeoutMs = CANVAS_READY_TIMEOUT_MS,
  } = options;
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
  await page.waitForSelector('#game-canvas, canvas', { timeout: canvasTimeoutMs });
  console.log('Game canvas detected. Waiting for initialization...');

  // The main menu overlay starts visible, same as a real player would see it.
  // Scenarios that begin with `new_game` tear it down themselves the moment
  // that command runs (see main.ts's console bridge) — forcing it hidden
  // here, before any scenario step executes, broke scenarios that inspect
  // the menu itself (main-menu-visual.json, #408).

  return { browser, page };
}

/**
 * Wipe localStorage/IndexedDB/cache for the dev server's origin on `page`.
 *
 * Call it before navigating, so the app boots against clean storage rather
 * than reading a previous scenario's leftovers.
 *
 * Why this exists: a batch shard runs many scenario files through tabs of one
 * browser, and tabs of the same origin share storage no matter how fresh the
 * tab is. A saved game written by one scenario therefore survives into the
 * next one — `blast-report-save-load-visual` leaving a slot_1 save that made
 * `save-load-visual` miss its own "save here" button once PR #1030's new
 * scenario file shifted the two into the same shard.
 *
 * A fresh `browser.createBrowserContext()` per scenario also isolates storage
 * and was tried first, but it costs a full renderer cold start on every
 * scenario instead of once per shard — per-scenario time roughly quadrupled
 * (16.7s to 71.3s on shard 1) and pushed unrelated scenarios past their step
 * timeouts. Clearing the origin keeps the shared context's warm renderer.
 *
 * @param page - Page to clear storage on, before its first navigation.
 * @param port - Dev server port, which with localhost forms the origin.
 */
export async function resetOriginStorage(page: Page, port: number): Promise<void> {
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Storage.clearDataForOrigin', {
      origin: `http://localhost:${port}`,
      storageTypes: 'all',
    });
  } finally {
    await cdp.detach();
  }
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
 * @param onProgress - Optional sink for a human-readable "where this step
 *   currently stands" string, updated before each action and (for
 *   waitUntil/waitForTutorialStep) on every tick within one. The runners
 *   read the last value through it to name what was actually in flight when
 *   a step's own outer timeout fires, instead of a bare
 *   "Step N timed out after Xms" (PR #616 review round, item 5).
 * @param onTrace - Optional sink for each concrete command this step's
 *   actions actually issue (a `command` action, or one entry per tick of a
 *   `waitUntil` action's internal loop) — diagnostic-only (issue #674);
 *   omitted by every existing caller, which sees no change.
 * @returns Interaction step result with state and screenshots.
 */
export async function executeInteractionActions(
  page: Page,
  step: ScenarioStepDef,
  enableScreenshots: boolean,
  outDir: string,
  paddedIdx: string,
  cmdSlug: string,
  onProgress?: (detail: string) => void,
  onTrace?: (entry: CommandTraceEntry) => void,
): Promise<InteractionStepResult> {
  const screenshotPaths: string[] = [];
  let screenshotIndex = 0;

  if (!step.interaction || step.interaction.length === 0) {
    console.warn(`  Step: interaction mode but no interaction defined, skipping.`);
    return { commandOutput: '', gameState: null, uiState: null, screenshotPaths };
  }

  // Execute interaction actions
  for (let i = 0; i < step.interaction.length; i++) {
    const action = step.interaction[i]!;
    if (action.type === 'screenshot' && enableScreenshots) {
      const ssPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-ss${screenshotIndex}.png`);
      await captureFrame(page, ssPath);
      screenshotPaths.push(ssPath);
      console.log(`  Screenshot [${screenshotIndex}]: ${ssPath}`);
      screenshotIndex++;
    } else if (action.type !== 'screenshot') {
      onProgress?.(`action ${i + 1}/${step.interaction.length} (${action.type})`);
      await executeActionOnPage(page, action, step, onProgress, onTrace);
      // A click that mutates the DOM — opening a panel, then clicking a control
      // inside it — needs the panel's next-frame `uiManager.update` to run
      // before the following action reads or clicks that control. The
      // interaction driver settles after every action for exactly this; the
      // interaction scenarios did not, so a hire button clicked in the same beat its panel
      // opened fired against a not-yet-live control and the click was lost
      // (the tutorial-interactive surveyor hire, which stalled the whole run).
      // Only the mutating actions pay it; reads and explicit waits do not.
      if (SETTLE_AFTER.has(action.type)) {
        await waitForUiUpdate(page);
      }
    }
  }

  // Reset the tick accumulator and read back game/UI state in one round trip —
  // was four separate evaluates, the last of which (commandOutput) re-called
  // __gameState() a second time for a field the gameState evaluate just above
  // it already carries (main.ts's __gameState always includes
  // lastCommandOutput). Each evaluate is a CDP round trip; collapsing them
  // matters here specifically because every scenario step pays it.
  const tail = await page.evaluate(() => {
    const w = window as any;
    if (typeof w.__resetTickAccumulator === 'function') w.__resetTickAccumulator();
    return {
      gameState: typeof w.__gameState === 'function' ? w.__gameState() : null,
      uiState: typeof w.__uiState === 'function' ? w.__uiState() : null,
    };
  });
  // Tolerates a test double's `evaluate` resolving to something other than
  // the object literal above — a real page's evaluate always returns it.
  const { gameState, uiState } = tail ?? { gameState: null, uiState: null };
  const commandOutput = gameState && (gameState as Record<string, unknown>).lastCommandOutput
    ? String((gameState as Record<string, unknown>).lastCommandOutput)
    : '';

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
/** Default bound on `waitForModels`: past this a capture goes ahead with whatever has loaded. */
export const MODELS_READY_TIMEOUT_MS = 90_000;

const modelsAwaited = new WeakSet<Page>();

/**
 * Wait for the page's model preload to finish, so a captured frame shows the
 * real assets rather than the stand-in boxes and cone trees a level entered
 * through `__gameConsole` starts with (enterLevel() waits on the same promise
 * for a player; the harness bypasses it). Bounded: returns false on timeout
 * or against a page that predates the bridge, and never rejects. Each page is
 * awaited once; later calls return at once.
 */
export async function waitForModels(page: Page, timeoutMs = MODELS_READY_TIMEOUT_MS): Promise<boolean> {
  if (modelsAwaited.has(page)) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const ready = page.evaluate(async () => {
    const w = window as unknown as { __modelsReady?: () => Promise<unknown> };
    if (!w.__modelsReady) return false;
    await w.__modelsReady();
    return true;
  }).catch(() => false);
  const ok = await Promise.race([ready, timeout]);
  clearTimeout(timer);
  if (ok) modelsAwaited.add(page);
  else console.warn(`  Models not ready after ${timeoutMs}ms — capturing with stand-ins.`);
  return ok;
}

export async function captureFrame(page: Page, path: string): Promise<void> {
  await waitForModels(page);
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
