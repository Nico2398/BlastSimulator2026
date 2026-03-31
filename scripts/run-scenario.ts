/**
 * BlastSimulator2026 — CLI Scenario Runner (no browser required)
 *
 * Runs a sequence of game commands through the ConsoleRunner in pure Node.js.
 * Outputs command results and game state after each step. Designed for use
 * by coding agents (Copilot, etc.) that cannot launch a browser.
 *
 * Usage:
 *   npx tsx scripts/run-scenario.ts --scenario blast-basic
 *   npx tsx scripts/run-scenario.ts --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; blast"
 *   npx tsx scripts/run-scenario.ts --scenario blast-basic --json
 *
 * Options:
 *   --scenario <name>     Load steps from scripts/scenario-defs/<name>.json
 *   --commands "c1; c2"   Inline semicolon-separated commands
 *   --name <label>        Optional label for the run
 *   --json                Output structured JSON report instead of human-readable text
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRunner } from '../src/console/createRunner.js';

interface StepResult {
  step: number;
  command: string;
  success: boolean;
  output: string;
  state: Record<string, unknown> | null;
}

function parseArgs(): { name: string; steps: string[]; jsonMode: boolean } {
  const args = process.argv.slice(2);
  let name = 'cli-scenario';
  let steps: string[] = [];
  let jsonMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      name = args[i + 1];
      const defPath = resolve(process.cwd(), `scripts/scenario-defs/${name}.json`);
      if (!existsSync(defPath)) {
        console.error(`Scenario file not found: ${defPath}`);
        process.exit(1);
      }
      const def = JSON.parse(readFileSync(defPath, 'utf-8'));
      steps = def.steps as string[];
      i++;
    } else if (args[i] === '--commands' && args[i + 1]) {
      steps = args[i + 1].split(';').map(c => c.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      name = args[i + 1];
      i++;
    } else if (args[i] === '--json') {
      jsonMode = true;
    }
  }

  return { name, steps, jsonMode };
}

function run(name: string, steps: string[], jsonMode: boolean): void {
  const { runner } = createRunner();
  const results: StepResult[] = [];

  if (!jsonMode) {
    console.log(`\n=== Scenario: ${name} (${steps.length} steps) ===\n`);
  }

  for (let i = 0; i < steps.length; i++) {
    const command = steps[i];
    const result = runner.run(command);

    // Capture state summary after each command
    const stateResult = runner.run('state summary');
    let state: Record<string, unknown> | null = null;
    if (stateResult.success && stateResult.output) {
      try {
        state = JSON.parse(stateResult.output);
      } catch {
        state = null;
      }
    }

    results.push({
      step: i,
      command,
      success: result.success,
      output: result.output,
      state,
    });

    if (!jsonMode) {
      const status = result.success ? '✓' : '✗';
      console.log(`[${String(i).padStart(2, '0')}] ${status} ${command}`);
      if (result.output) {
        // Indent output for readability
        const indented = result.output.split('\n').map(l => `     ${l}`).join('\n');
        console.log(indented);
      }
      console.log();
    }
  }

  if (jsonMode) {
    const report = {
      scenario: name,
      totalSteps: steps.length,
      passed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      steps: results,
    };
    console.log(JSON.stringify(report, null, 2));
  } else {
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`=== Results: ${passed} passed, ${failed} failed out of ${results.length} steps ===`);
  }

  if (results.some(r => !r.success)) {
    process.exit(1);
  }
}

// Main
const { name, steps, jsonMode } = parseArgs();
if (steps.length === 0) {
  console.error('No steps defined. Use --scenario <name> or --commands "cmd1; cmd2; ..."');
  process.exit(1);
}

run(name, steps, jsonMode);
