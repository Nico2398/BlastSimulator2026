// BlastSimulator2026 — Shared command-mode runner
// Runs scenario steps in pure Node.js (no browser, no Puppeteer).
// Used by both scenario-test.ts (single scenario) and run-all-scenarios.ts (batch).

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createRunner, serializeGameState } from '../../src/console-api.js';
import { runCommand } from '../../src/console/createRunner.js';
import type { RunnerWithContext } from '../../src/console/createRunner.js';
import type { ScenarioStepDef, StepResult } from './scenario-types.js';
import {
  formatStepIndex,
  formatCommandSlug,
  buildScenarioReport,
  type ReportableStep,
} from './scenario-utils.js';
import { checkGoalAgainstState, checkCommandOutcome } from './scenario-goal.js';

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

    let error: string | undefined;
    let result: { success: boolean; output: string } = { success: false, output: '' };
    let gameState: Record<string, unknown> | null = null;

    try {
      result = runCommand(engine, step.command);
      gameState = serializeGameState(ctx) as Record<string, unknown> | null;

      const outcomeViolation = checkCommandOutcome(step.commandOutcome, result, step.command);
      if (outcomeViolation !== null) throw new Error(outcomeViolation);

      if (step.expect) {
        const violation = checkGoalAgainstState(step.expect, before, gameState);
        if (violation !== null) throw new Error(`expect failed: ${violation}`);
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
      gameState,
      statePath,
      ...(error !== undefined ? { error } : {}),
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
