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
import { resolve } from 'path';
import { resolveChromePath, LAUNCH_ARGS } from './chrome.js';
import { executeActionOnPage } from './interaction-executor.js';
import type { InteractionStepAction, ScenarioStepDef } from './scenario-types.js';

/** Default timeout for scenario steps in seconds. */
export const DEFAULT_STEP_TIMEOUT = 60;

/** Screenshot directory path. */
export const SCREENSHOT_DIR = resolve(import.meta.dirname ?? process.cwd(), '..', '..', 'screenshots');

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
  browser: puppeteer.Browser;
  page: puppeteer.Page;
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
  const executablePath = puppeteerPath ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? resolveChromePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: LAUNCH_ARGS,
  });

  const page = await browser.newPage();
  await page.setViewport(viewport);

  const devServerUrl = `http://localhost:${port}`;
  console.log(`Navigating to ${devServerUrl}...`);
  await page.goto(devServerUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
  console.log('Game canvas detected. Waiting for initialization...');

  // Dismiss main menu
  await page.evaluate(() => {
    const menu = document.getElementById('bs-main-menu');
    if (menu) (menu as HTMLElement).style.display = 'none';
  });

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
  page: puppeteer.Page,
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
      await page.screenshot({ path: ssPath, fullPage: false });
      screenshotPaths.push(ssPath);
      console.log(`  Screenshot [${screenshotIndex}]: ${ssPath}`);
      screenshotIndex++;
    } else if (action.type !== 'screenshot') {
      await executeActionOnPage(page, action);
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
 * Wait for one render frame (requestAnimationFrame).
 * Screenshots need the GPU to flush a frame.
 *
 * @param page - Puppeteer page object.
 */
export async function waitOneFrame(page: puppeteer.Page): Promise<void> {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
}
