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
 */

import { readdirSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import puppeteer from 'puppeteer';
import { resolveChromePath } from './shared/chrome.js';
import { executeActionOnPage } from './shared/interaction-executor.js';
import type { InteractionStepAction, ScenarioStepDef } from './shared/scenario-types.js';
import {
  createGameEngine,
  runScenario,
  type ScenarioResult,
} from './shared/command-runner.js';
import {
  formatStepIndex,
  formatCommandSlug,
  loadScenarioDef,
  parseScenarioSteps,
} from './shared/scenario-utils.js';

const SCENARIO_DIR = resolve(import.meta.dirname, 'scenario-defs');
const SCREENSHOT_DIR = resolve(import.meta.dirname, '..', 'screenshots');
const DEV_SERVER_PORT = 5173;

function parseArgs(): { mode: string; scenarios: string[]; port: number } {
  const args = process.argv.slice(2);
  let mode = 'command';
  let port = DEV_SERVER_PORT;
  const scenarios: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1];
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else {
      scenarios.push(args[i]);
    }
  }

  return { mode, scenarios, port };
}

function loadLocalScenarioDefs(name: string): { steps: ScenarioStepDef[]; shots?: { name: string; yaw: number; pitch: number }[] } {
  const def = loadScenarioDef(name, SCENARIO_DIR);
  const result: { steps: ScenarioStepDef[]; shots?: { name: string; yaw: number; pitch: number }[] } = {
    steps: parseScenarioSteps(def),
  };
  if (def.shots) {
    result.shots = def.shots;
  }
  return result;
}

async function runBatchInteraction(
  names: string[],
  port: number,
): Promise<ScenarioResult[]> {
  const executablePath = resolveChromePath();
  console.log('\nLaunching shared browser...');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results: ScenarioResult[] = [];
  const startTime = Date.now();

  try {
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const outDir = resolve(SCREENSHOT_DIR, `scenario-${name}-interaction`);
      mkdirSync(outDir, { recursive: true });

      try {
        const { steps, shots: scenarioShots } = loadLocalScenarioDefs(name);
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Navigate to the game (happens once per scenario fresh tab)
        await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
        await page.evaluate(() => {
          const menu = document.getElementById('bs-main-menu');
          if (menu) (menu as HTMLElement).style.display = 'none';
        });

        let failed = false;
        let errorMsg = '';

        for (let s = 0; s < steps.length; s++) {
          const step = steps[s];
          const paddedIdx = formatStepIndex(s);
          const cmdSlug = formatCommandSlug(step.command);
          const stepTimeout = (step.timeout ?? 60) * 1000;

          try {
            await Promise.race([
              (async () => {
                // Execute interaction actions
                if (step.interaction && step.interaction.length > 0) {
                  for (const action of step.interaction) {
                    if (action.type === 'screenshot') continue;
                    await executeActionOnPage(page, action as InteractionStepAction);
                  }
                }

                // Reset tick accumulator
                await page.evaluate(() => {
                  if (typeof (window as any).__resetTickAccumulator === 'function') {
                    (window as any).__resetTickAccumulator();
                  }
                });

                // Extract game state
                const gameState = await page.evaluate(() => {
                  if (typeof (window as any).__gameState === 'function') {
                    return (window as any).__gameState();
                  }
                  return null;
                });

                // Save state JSON
                const stateData = {
                  step: s,
                  command: step.command,
                  commandOutput: await page.evaluate(() => {
                    if (typeof (window as any).__gameState === 'function') {
                      const state = (window as any).__gameState();
                      if (state && state.lastCommandOutput) return String(state.lastCommandOutput);
                    }
                    return '';
                  }),
                  gameState,
                  uiState: null,
                };
                const statePath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.json`);
                writeFileSync(statePath, JSON.stringify(stateData, null, 2));
              })(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Step ${s} timed out after ${stepTimeout}ms`)), stepTimeout)
              ),
            ]);
          } catch (err: any) {
            failed = true;
            errorMsg = err.message ?? String(err);
            break;
          }
        }

        await page.close();
        results.push({ name, totalSteps: steps.length, failed, error: failed ? errorMsg : undefined });
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
  } finally {
    await browser.close();
  }

  return results;
}

async function main(): Promise<void> {
  const { mode, scenarios: filterScenarios, port } = parseArgs();

  const scenarioFiles = readdirSync(SCENARIO_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();

  const names = filterScenarios.length > 0 ? filterScenarios : scenarioFiles;

  console.log(`\nBlastSimulator2026 — Batch Scenario Runner`);
  console.log(`Mode: ${mode}`);
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
        const steps = loadLocalScenarioDefs(name).steps;
        const result = runScenario(engine, name, steps, SCREENSHOT_DIR);
        results.push(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n[${name}] FAILED — ${msg}`);
        results.push({ name, totalSteps: 0, failed: true, error: msg });
      }

      const passed = results.filter(r => !r.failed).length;
      const failed = results.filter(r => r.failed).length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Progress: ${i + 1}/${names.length} (${passed} passed, ${failed} failed) [${elapsed}s]`);
    }
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