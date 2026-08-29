/**
 * Command-mode batch loop for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 */

import { createGameEngine, runScenario, type ScenarioResult } from './shared/command-runner.js';
import { loadScenarioDef, SCENARIO_DIR } from './shared/scenario-utils.js';
import { SCREENSHOT_DIR } from './shared/puppeteer-utils.js';
import { buildScenarioLoadFailure, logBatchProgress } from './run-all-scenarios-result.js';

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
    const name = names[i];
    try {
      const steps = loadScenarioDef(name!, SCENARIO_DIR).steps;
      const result = runScenario(engine, name!, steps, SCREENSHOT_DIR, reportDrift);
      results.push(result);
    } catch (err: unknown) {
      results.push(buildScenarioLoadFailure(name!, err));
    }

    logBatchProgress(results, i, names.length, startTime);
  }

  return results;
}
