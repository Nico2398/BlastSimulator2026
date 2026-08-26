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
  effectiveStepTimeoutMs,
  type ReportableStep,
} from './shared/scenario-utils.js';
import {
  initBrowser,
  executeInteractionActions,
  waitOneFrame,
  DEFAULT_STEP_TIMEOUT,
  captureFrame,
  suspendDrawing,
} from './shared/puppeteer-utils.js';
import { checkGoal, gameState, InteractionFailure } from './shared/interaction-driver.js';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export interface ShotDef {
  name: string;
  yaw: number;
  pitch: number;
  /** World (x, z) to centre the shot on before orbiting; terrain Y is resolved at capture time. */
  target?: [number, number];
  /** Camera distance from `target`, in world units. Ignored unless `target` is also set. */
  distance?: number;
}

/**
 * Turns a raw step error into a report line. A player-marked step's failure
 * is the mechanism working (issue #479) — it means no click could finish
 * what the step asked, so it is called out rather than left to read like any
 * other broken step. `err`'s own message already names the blocking control
 * the way `describeUnclickable` (interaction-executor.ts) reports it; this
 * only adds the step-level framing on top.
 */
export function describeStepFailure(step: ScenarioStepDef, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const label = step.description ?? step.command;
  const base = step.role === 'player'
    ? `player step "${label}" did not complete: ${raw}`
    : raw;
  // InteractionFailure (thrown by checkGoal for a failed `expect`, or by a
  // reused interaction-driver action like `set`/`clickEntity`) carries a
  // diagnosis — what was usable/blocked at the moment of failure — that a
  // bare message loses. Surface it too.
  return err instanceof InteractionFailure ? `${base}\n${err.diagnosis}` : base;
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
  // Required, not defaulted — every caller must pass the scenario def's own
  // ScenarioDef.skipBlastPlayback ?? false (#761). No default param here so a
  // caller that forgets to thread it fails to compile instead of silently
  // observing playback.
  skipBlastPlayback: boolean,
): Promise<StepResult[]> {
  const outDir = resolve(screenshotDir, `scenario-${name}-interaction`);
  mkdirSync(outDir, { recursive: true });
  const results: StepResult[] = [];

  const { browser, page } = await initBrowser({
    port,
    ...(puppeteerPath !== undefined ? { puppeteerPath } : {}),
    viewport,
  });

  // Interaction steps click the DOM and read game state; only the screenshots
  // need pixels, and captureFrame draws its own. Without this every CDP call
  // waits on a multi-second frame (#475).
  await suspendDrawing(page);

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const paddedIdx = formatStepIndex(i);
      const cmdSlug = formatCommandSlug(step.command);
      console.log(`\n--- Step ${i}: ${step.command} ---`);
      let timedOut = false;
      // Last "where this step stands" string reported by whichever action is
      // currently running — read by the timeout race below so a step that
      // times out on the outer deadline names what was actually in flight,
      // instead of a bare "Step N timed out after Xms" (PR #616 review round,
      // item 5). effectiveStepTimeoutMs already makes a single waitUntil/
      // waitForTutorialStep's own deadline fire first with its own, more
      // specific error; this covers the residual case where several actions'
      // combined time — none individually stalling — exceeds the outer budget.
      let lastProgress = 'no interaction action has started yet';
      const stepTimeout = effectiveStepTimeoutMs(step, DEFAULT_STEP_TIMEOUT, {
        enabled: enableScreenshots,
        shotsCount: shots.length,
      });
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Step ${i} timed out after ${stepTimeout}ms (last progress: ${lastProgress})`));
        }, stepTimeout)
      );
      const stepScreenshotPaths: string[] = [];

      try {
        await Promise.race([
          (async () => {
            // Captured before the step's own actions run, so `expect.increased`
            // (below) measures this step's effect and not everything before it.
            const before = step.expect ? await gameState(page) : {};

            const interactionResult = await executeInteractionActions(
              page, step, enableScreenshots, outDir, paddedIdx, cmdSlug,
              (detail) => { lastProgress = detail; },
            );
            stepScreenshotPaths.push(...interactionResult.screenshotPaths);

            // Real DOM/tutorial checks, not just "nothing threw" — reuses
            // interaction-driver.ts's checkGoal, the same evaluator command
            // mode's checkGoalAgainstState mirrors for the fields that don't
            // need a live page (issue #479 follow-up: scenarios gained
            // assertions instead of staying a pass/fail-on-exception-only
            // channel). Passes the state executeInteractionActions already
            // fetched moments ago — nothing between the two calls can have
            // mutated it — instead of having checkGoal re-fetch its own
            // "after" snapshot.
            if (step.expect) {
              await checkGoal(page, step.expect, before, interactionResult.gameState ?? undefined);
            }

            let screenshotPath = '';
            let sizeWarn: string | undefined;
            if (enableScreenshots) {
              await waitOneFrame(page);
              screenshotPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.png`);
              await captureFrame(page, screenshotPath);
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
                await captureFrame(page, framePath);
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
                if (shot.target && shot.distance !== undefined) {
                  await page.evaluate(({ x, z, d }: { x: number; z: number; d: number }) => {
                    (window as any).__cameraFocus(x, z, d);
                  }, { x: shot.target[0], z: shot.target[1], d: shot.distance });
                }
                await page.evaluate(({ y, p }: { y: number; p: number }) => {
                  (window as any).__cameraOrbit(y, p);
                }, { y: shot.yaw, p: shot.pitch });
                await waitOneFrame(page);
                const shotPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-${shot.name}.png`);
                await captureFrame(page, shotPath);
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

            // Skip the fragment-collapse playback after a successful blast step
            // (#761) — reaching this line already means the step's own actions
            // ran without throwing, mirroring how src/main.ts's runGameCommand
            // gates its own onBlast() effects on `cmdName === 'blast' &&
            // result.success`. The verb is read via the same `cmdSlug`
            // (formatCommandSlug's first-token extraction) already computed
            // above for screenshot/state filenames — a player step's
            // `interaction` array never contains a `command` action
            // (scenario-defs.md), so the step's declared command is the only
            // place the verb is known in interaction mode.
            if (skipBlastPlayback && cmdSlug === 'blast') {
              await page.evaluate(() => {
                const w = window as unknown as { __skipBlastPlayback?: () => void };
                w.__skipBlastPlayback?.();
              });
            }
          })(),
          timeoutPromise,
        ]);
      } catch (err: unknown) {
        const errorMsg = describeStepFailure(step, err);
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
        // Stop at the first failed step, timeout or not. A step that did not
        // complete leaves the game in a state later steps never asked for —
        // continuing past it, as this used to, produced cascading unrelated
        // failures and (scenario-test.ts always exiting 0 regardless) a run
        // that reported success no matter what this loop actually did.
        console.error(timedOut
          ? '  Step timed out. Stopping — a step must complete to prove anything.'
          : '  Step failed. Stopping — a step must complete to prove anything.');
        break;
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
