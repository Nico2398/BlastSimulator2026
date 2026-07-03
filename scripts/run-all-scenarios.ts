/**
 * BlastSimulator2026 — Batch Scenario Runner
 *
 * Runs ALL scenario JSON files in a single Node.js process (cold start once)
 * for maximum CI throughput. Reports per-scenario pass/fail with detailed
 * error information and exits with code 1 if any scenario fails.
 *
 * Usage:
 *   npx tsx scripts/run-all-scenarios.ts [--mode command|interaction]
 *
 * Default mode: command (pure Node.js, no browser).
 * Interaction mode starts a dev server automatically.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  createGameEngine,
  runScenario,
  type ScenarioStep,
  type ScenarioResult,
} from './shared/command-runner.js';

const SCENARIO_DIR = resolve(import.meta.dirname, 'scenario-defs');
const SCREENSHOT_DIR = resolve(import.meta.dirname, '..', 'screenshots');

function parseArgs(): { mode: string; scenarios: string[] } {
  const args = process.argv.slice(2);
  let mode = 'command';
  const scenarios: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1];
      i++;
    } else {
      scenarios.push(args[i]);
    }
  }

  return { mode, scenarios };
}

function loadScenario(name: string): ScenarioStep[] {
  const defPath = resolve(SCENARIO_DIR, `${name}.json`);
  if (!existsSync(defPath)) {
    throw new Error(`Scenario not found: ${defPath}`);
  }
  const def = JSON.parse(readFileSync(defPath, 'utf-8'));
  return def.steps.map((s: any) => typeof s === 'string' ? { command: s } : s);
}

async function main(): Promise<void> {
  const { mode, scenarios: filterScenarios } = parseArgs();

  const scenarioFiles = readdirSync(SCENARIO_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();

  const names = filterScenarios.length > 0 ? filterScenarios : scenarioFiles;

  console.log(`\nBlastSimulator2026 — Batch Scenario Runner`);
  console.log(`Mode: ${mode}`);
  console.log(`Scenarios: ${names.length} files`);

  if (mode === 'interaction') {
    console.error('Interaction batch mode not supported yet. Use --mode command or run scenarios individually.');
    process.exit(1);
  }

  // Single cold start — all scenarios share one engine
  console.log('\nInitializing game engine...');
  const engine = createGameEngine();
  console.log(`Engine ready. Running ${names.length} scenarios...`);

  const results: ScenarioResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    try {
      const steps = loadScenario(name);
      const result = runScenario(engine, name, steps, SCREENSHOT_DIR);
      results.push(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[${name}] FAILED — ${msg}`);
      results.push({ name, totalSteps: 0, failed: true, error: msg });
    }

    // Print progress
    const passed = results.filter(r => !r.failed).length;
    const failed = results.filter(r => r.failed).length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Progress: ${i + 1}/${names.length} (${passed} passed, ${failed} failed) [${elapsed}s]`);
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