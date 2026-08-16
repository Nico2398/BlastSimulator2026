// BlastSimulator2026 — Shared command-mode runner
// Runs scenario steps in pure Node.js (no browser, no Puppeteer).
// Used by both scenario-test.ts (single scenario) and run-all-scenarios.ts (batch).

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createRunner, serializeGameState } from '../../src/console-api.js';
import { runCommand } from '../../src/console/createRunner.js';
import type { RunnerWithContext } from '../../src/console/createRunner.js';
import type { InteractionStepAction, ScenarioStepDef, StepResult } from './scenario-types.js';
import {
  formatStepIndex,
  formatCommandSlug,
  buildScenarioReport,
  type ReportableStep,
} from './scenario-utils.js';
import { checkGoalAgainstState } from './scenario-goal.js';

/**
 * Command-mode side of the `waitUntil` action (issue #590): loop the
 * console's own `tick 1` — reusing `tickCommand` exactly as it stands via
 * `runCommand`, never duplicating its body — checking the state dump after
 * each tick, up to `maxTicks`. A budget exhausted without a match is a
 * scenario failure naming the field, its last-seen value, and the budget,
 * not a silent pass-through to whatever assertion comes next.
 */
function runWaitUntil(
  engine: RunnerWithContext,
  action: Extract<InteractionStepAction, { type: 'waitUntil' }>,
): { output: string; gameState: Record<string, unknown> | null } {
  const { ctx } = engine;
  let lastValue: unknown;
  let lastState: Record<string, unknown> | null = null;
  for (let i = 0; i < action.maxTicks; i++) {
    runCommand(engine, 'tick 1');
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

// Re-export canonical types from scenario-types.ts
export type { StepResult } from './scenario-types.js';

export interface ScenarioResult {
  name: string;
  totalSteps: number;
  failed: boolean;
  error?: string;
  reportPath?: string;
}

export function createGameEngine(): RunnerWithContext {
  return createRunner();
}

export function runSteps(
  engine: RunnerWithContext,
  steps: ScenarioStepDef[],
  outDir: string,
): StepResult[] {
  mkdirSync(outDir, { recursive: true });
  const { ctx } = engine;
  const results: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const paddedIdx = formatStepIndex(i);
    const cmdSlug = formatCommandSlug(step.command);
    const before = (serializeGameState(ctx) as Record<string, unknown> | null) ?? {};
    // `waitUntil` drives command mode too (issue #590) — its `interaction`
    // entry is the one authoritative field/target/budget spec both modes
    // read, so a step using it runs the tick-loop instead of its own
    // `command` string (which is descriptive only, never executed as-is).
    const waitUntilAction = step.interaction?.find(
      (a): a is Extract<InteractionStepAction, { type: 'waitUntil' }> => a.type === 'waitUntil',
    );

    try {
      const result = waitUntilAction
        ? runWaitUntil(engine, waitUntilAction)
        : runCommand(engine, step.command);
      const gameState = serializeGameState(ctx) as Record<string, unknown> | null;

      if (step.expect) {
        const violation = checkGoalAgainstState(step.expect, before, gameState);
        if (violation !== null) throw new Error(`expect failed: ${violation}`);
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
        gameState,
        statePath,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        step: i,
        command: step.command,
        commandOutput: '',
        gameState: null,
        statePath: '',
        error: errorMsg,
      });
    }
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
): ScenarioResult {
  const outDir = resolve(baseOutDir, `scenario-${name}-command`);
  const errors: string[] = [];

  console.log(`\n[${name}] Running ${steps.length} steps...`);

  try {
    const results = runSteps(engine, steps, outDir);
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
    return { name, totalSteps: steps.length, failed: failedSteps.length > 0, error: errors.join('\n'), reportPath: resolve(outDir, 'report.json') };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${name}] FAILED — ${msg}`);
    return { name, totalSteps: steps.length, failed: true, error: msg };
  }
}
