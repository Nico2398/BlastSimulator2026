// BlastSimulator2026 — Shared command-mode runner
// Runs scenario steps in pure Node.js (no browser, no Puppeteer).
// Used by both scenario-test.ts (single scenario) and run-all-scenarios.ts (batch).

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRunner, serializeGameState } from '../../src/console-api.js';
import { runCommand } from '../../src/console/createRunner.js';
import type { RunnerWithContext } from '../../src/console/createRunner.js';
import type { InteractionStepAction, ScenarioStepDef, StepResult } from './scenario-types.js';
import {
  formatStepIndex,
  formatCommandSlug,
  buildScenarioReport,
  resolveRepeatCount,
  type ReportableStep,
} from './scenario-utils.js';
import { checkGoalAgainstState, checkCommandOutcome, type GoalMismatch } from './scenario-goal.js';
export type { GoalMismatch } from './scenario-goal.js';

/**
 * Command-mode side of the `waitUntil` action (issue #590): loop the
 * console's own `tick 1` — reusing `tickCommand` exactly as it stands via
 * `runCommand`, never duplicating its body — checking the state dump after
 * each tick, up to `maxTicks`. A budget exhausted without a match is a
 * scenario failure naming the field, its last-seen value, and the budget,
 * not a silent pass-through to whatever assertion comes next.
 *
 * Auto-resolves a pending event with its first option each time one fires
 * (#554 finding): `tickCommand` itself refuses to advance at all while
 * `state.events.pendingEvent` is set ("Pending event! Resolve it first"), so
 * a `tick 1` issued after a spontaneous event stops advancing the clock
 * entirely — every further call is a no-op, and a wait long enough to
 * plausibly hit one (charging is real work now, easily hundreds of ticks
 * across a multi-hole plan with only one or two blasters) stalls forever
 * without ever reaching `maxTicks`'s own failure message. Command mode has
 * no player to read the event's content and choose deliberately — every
 * existing scenario's own hand-written long-tick loops already resolve a
 * pending event this same way (`event choose 0`) — so this is the
 * uninterrupted-wait behavior `waitUntil` promises, not a new one.
 * Interaction mode does not need the same fix: its own wait
 * (`interaction-executor.ts`) drives the real, `isPaused`-gated clock, so an
 * event genuinely pauses it exactly as it would for a real player — a
 * scenario wanting to prove that dwells on it with `resolveEventIfPending`.
 */
export function runWaitUntil(
  engine: RunnerWithContext,
  action: Extract<InteractionStepAction, { type: 'waitUntil' }>,
): { output: string; gameState: Record<string, unknown> | null } {
  const { ctx } = engine;
  let lastValue: unknown;
  let lastState: Record<string, unknown> | null = null;
  for (let i = 0; i < action.maxTicks; i++) {
    runCommand(engine, 'tick 1');
    if (ctx.state?.events.pendingEvent) {
      runCommand(engine, 'event choose 0');
    }
    lastState = serializeGameState(ctx) as Record<string, unknown> | null;
    lastValue = lastState ? lastState[action.field] : undefined;
    if (lastValue === action.equals) {
      return {
        output: `waitUntil: "${action.field}" reached ${JSON.stringify(action.equals)} after ${i + 1} tick(s)`,
        gameState: lastState,
      };
    }
  }
  throw new Error(
    `waitUntil: "${action.field}" never reached ${JSON.stringify(action.equals)}`
    + ` — stalled at ${JSON.stringify(lastValue)} after ${action.maxTicks} ticks`,
  );
}

/**
 * Locate a step's `waitUntil` interaction entry, if it has one — the one
 * authoritative field/target/budget spec both command mode (`runWaitUntil`
 * above) and interaction mode (`interaction-executor.ts`) read to drive the
 * tick-loop instead of the step's own `command` string, which is descriptive
 * only and never executed as-is when this is present (issue #590). Exported
 * so callers that replay scenario steps outside `runSteps` (e.g. the
 * command-outcome lint) can detect a `waitUntil` step the same way, rather
 * than re-declaring this predicate.
 */
