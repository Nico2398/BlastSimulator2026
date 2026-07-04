/**
 * BlastSimulator2026 — Scenario Interaction Runner
 * Runs scenario steps in Puppeteer/Chrome with interaction actions.
 * Extracted from scenario-test.ts to meet the 300-line file limit.
 */

import { mkdirSync, writeFileSync, statSync } from 'fs';
import { resolve } from 'path';
import type { ScenarioStepDef, StepResult } from './shared/scenario-types.js';
import {
  formatStepIndex,
  formatCommandSlug,
  buildScenarioReport,
  type ReportableStep,
} from './shared/scenario-utils.js';
import {
  initBrowser,
  executeInteractionActions,
  waitOneFrame,
  DEFAULT_STEP_TIMEOUT,
} from './shared/puppeteer-utils.js';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export interface ShotDef {
  name: string;
  yaw: number;
  pitch: number;
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
  const results: StepResult[] = [];

  const { browser, page } = await initBrowser({
    port,
    ...(puppeteerPath !== undefined ? { puppeteerPath } : {}),
    viewport,
  });

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const paddedIdx = formatStepIndex(i);
      const cmdSlug = formatCommandSlug(step.command);
      console.log(`\n--- Step ${i}: ${step.command} ---`);
      let timedOut = false;
      const stepTimeout = (step.timeout ?? DEFAULT_STEP_TIMEOUT) * 1000;
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => { timedOut = true; reject(new Error(`Step ${i} timed out after ${stepTimeout}ms`)); }, stepTimeout)
      );
      const stepScreenshotPaths: string[] = [];

      try {
        await Promise.race([
          (async () => {
            const interactionResult = await executeInteractionActions(
              page, step, enableScreenshots, outDir, paddedIdx, cmdSlug,
            );
            stepScreenshotPaths.push(...interactionResult.screenshotPaths);

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

            const stateData = { step: i, command: step.command, commandOutput: interactionResult.commandOutput,
              gameState: interactionResult.gameState, uiState: interactionResult.uiState,
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

            if (interactionResult.gameState) {
              const gs = interactionResult.gameState as Record<string, unknown>;
              console.log(`  Holes: ${gs.holeCount ?? 0}, Charged: ${gs.chargedCount ?? 0}, Sequenced: ${gs.sequencedCount ?? 0}`);
            }

            results.push({
              step: i,
              command: step.command,
              commandOutput: interactionResult.commandOutput,
              gameState: interactionResult.gameState,
              uiState: interactionResult.uiState,
              screenshotPath,
              statePath,
              ...(sizeWarn !== undefined ? { warning: sizeWarn } : {}),
            });
          })(),
          timeoutPromise,
        ]);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR: ${errorMsg}`);
        results.push({
          step: i,
          command: step.command,
          commandOutput: '',
          gameState: null,
          uiState: null,
          screenshotPath: '',
          statePath: '',
          error: errorMsg,
        });
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
