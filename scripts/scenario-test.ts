/**
 * BlastSimulator2026 — Scenario Test Runner
 *
 * Runs a sequence of game commands in headless Chrome, capturing a screenshot
 * and game state dump after EVERY command. Supports multi-angle shots via --shots.
 * Produces a per-step report for visual + logical verification.
 *
 * Usage:
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic
 *   npx tsx scripts/scenario-test.ts --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15"
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --shots "overview:0:45;closeup:90:10;birdseye:0:80"
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --frames 3 --interval 100
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --viewport "1920x1080"
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --port 5174
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --puppeteer-path "/path/to/chrome"
 *
 * --shots format: name:yaw:pitch;name:yaw:pitch  (degrees)
 *   Each shot is captured after every step, in addition to the default view.
 *   Screenshots: step-NN-cmd.png (default) + step-NN-cmd-shotname.png (each shot)
 *
 * --frames N: capture N sequential frames per step for animation verification
 * --interval MS: milliseconds between animation frames
 * --viewport "WxH": browser viewport size (default 1280x720)
 *
 * Per-step timeouts: scenarios can define `timeout` (seconds) per step.
 * Screenshot size monitoring: warns if PNG > 5MB.
 *
 * Environment variables:
 *   PUPPETEER_EXECUTABLE_PATH — path to Chrome/Chromium executable
 *
 * Output:  screenshots/scenario-{name}/
 *   step-00-new_game.png
 *   step-00-new_game.json      (game state + command output)
 *   step-00-new_game-overview.png   (multi-angle shots)
 *   step-00-new_game-closeup.png
 *   step-00-new_game-f0.png         (animation frames)
 *   step-00-new_game-f1.png
 *   ...
 *   step-01-drill_plan.png
 *   step-01-drill_plan.json
 *   ...
 *   report.json                 (summary)
 */

import { resolve } from 'path';
import type { ScenarioStepDef, StepResult } from './shared/scenario-types.js';
import { createGameEngine, runSteps } from './shared/command-runner.js';
import {
  formatStepIndex,
} from './shared/scenario-utils.js';
import { parseArgs } from './scenario-cli.js';
import { runScenarioInteraction } from './scenario-interaction-runner.js';

const SCREENSHOT_DIR = resolve(process.cwd(), 'screenshots');

/** Run scenario in command mode (pure Node.js, no browser). */
async function runScenarioCommand(
  name: string, steps: ScenarioStepDef[], reportDrift = false,
): Promise<StepResult[]> {
  const engine = createGameEngine();
  const outDir = resolve(SCREENSHOT_DIR, `scenario-${name}-command`);

  console.log(`\n--- Scenario: ${name} ---`);
  const results = runSteps(engine, steps, outDir, reportDrift);

  // Print per-step summary to stdout (matching expected CI output format)
  for (const r of results) {
    const paddedIdx = formatStepIndex(r.step);
    console.log(`  ${paddedIdx} ${r.command}`);
    console.log(`    Output: ${r.commandOutput.substring(0, 120)}`);
    if (r.gameState) {
      console.log(`    Holes: ${r.gameState.holeCount}, Charged: ${r.gameState.chargedCount}, Sequenced: ${r.gameState.sequencedCount}`);
    }
    if (r.error) console.error(`    ERROR: ${r.error}`);
    console.log(`    State: ${r.statePath}`);
  }

  return results.map(r => ({
    step: r.step,
    command: r.command,
    commandOutput: r.commandOutput,
    gameState: r.gameState as unknown as Record<string, unknown>,
    uiState: null,
    screenshotPath: '',
    statePath: r.statePath,
    ...(r.error !== undefined ? { error: r.error } : {}),
  }));
}

// Main
const { name, steps, shots, port, puppeteerPath, frames, intervalMs, viewport, mode, screenshots, reportDrift } = parseArgs();
if (steps.length === 0) {
  console.error('No steps defined. Use --scenario <name> or --commands "cmd1; cmd2; ..."');
  process.exit(1);
}

console.log(`Mode: ${mode}`);
if (mode === 'command') {
  console.log('Engine: Node.js (pure logic, no browser)');
} else {
  console.log(`Viewport: ${viewport.width}x${viewport.height}`);
  console.log(`Dev server port: ${port}`);
  console.log(`Screenshots: ${screenshots ? 'enabled' : 'disabled (use --screenshots to enable)'}`);
  if (shots.length > 0) {
    console.log(`Multi-angle shots: ${shots.map(s => `${s.name}(${s.yaw}°,${s.pitch}°)`).join(', ')}`);
  }
  if (frames > 1) {
    console.log(`Animation frames: ${frames} at ${intervalMs}ms interval`);
  }
}

/**
 * A resolved run reports each step's outcome in `results`, not by rejecting —
 * so exiting 0 whenever the promise merely *resolves* reports success on a
 * run that failed partway through. Checked here so a local
 * `npm run scenario -- ...` reflects the same pass/fail its own step log shows.
 */
function exitForResults(results: StepResult[]): never {
  const failed = results.filter(r => r.error !== undefined);
  if (failed.length > 0) {
    console.error(`\nScenario FAILED — ${failed.length}/${results.length} step(s) errored.`);
    process.exit(1);
  }
  console.log('\nScenario complete.');
  process.exit(0);
}

if (mode === 'command') {
  runScenarioCommand(name, steps, reportDrift)
    .then(exitForResults)
    .catch(err => {
      console.error('Scenario failed:', err);
      process.exit(1);
    });
} else {
  runScenarioInteraction(name, steps, shots, port, puppeteerPath, frames, intervalMs, viewport, screenshots, SCREENSHOT_DIR)
    .then(exitForResults)
    .catch(err => {
      console.error('Scenario failed:', err);
      process.exit(1);
    });
}