export function findWaitUntilAction(
  step: ScenarioStepDef,
): Extract<InteractionStepAction, { type: 'waitUntil' }> | undefined {
  return step.interaction?.find(
    (a): a is Extract<InteractionStepAction, { type: 'waitUntil' }> => a.type === 'waitUntil',
  );
}

// Re-export canonical types from scenario-types.ts
export type { StepResult } from './scenario-types.js';

export interface ScenarioResult {
  name: string;
  totalSteps: number;
  failed: boolean;
  error?: string;
  reportPath?: string;
  driftRecords?: DriftRecord[];
}

/**
 * A single drift-report entry (issue #679): one `equals`/`changedBy`
 * mismatch, located to the scenario/step/command that produced it.
 */
export interface DriftRecord extends GoalMismatch {
  scenario: string;
  step: number;
  command: string;
}

/**
 * Formats a batch of `DriftRecord`s into a human-readable report — one line
 * per mismatch, naming the scenario, step, field, expected value, and
 * actual value.
 */
export function formatDriftReport(records: DriftRecord[]): string {
  if (records.length === 0) {
    return 'Drift report: no drift found — every equals/changedBy goal matched exactly.';
  }
  const lines = [`Drift report: ${records.length} mismatch(es) found:`];
  for (const r of records) {
    lines.push(
      `scenario "${r.scenario}" step ${r.step}: ${r.field} expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Writes the raw drift records to `path` as JSON, creating the parent
 * directory if it does not already exist.
 */
export function writeDriftReportFile(records: DriftRecord[], path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(records, null, 2));
}

/**
 * Turns a step's raw `driftMismatches` into `DriftRecord`s tagged with the
 * scenario/step/command that produced them — the one aggregation both
 * `runScenario` (below) and any caller holding its own per-step result array
 * (`scenario-test.ts`, which needs those results for its own console
 * printing and can't just delegate to `runScenario`) need to perform.
 */
export function toDriftRecords(
  results: Array<{ step: number; command: string; driftMismatches?: GoalMismatch[] }>,
  scenario: string,
): DriftRecord[] {
  const records: DriftRecord[] = [];
  for (const r of results) {
    if (r.driftMismatches) {
      for (const m of r.driftMismatches) {
        records.push({ ...m, scenario, step: r.step, command: r.command });
      }
    }
  }
  return records;
}

/**
 * Prints the drift report to stdout, writes it to `path` as JSON, and logs
 * the confirmation — the 4-statement sequence both CLI entry points
 * (`run-all-scenarios.ts`, `scenario-test.ts`) run identically after a
 * `--report-drift` batch, differing only in which directory `path` lands in.
 */
export function emitDriftReport(records: DriftRecord[], path: string): void {
  console.log(`\n${formatDriftReport(records)}`);
  writeDriftReportFile(records, path);
  console.log(`Drift report written to ${path}`);
}

export function createGameEngine(): RunnerWithContext {
  return createRunner();
}

export function runSteps(
  engine: RunnerWithContext,
  steps: ScenarioStepDef[],
  outDir: string,
  reportDrift?: boolean,
): Array<StepResult & { driftMismatches?: GoalMismatch[] }> {
  mkdirSync(outDir, { recursive: true });
  const { ctx } = engine;
  const results: Array<StepResult & { driftMismatches?: GoalMismatch[] }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const paddedIdx = formatStepIndex(i);
    const cmdSlug = formatCommandSlug(step.command);
    const before = (serializeGameState(ctx) as Record<string, unknown> | null) ?? {};
    // `waitUntil` drives command mode too (issue #590) — see
    // `findWaitUntilAction`'s doc comment above for why.
    const waitUntilAction = findWaitUntilAction(step);

    let error: string | undefined;
    let result: { success: boolean; output: string } = { success: false, output: '' };
    let gameState: Record<string, unknown> | null = null;
    let driftMismatches: GoalMismatch[] | undefined;

    try {
      const repeatCount = resolveRepeatCount(step);
      if (repeatCount > 1 && waitUntilAction) {
        throw new Error(`repeat and waitUntil cannot combine on the same step (step ${i}, "${step.command}")`);
      }

      if (waitUntilAction) {
        const waited = runWaitUntil(engine, waitUntilAction);
        result = { success: true, output: waited.output };
        gameState = waited.gameState;

        const outcomeViolation = checkCommandOutcome(step.commandOutcome, result, step.command);
        if (outcomeViolation !== null) throw new Error(outcomeViolation);
      } else {
        // Shared by the repeatCount===1 case and every iteration of the
        // repeatCount>1 loop below — the two used to repeat this same
        // 4-statement sequence verbatim, differing only in the error-message
        // prefix. `iterationLabel` is omitted for the non-repeat case so its
        // error message stays byte-identical to before this was extracted.
        const runOneAttempt = (iterationLabel?: string) => {
          result = runCommand(engine, step.command);
          gameState = serializeGameState(ctx) as Record<string, unknown> | null;
          const outcomeViolation = checkCommandOutcome(step.commandOutcome, result, step.command);
          if (outcomeViolation !== null) {
            throw new Error(iterationLabel ? `${iterationLabel}: ${outcomeViolation}` : outcomeViolation);
          }
        };

        if (repeatCount === 1) {
          runOneAttempt();
        } else {
          for (let j = 0; j < repeatCount; j++) {
            runOneAttempt(`repeat ${j + 1}/${repeatCount}`);
          }
        }
      }

      if (step.expect) {
        const goalResult = checkGoalAgainstState(step.expect, before, gameState);
        if (reportDrift && goalResult.mismatches.length > 0) {
          driftMismatches = goalResult.mismatches;
        }
        if (goalResult.violation !== null && !(reportDrift && goalResult.isDriftOnly)) {
          throw new Error(`expect failed: ${goalResult.violation}`);
        }
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }

    const stateData = {
      step: i,
      command: step.command,
      commandOutput: result.output,
      gameState,
      uiState: null,
      screenshots: undefined,
    };
    const statePath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.json`);
    writeFileSync(statePath, JSON.stringify(stateData, null, 2));

    results.push({
      step: i,
      command: step.command,
      commandOutput: result.output,
      commandSuccess: result.success,
      gameState,
      statePath,
      ...(error !== undefined ? { error } : {}),
      ...(driftMismatches !== undefined ? { driftMismatches } : {}),
    });
  }

  // Save report using shared builder
  const report = buildScenarioReport(results as ReportableStep[]);
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));

  return results;
}

