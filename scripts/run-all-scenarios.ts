/**
 * BlastSimulator2026 — Batch Scenario Runner
 *
 * Runs ALL scenario JSON files in a single process (cold start once)
 * for maximum CI throughput. Reports per-scenario pass/fail with detailed
 * error information and exits with code 1 if any scenario fails.
 *
 * Usage:
 *   npx tsx scripts/run-all-scenarios.ts [--mode command|interaction]
 *
 * Default mode: command (pure Node.js, no browser, ~24s for all 99).
 * Interaction mode: shared Puppeteer browser, ~2-3min for all 99.
 *
 * --report-drift (command mode only, issue #679): a step whose only
 * failures are equals/changedBy mismatches no longer marks the step (or its
 * scenario) as failed — it runs to completion instead, and every such
 * mismatch is collected into a drift report (stdout + drift-report.json)
 * rather than aborting the run. Directional goals (increased/decreased)
 * still fail the run as before. This means a run under --report-drift can
 * exit 0 while its drift report is non-empty — that's the point: it's a
 * run-to-completion report, not a pass/fail gate.
 */

import { readdirSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { ScenarioStepDef } from './shared/scenario-types.js';
import {
  createGameEngine,
  runScenario,
  emitDriftReport,
  findWaitUntilAction,
  type ScenarioResult,
  type DriftRecord,
} from './shared/command-runner.js';
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

const DEV_SERVER_PORT = 5173;

interface ShardSpec { index: number; total: number }

interface ParsedArgs {
  mode: string;
  scenarios: string[];
  port: number;
  shard?: ShardSpec;
  reportDrift: boolean;
}

function parseShardArg(raw: string): ShardSpec {
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (!m) throw new Error(`--shard must be "i/N" (1-indexed), got "${raw}"`);
  const index = parseInt(m[1]!, 10);
  const total = parseInt(m[2]!, 10);
  if (total < 1 || index < 1 || index > total) {
    throw new Error(`--shard "${raw}" out of range: index must be 1..${total}`);
  }
  return { index, total };
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let mode = 'command';
  let port = DEV_SERVER_PORT;
  let shard: ShardSpec | undefined;
  let reportDrift = false;
  const scenarios: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1]!;
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--shard' && args[i + 1]) {
      shard = parseShardArg(args[i + 1]!);
      i++;
    } else if (args[i] === '--report-drift') {
      reportDrift = true;
    } else if (args[i]) {
      scenarios.push(args[i]!);
    }
  }

  return { mode, scenarios, port, ...(shard ? { shard } : {}), reportDrift };
}

/**
 * Split `names` into `total` shards by index modulo, not a contiguous slice —
 * scenario cost varies roughly 6x (13s to 80s+ in interaction mode), and the
 * alphabetical sort clusters same-prefix scenarios (the `level*-playthrough-*`
 * files) together, so a contiguous chunk would load some shards far more than
 * others. Round-robin spreads that variance evenly without needing per-scenario
 * cost data to balance against.
 */
function selectShard(names: string[], shard: ShardSpec): string[] {
  return names.filter((_, i) => i % shard.total === shard.index - 1);
}

async function runBatchInteraction(
  names: string[],
  port: number,
): Promise<ScenarioResult[]> {
  console.log('\nLaunching shared browser...');

  const { browser, page: _sharedPage } = await initBrowser({ port });
  // Note: We create a new page per scenario for isolation

  const results: ScenarioResult[] = [];
  const startTime = Date.now();

  const printProgress = (i: number) => {
    const passed = results.filter(r => !r.failed).length;
    const failed = results.filter(r => r.failed).length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Progress: ${i + 1}/${names.length} (${passed} passed, ${failed} failed) [${elapsed}s]`);
  };

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
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n[${name}] FAILED — ${msg}`);
        results.push({ name: name!, totalSteps: 0, failed: true, error: msg });
      }

      printProgress(i);
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function main(): Promise<void> {
  const { mode, scenarios: filterScenarios, port, shard, reportDrift } = parseArgs();

  const scenarioFiles = readdirSync(SCENARIO_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();

  const selected = filterScenarios.length > 0 ? filterScenarios : scenarioFiles;
  const names = shard ? selectShard(selected, shard) : selected;

  console.log(`\nBlastSimulator2026 — Batch Scenario Runner`);
  console.log(`Mode: ${mode}`);
  if (shard) console.log(`Shard: ${shard.index}/${shard.total} — ${names.length}/${selected.length} scenarios`);
  console.log(`Scenarios: ${names.length} files`);

  const startTime = Date.now();
  let results: ScenarioResult[];

  if (mode === 'interaction') {
    results = await runBatchInteraction(names, port);
  } else {
    // Command mode — single engine cold start
    console.log('\nInitializing game engine...');
    const engine = createGameEngine();
    console.log(`Engine ready. Running ${names.length} scenarios...`);

    results = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      try {
        const steps = loadScenarioDef(name!, SCENARIO_DIR).steps;
        const result = runScenario(engine, name!, steps, SCREENSHOT_DIR, reportDrift);
        results.push(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n[${name}] FAILED — ${msg}`);
        results.push({ name: name!, totalSteps: 0, failed: true, error: msg });
      }

      const passed = results.filter(r => !r.failed).length;
      const failed = results.filter(r => r.failed).length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Progress: ${i + 1}/${names.length} (${passed} passed, ${failed} failed) [${elapsed}s]`);
    }
  }

  if (reportDrift && mode === 'command') {
    const driftRecords: DriftRecord[] = results.flatMap(r => r.driftRecords ?? []);
    emitDriftReport(driftRecords, resolve(SCREENSHOT_DIR, 'drift-report.json'));
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const failures = results.filter(r => r.failed);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`BATCH COMPLETE — ${totalTime}s`);
  console.log(`Total: ${results.length}, Passed: ${results.length - failures.length}, Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log(`\nFailed scenarios:`);
    for (const f of failures) {
      console.log(`  ❌ ${f.name} (${f.totalSteps} steps)`);
      if (f.error) console.log(`     ${f.error}`);
    }
    process.exit(1);
  }

  console.log(`\nAll scenarios passed.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Batch runner failed:', err);
  process.exit(1);
});