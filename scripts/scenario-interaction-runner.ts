/**
 * BlastSimulator2026 — Scenario Interaction Runner
 * Runs scenario steps in Puppeteer/Chrome with interaction actions.
 * Extracted from scenario-test.ts to meet the 300-line file limit.
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { resolveChromePath, LAUNCH_ARGS } from './shared/chrome.js';
import { executeActionOnPage } from './shared/interaction-executor.js';
import type { InteractionStepAction, ScenarioStepDef, StepResult } from './shared/scenario-types.js';
import {
  formatStepIndex,
  formatCommandSlug,
  buildScenarioReport,
  type ReportableStep,
} from './shared/scenario-utils.js';

const INIT_WAIT_MS = 0;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export interface ShotDef {
  name: string;
  yaw: number;
  pitch: number;
}

/** Wait for one render frame (requestAnimationFrame). Screenshots need the GPU to flush a frame. */
async function waitOneFrame(page: puppeteer.Page): Promise<void> {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
}

function checkScreenshotSize(filepath: string): string | undefined {
  try {
    const size = statSync(filepath).size;
    if (size > MAX_SCREENSHOT_BYTES) {
      const mb = (size / (1024 * 1024)).toFixed(1);
      return `Screenshot ${mb}MB exceeds ${MAX_SCREENSHOT_BYTES / (1024*1024)}MB limit: ${filepath}`;
    }
  } catch { /* ignore stat errors */ }
  return undefined;
}