export function runScenario(
  engine: RunnerWithContext,
  name: string,
  steps: ScenarioStepDef[],
  baseOutDir: string,
  reportDrift?: boolean,
): ScenarioResult {
  const outDir = resolve(baseOutDir, `scenario-${name}-command`);
  const errors: string[] = [];

  console.log(`\n[${name}] Running ${steps.length} steps...`);

  try {
    const results = runSteps(engine, steps, outDir, reportDrift);
    const failedSteps = results.filter(r => r.error);
    for (const fs of failedSteps) {
      errors.push(`  Step ${fs.step} ("${fs.command}"): ${fs.error}`);
    }
    if (failedSteps.length > 0) {
      console.error(`[${name}] FAILED — ${failedSteps.length}/${steps.length} steps failed:`);
      for (const e of errors) console.error(e);
    } else {
      console.log(`[${name}] OK — ${steps.length} steps`);
    }

    const driftRecords: DriftRecord[] = reportDrift ? toDriftRecords(results, name) : [];

    return {
      name,
      totalSteps: steps.length,
      failed: failedSteps.length > 0,
      error: errors.join('\n'),
      reportPath: resolve(outDir, 'report.json'),
      ...(driftRecords.length > 0 ? { driftRecords } : {}),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${name}] FAILED — ${msg}`);
    return { name, totalSteps: steps.length, failed: true, error: msg };
  }
}
