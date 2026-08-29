/**
 * Interaction-mode batch loop for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { ScenarioStepDef } from './shared/scenario-types.js';
import { findWaitUntilAction, type ScenarioResult } from './shared/command-runner.js';
import {
  formatStepIndex,
  formatCommandSlug,
  loadScenarioDef,
  buildScenarioReport,
  effectiveStepTimeoutMs,
  runRepeatedInteraction,
  SCENARIO_DIR,
  type ReportableStep,
} from './shared/scenario-utils.js';
import {
  initBrowser,
  executeInteractionActions,
  suspendDrawing,
  DEFAULT_STEP_TIMEOUT,
  SCREENSHOT_DIR,
} from './shared/puppeteer-utils.js';
import { describeStepFailure } from './scenario-interaction-runner.js';
import { checkGoal, gameState } from './shared/interaction-driver.js';
import { buildScenarioLoadFailure, logBatchProgress } from './run-all-scenarios-result.js';

export async function runBatchInteraction(
  names: string[],
  port: number,
): Promise<ScenarioResult[]> {
  console.log('\nLaunching shared browser...');

  const { browser, page: _sharedPage } = await initBrowser({ port });
  // Note: We create a new page per scenario for isolation

  const results: ScenarioResult[] = [];
  const startTime = Date.now();

  try {
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const outDir = resolve(SCREENSHOT_DIR, `scenario-${name}-interaction`);
      mkdirSync(outDir, { recursive: true });

      try {
        const def = loadScenarioDef(name!, SCENARIO_DIR);

        const steps: ScenarioStepDef[] = def.steps;
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Navigate to the game (happens once per scenario fresh tab). See
        // puppeteer-utils.ts's initBrowser() for why this isn't
        // 'networkidle0' (#458 T5.1 — EffectComposer/OutputPass regression).
        //
        // `?scenarioMode=1` is essential, not optional: it stops main.ts's own
        // real-time auto-tick loop so only the scenario's scripted `tick N`
        // advances simulation time. Without it the render loop keeps ticking
        // between scripted clicks, and a UI panel rebuilt by that ticking gets
        // detached out from under an in-flight click (#406) — which silently
        // dropped the tutorial-interactive surveyor hire and left the whole
        // tutorial stalled. Every other interaction harness (initBrowser,
        // scenario-test) already navigates with it; this batch runner did not.
        await page.goto(`http://localhost:${port}/?scenarioMode=1`, { waitUntil: 'domcontentloaded' });
        // 30s, not 10s: a fresh tab boots the renderer with no GPU, and the
        // first scenario of a batch pays that cold start on top. At 10s this
        // flaked as "Waiting for selector `#game-canvas, canvas` failed",
        // which reads like a broken page rather than a slow one.
        await page.waitForSelector('#game-canvas, canvas', { timeout: 30000 });
        // Main menu starts visible, same as initBrowser() — each scenario's
        // own `new_game` first step tears it down (main.ts console bridge).
        // Batch mode passes enableScreenshots=false, so nothing here reads
        // pixels: every step drives the DOM and reads __gameState. Without
        // this each of those CDP calls waits on a multi-second frame (#475).
        await suspendDrawing(page);

        let failed = false;
        let errorMsg = '';
        const stepResults: ReportableStep[] = [];

        for (let s = 0; s < steps.length; s++) {
          const step = steps[s]!;
          const paddedIdx = formatStepIndex(s);
          const cmdSlug = formatCommandSlug(step.command);
          const stepTimeout = effectiveStepTimeoutMs(step, DEFAULT_STEP_TIMEOUT);
          // Last "where this step stands" string from whichever action is
          // currently running — see scenario-interaction-runner.ts's own
          // copy of this comment (PR #616 review round, item 5).
          let lastProgress = 'no interaction action has started yet';

          try {
            await Promise.race([
              (async () => {
                // Before this step's own actions run, so `expect.increased`
                // measures this step's effect, not everything before it.
                const before = step.expect ? await gameState(page) : {};

                // enableScreenshots is always false in this batch path, so no
                // screenshot accumulation is needed here (unlike
                // scenario-interaction-runner.ts's own call site).
                //
                // hasWaitUntil is precomputed here, not inside
                // runRepeatedInteraction, which cannot import
                // findWaitUntilAction itself without a circular import back to
                // command-runner.ts (see runRepeatedInteraction's own doc
                // comment in scenario-utils.ts).
                const interactionResult = await runRepeatedInteraction(
                  step, s, findWaitUntilAction(step) !== undefined,
                  () => executeInteractionActions(
                    page, step, false, outDir, paddedIdx, cmdSlug,
                    (detail) => { lastProgress = detail; },
                  ),
                );

                if (step.expect) {
                  // interactionResult.gameState is this same moment's state —
                  // nothing ran in between — so checkGoal reuses it instead of
                  // re-fetching its own "after" snapshot.
                  await checkGoal(page, step.expect, before, interactionResult.gameState ?? undefined);
                }

                // Save state JSON
                const stateData = {
                  step: s,
                  command: step.command,
                  commandOutput: interactionResult.commandOutput,
                  gameState: interactionResult.gameState,
                  uiState: interactionResult.uiState,
                };
                const statePath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.json`);
                writeFileSync(statePath, JSON.stringify(stateData, null, 2));

                // Accumulate for report
                stepResults.push({
                  step: s,
                  command: step.command,
                  commandOutput: interactionResult.commandOutput,
                  gameState: interactionResult.gameState,
                });
              })(),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Step ${s} timed out after ${stepTimeout}ms (last progress: ${lastProgress})`)),
                  stepTimeout,
                )
              ),
            ]);
          } catch (err: unknown) {
            failed = true;
            errorMsg = describeStepFailure(step, err);
            break;
          }
        }

        // Generate report.json for batch interaction mode
        if (stepResults.length > 0) {
          const report = buildScenarioReport(stepResults);
          writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
        }

        await page.close();
        results.push({
          name: name!,
          totalSteps: steps.length,
          failed,
          ...(failed ? { error: errorMsg } : {}),
        });
      } catch (err: unknown) {
        results.push(buildScenarioLoadFailure(name!, err));
      }

      logBatchProgress(results, i, names.length, startTime);
    }
  } finally {
    await browser.close();
  }

  return results;
}