/** Executes an array of interaction actions on the given Puppeteer page. */
export async function executeInteractionStep(
  page: puppeteer.Page,
  actions: InteractionStepAction[],
  timeout?: number,
): Promise<void> {
  const execute = async () => {
    for (const action of actions) {
      try {
        await executeActionOnPage(page, action);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Interaction action error (${action.type}): ${msg}`);
      }
    }
  };

  if (timeout !== undefined && timeout > 0) {
    await Promise.race([
      execute(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`executeInteractionStep timed out after ${timeout}ms`)), timeout),
      ),
    ]);
  } else {
    await execute();
  }
}

/** Run scenario in interaction mode (Puppeteer + Chrome). */
export async function runScenarioInteraction(
  name: string, steps: ScenarioStepDef[], shots: ShotDef[],
  port: number, puppeteerPath: string | undefined, frames: number, intervalMs: number,
  viewport: { width: number; height: number },
  enableScreenshots: boolean,
  screenshotDir: string,
): Promise<StepResult[]> {
  const outDir = resolve(screenshotDir, `scenario-${name}-interaction`);
  mkdirSync(outDir, { recursive: true });
  const devServerUrl = `http://localhost:${port}`;
  const executablePath = puppeteerPath ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? resolveChromePath();
  const browser = await puppeteer.launch({ headless: true, executablePath, args: LAUNCH_ARGS });
  const results: StepResult[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    console.log(`Navigating to ${devServerUrl}...`);
    await page.goto(devServerUrl, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
    console.log('Game canvas detected. Waiting for initialization...');
    await new Promise(r => setTimeout(r, INIT_WAIT_MS));
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const paddedIdx = formatStepIndex(i);
      const cmdSlug = formatCommandSlug(step.command);
      console.log(`\n--- Step ${i}: ${step.command} ---`);
      let timedOut = false;
      const stepTimeout = (step.timeout ?? 30) * 1000;
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => { timedOut = true; reject(new Error(`Step ${i} timed out after ${stepTimeout}ms`)); }, stepTimeout)
      );
      const stepScreenshotPaths: string[] = [];

      try {
        await Promise.race([
          (async () => {
            let commandOutput = '';
            if (step.interaction && step.interaction.length > 0) {
              let screenshotIndex = 0;
              for (const action of step.interaction) {
                if (action.type === 'screenshot' && enableScreenshots) {
                  const ssPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-ss${screenshotIndex}.png`);
                  await page.screenshot({ path: ssPath, fullPage: false });
                  stepScreenshotPaths.push(ssPath);
                  console.log(`  Screenshot [${screenshotIndex}]: ${ssPath}`);
                  screenshotIndex++;
                } else if (action.type !== 'screenshot') {
                  await executeActionOnPage(page, action);
                }
              }
              commandOutput = await page.evaluate(() => {
                if (typeof (window as any).__gameState === 'function') {
                  const state = (window as any).__gameState();
                  if (state && state.lastCommandOutput) return String(state.lastCommandOutput);
                }
                return '';
              });
            } else {
              console.warn(`  Step ${i}: interaction mode but no interaction defined, skipping.`);
            }

            await page.evaluate(() => {
              if (typeof (window as any).__resetTickAccumulator === 'function') {
                (window as any).__resetTickAccumulator();
              }
            });

            const gameState = await page.evaluate(() => {
              if (typeof (window as any).__gameState === 'function') {
                return (window as any).__gameState();
              }
              return null;
            });

            const uiState = await page.evaluate(() => {
              if (typeof (window as any).__uiState === 'function') {
                return (window as any).__uiState();
              }
              return null;
            });

            let screenshotPath = '';
            let sizeWarn: string | undefined;
            if (enableScreenshots) {
              await waitOneFrame(page);
              screenshotPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.png`);
              await page.screenshot({ path: screenshotPath, fullPage: false });
              sizeWarn = checkScreenshotSize(screenshotPath);
              if (sizeWarn) console.warn(`  WARNING: ${sizeWarn}`);
            }

            const stepFrames = step.frames ?? frames;
            const stepInterval = step.interval ?? intervalMs;
            if (enableScreenshots && stepFrames > 1) {
              for (let f = 0; f < stepFrames; f++) {
                await new Promise(r => setTimeout(r, stepInterval));
                await waitOneFrame(page);
                const framePath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-f${f}.png`);
                await page.screenshot({ path: framePath, fullPage: false });
                console.log(`  Frame ${f}: ${framePath} (interval=${stepInterval}ms)`);
                const fSizeWarn = checkScreenshotSize(framePath);
                if (fSizeWarn) console.warn(`  WARNING: ${fSizeWarn}`);
              }
            }

            const stateData = { step: i, command: step.command, commandOutput, gameState, uiState,
              screenshots: stepScreenshotPaths.length > 0 ? stepScreenshotPaths : undefined };
            const statePath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.json`);
            writeFileSync(statePath, JSON.stringify(stateData, null, 2));
            if (screenshotPath) console.log(`  Screenshot: ${screenshotPath}`);
            console.log(`  State: ${statePath}`);

            if (enableScreenshots) {
              for (const shot of shots) {
                await page.evaluate(({ y, p }: { y: number; p: number }) => {
                  (window as any).__cameraOrbit(y, p);
                }, { y: shot.yaw, p: shot.pitch });
                await waitOneFrame(page);
                const shotPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-${shot.name}.png`);
                await page.screenshot({ path: shotPath, fullPage: false });
                console.log(`  Shot [${shot.name}]: ${shotPath}`);
                const sSizeWarn = checkScreenshotSize(shotPath);
                if (sSizeWarn) console.warn(`  WARNING: ${sSizeWarn}`);
              }
              if (shots.length > 0) {
                await page.evaluate(() => (window as any).__cameraReset());
                await waitOneFrame(page);
              }
            }

            if (gameState) {
              const gs = gameState as any;
              console.log(`  Holes: ${gs.holeCount ?? 0}, Charged: ${gs.chargedCount ?? 0}, Sequenced: ${gs.sequencedCount ?? 0}`);
            }

            results.push({ step: i, command: step.command, commandOutput: commandOutput as string,
              gameState: gameState as any, uiState: uiState as any, screenshotPath, statePath, warning: sizeWarn });
          })(),
          timeoutPromise,
        ]);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${errorMsg}`);
        results.push({ step: i, command: step.command, commandOutput: '', gameState: null,
          uiState: null, screenshotPath: '', statePath: '', error: errorMsg });
        if (timedOut) {
          console.error('  Step timed out. Skipping remaining steps.');
          break;
        }
      }
    }

    const reportPath = resolve(outDir, 'report.json');
    const report = buildScenarioReport(results as ReportableStep[]);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved: ${reportPath}`);
    return results;
  } finally {
    await browser.close();
  }
}
