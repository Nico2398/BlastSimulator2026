/**
 * Command-mode batch loop for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`): the in-process path `--jobs 1` takes, and
 * the one-scenario body every fan-out worker runs
 * (`run-all-scenarios-worker.ts`), so both paths judge a scenario identically.
 */

import { createGameEngine, runScenario, type ScenarioResult } from './shared/command-runner.js';
import type { RunnerWithContext } from '../src/console/createRunner.js';
import { loadScenarioDef, SCENARIO_DIR } from './shared/scenario-utils.js';
import { SCREENSHOT_DIR } from './shared/puppeteer-utils.js';
import { buildScenarioLoadFailure, logBatchProgress } from './run-all-scenarios-result.js';

/**
 * Loads and runs one scenario against `engine`. A definition that fails to
 * load, or a run that throws past `runScenario`'s own step loop, comes back as
 * a failed result rather than an exception — one bad file never ends a batch.
 */
export function runCommandScenario(engine: RunnerWithContext, name: string, reportDrift: boolean): ScenarioResult {
  try {
    const steps = loadScenarioDef(name, SCENARIO_DIR).steps;
    return runScenario(engine, name, steps, SCREENSHOT_DIR, reportDrift);
  } catch (err: unknown) {
    return buildScenarioLoadFailure(name, err);
  }
}

export function runBatchCommand(
  names: string[],
  reportDrift: boolean,
  startTime: number,
): ScenarioResult[] {
  console.log('\nInitializing game engine...');
  const engine = createGameEngine();
  console.log(`Engine ready. Running ${names.length} scenarios...`);

  const results: ScenarioResult[] = [];
  for (let i = 0; i < names.length; i++) {
    results.push(runCommandScenario(engine, names[i]!, reportDrift));
    logBatchProgress(results, i, names.length, startTime);
  }

  return results;
}
