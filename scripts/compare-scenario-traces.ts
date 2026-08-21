/**
 * BlastSimulator2026 — Scenario Trace Comparison CLI (issue #674)
 *
 * Diagnostic CLI: runs a scenario in both command mode and interaction mode,
 * traces each mode's actually-issued commands per step, and reports the
 * first point where the two diverge. Not the scenario-file fix itself — this
 * pins down exactly where a scenario's task-dispatch throughput/ordering
 * splits between the two modes, before any fix is written.
 *
 * Usage:
 *   npx tsx scripts/compare-scenario-traces.ts <scenario-name>
 *
 * @module scripts/compare-scenario-traces
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';
import type { ScenarioStepDef } from './shared/scenario-types.js';
import { createGameEngine, runSteps } from './shared/command-runner.js';
import { loadScenarioDef, formatStepIndex, formatCommandSlug, SCENARIO_DIR } from './shared/scenario-utils.js';
import { initBrowser, suspendDrawing, executeInteractionActions } from './shared/puppeteer-utils.js';
import { compareTraces } from './shared/scenario-trace.js';
import type { ScenarioTraceEntry } from './shared/scenario-trace.js';

const SCREENSHOT_DIR = resolve(process.cwd(), 'screenshots');
const DEV_SERVER_PORT = 5173;

/** Reads `gameState.tickCount` back out of a step result's state dump, if present. */
function tickCountOf(gameState: Record<string, unknown> | null): number | null {
  if (gameState === null) return null;
  const v = gameState.tickCount;
  return typeof v === 'number' ? v : null;
}

/**
 * Traces command mode: one entry per step, using the step's declared
 * `command` string exactly as `runSteps` executed it — command mode never
 * resolves a step to anything else.
 */
function runCommandTrace(name: string, steps: ScenarioStepDef[]): ScenarioTraceEntry[] {
  const engine = createGameEngine();
  const outDir = resolve(SCREENSHOT_DIR, `scenario-${name}-trace-command`);
  const results = runSteps(engine, steps, outDir);
  return results.map(r => ({
    stepIndex: r.step,
    mode: 'command' as const,
    command: r.command,
    success: r.error === undefined,
    tickCountAfter: tickCountOf(r.gameState),
  }));
}

/**
 * Traces interaction mode: for each step, every `command` action's actual
 * `action.command` string, and one `tick 1` entry per iteration of a
 * `waitUntil` action's internal loop — via `executeInteractionActions`'s
 * `onTrace` sink (issue #674's additive hook). A step with neither shape of
 * action (a real UI click with no console-command equivalent) contributes no
 * entry, which is itself a meaningful, expected difference from command
 * mode's always-one-entry-per-step trace.
 *
 * A step whose actions throw stops the loop early rather than failing the
 * whole comparison — the trace collected up to that point, compared against
 * command mode's full trace, is itself the diagnostic: it shows exactly
 * where interaction mode stopped keeping pace.
 */
async function runInteractionTrace(
  name: string,
  steps: ScenarioStepDef[],
  port: number,
): Promise<ScenarioTraceEntry[]> {
  const trace: ScenarioTraceEntry[] = [];
  const outDir = resolve(SCREENSHOT_DIR, `scenario-${name}-trace-interaction`);
  mkdirSync(outDir, { recursive: true });

  const { browser, page } = await initBrowser({ port });
  await suspendDrawing(page);

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const paddedIdx = formatStepIndex(i);
      const cmdSlug = formatCommandSlug(step.command);

      try {
        await executeInteractionActions(
          page, step, false, outDir, paddedIdx, cmdSlug,
          undefined,
          (entry) => trace.push({ stepIndex: i, mode: 'interaction', ...entry }),
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  [interaction] step ${i} ("${step.command}") did not complete: ${msg}`);
        console.warn('  Stopping interaction-mode trace here — comparing what was collected so far.');
        break;
      }
    }
  } finally {
    await browser.close();
  }

  return trace;
}

/** One line describing a trace entry, or its absence, for the divergence report. */
function describeEntry(entry: ScenarioTraceEntry | null): string {
  if (entry === null) return '(none — this side\'s trace ended here)';
  return `step ${entry.stepIndex}, command="${entry.command}", success=${entry.success}, tickCountAfter=${JSON.stringify(entry.tickCountAfter)}`;
}

async function main(): Promise<void> {
  const scenarioName = process.argv[2];
  if (scenarioName === undefined) {
    console.error('Usage: npx tsx scripts/compare-scenario-traces.ts <scenario-name>');
    process.exit(1);
    return;
  }

  const def = loadScenarioDef(scenarioName, SCENARIO_DIR);
  const steps = def.steps;

  console.log('\nBlastSimulator2026 — Scenario Trace Comparison');
  console.log(`Scenario: ${scenarioName} (${steps.length} steps)`);

  let commandTrace: ScenarioTraceEntry[];
  try {
    console.log('\nRunning command mode...');
    commandTrace = runCommandTrace(scenarioName, steps);
    console.log(`  command mode: ${commandTrace.length} trace entries`);
  } catch (err: unknown) {
    console.error(`Command-mode run failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  let interactionTrace: ScenarioTraceEntry[];
  try {
    console.log('Running interaction mode...');
    interactionTrace = await runInteractionTrace(scenarioName, steps, DEV_SERVER_PORT);
    console.log(`  interaction mode: ${interactionTrace.length} trace entries`);
  } catch (err: unknown) {
    console.error(`Interaction-mode run failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  const divergence = compareTraces(commandTrace, interactionTrace);

  if (divergence === null) {
    console.log(`\nNo divergence found — both modes agree on all ${commandTrace.length} trace entries.`);
    process.exit(0);
    return;
  }

  console.log(`\nDivergence found at trace index ${divergence.firstDivergentIndex}:`);
  console.log(`  command:     ${describeEntry(divergence.command)}`);
  console.log(`  interaction: ${describeEntry(divergence.interaction)}`);
  process.exit(1);
}

main().catch(err => {
  console.error('Trace comparison failed:', err);
  process.exit(1);
});
