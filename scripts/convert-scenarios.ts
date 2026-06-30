/**
 * BlastSimulator2026 — Scenario Dual-Play Converter
 *
 * Converts all scenario JSON files from command-only format to dual-play
 * format. Each step gets an `interaction` array alongside its `command`.
 *
 * For command-based steps, the interaction uses `{ type: 'command', command }`
 * which executes via __gameConsole() through the Puppeteer interaction executor.
 * This ensures both execution paths produce identical game state.
 *
 * Usage:
 *   npx tsx scripts/convert-scenarios.ts          # dry run (preview changes)
 *   npx tsx scripts/convert-scenarios.ts --apply   # write changes to disk
 *
 * @module scripts/convert-scenarios
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const SCENARIO_DIR = resolve(process.cwd(), 'scripts/scenario-defs');

interface ScenarioStep {
  command: string;
  timeout?: number;
  description?: string;
  frames?: number;
  interval?: number;
  interaction?: InteractionStepAction[];
}

type InteractionStepAction =
  | { type: 'command'; command: string }
  | { type: 'wait'; durationMs: number };

interface ScenarioDef {
  name: string;
  description: string;
  steps: Array<string | ScenarioStep>;
  shots?: Array<{ name: string; yaw: number; pitch: number }>;
}

/**
 * Converts a single step to dual-play format.
 * - Plain string → { command: string, interaction: [{ type: 'command', command }] }
 * - Object with command only → add interaction array
 * - Object already with interaction → skip (already converted)
 */
function convertStep(step: string | ScenarioStep): ScenarioStep {
  // Plain string step
  if (typeof step === 'string') {
    return {
      command: step,
      interaction: [{ type: 'command', command: step }],
    };
  }

  // Object step — check if already has interaction
  if (step.interaction && Array.isArray(step.interaction) && step.interaction.length > 0) {
    return step; // already converted
  }

  // Object step without interaction — add it
  return {
    ...step,
    interaction: [{ type: 'command', command: step.command }],
  };
}

/**
 * Converts a scenario definition to dual-play format.
 */
function convertScenario(scenario: ScenarioDef): ScenarioDef {
  return {
    ...scenario,
    steps: scenario.steps.map(convertStep),
  };
}

/**
 * Checks if a step is already in dual-play format (has interaction array).
 */
function isAlreadyConverted(step: string | ScenarioStep): boolean {
  if (typeof step === 'string') return false;
  return Array.isArray(step.interaction) && step.interaction.length > 0;
}

// ── Main ──

const applyMode = process.argv.includes('--apply');

const files = readdirSync(SCENARIO_DIR).filter(f => f.endsWith('.json'));
let convertedCount = 0;
let alreadyConvertedCount = 0;
let totalSteps = 0;
let convertedSteps = 0;

console.log(`Found ${files.length} scenario files in ${SCENARIO_DIR}`);
console.log(`Mode: ${applyMode ? 'APPLY (writing changes)' : 'DRY RUN (preview only)'}`);
console.log('');

for (const file of files) {
  const filePath = resolve(SCENARIO_DIR, file);
  const raw = readFileSync(filePath, 'utf-8');
  const scenario: ScenarioDef = JSON.parse(raw);

  const originalSteps = scenario.steps.length;
  const needsConversion = scenario.steps.some(s => !isAlreadyConverted(s));

  if (needsConversion) {
    const converted = convertScenario(scenario);
    convertedCount++;
    convertedSteps += scenario.steps.filter(s => !isAlreadyConverted(s)).length;
    totalSteps += originalSteps;

    if (applyMode) {
      writeFileSync(filePath, JSON.stringify(converted, null, 2) + '\n');
      console.log(`  ✓ ${file} — ${originalSteps} steps converted`);
    } else {
      console.log(`  → ${file} — ${originalSteps} steps to convert`);
    }
  } else {
    alreadyConvertedCount++;
    totalSteps += originalSteps;
    console.log(`  - ${file} — already converted (${originalSteps} steps)`);
  }
}

console.log('');
console.log(`Summary:`);
console.log(`  Total files: ${files.length}`);
console.log(`  Converted: ${convertedCount}`);
console.log(`  Already converted: ${alreadyConvertedCount}`);
console.log(`  Total steps: ${totalSteps}`);
console.log(`  Steps converted: ${convertedSteps}`);

if (!applyMode && convertedCount > 0) {
  console.log('');
  console.log('Run with --apply to write changes to disk.');
}
