import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SCENARIO_DIR = resolve(__dirname, '../../scripts/scenario-defs');

const SCENARIO_NAMES = [
  'level1-playthrough-win',
  'level1-playthrough-revolt',
  'level2-playthrough-win',
  'level2-playthrough-bankruptcy',
  'level3-playthrough-win',
  'level3-playthrough-ecology',
] as const;

const KNOWN_COMMANDS = [
  'new_game', 'campaign', 'time', 'scores', 'finances',
  'employee', 'state', 'survey', 'tick', 'event',
  'drill_plan', 'charge', 'sequence', 'blast', 'contract',
  'build', 'vehicle', 'stats', 'inspect', 'zone',
  'corrupt', 'mafia', 'buy_software', 'buy', 'weather',
  'fragments', 'preview', 'blast_preview', 'install_tubing',
  'build_ramp', 'set_policy', 'terrain_info', 'help',
  'blast_plan', 'building', 'demolish', 'research', 'hire',
  'assign', 'vehicle_buy',
];

/** Commands that inspect state — valid as a final playthrough step */
const INSPECTION_COMMANDS = ['campaign', 'state', 'scores', 'finances', 'stats', 'inspect'];

interface ScenarioDef {
  name: string;
  description: string;
  steps: string[];
}

function loadScenario(name: string): ScenarioDef {
  const filePath = resolve(SCENARIO_DIR, `${name}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ScenarioDef;
}

// ──────────────────────────────────────────────
// 1. File existence & valid JSON
// ──────────────────────────────────────────────
describe('Scenario JSON files exist and parse', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name}.json exists on disk`, () => {
      const filePath = resolve(SCENARIO_DIR, `${name}.json`);
      expect(existsSync(filePath)).toBe(true);
    });

    it(`${name}.json parses as valid JSON`, () => {
      const filePath = resolve(SCENARIO_DIR, `${name}.json`);
      const raw = readFileSync(filePath, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  }
});

// ──────────────────────────────────────────────
// 2. Required fields
// ──────────────────────────────────────────────
describe('Scenario has required top-level fields', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} has "name" field (string)`, () => {
      const scenario = loadScenario(name);
      expect(scenario).toHaveProperty('name');
      expect(typeof scenario.name).toBe('string');
    });

    it(`${name} has "description" field (string)`, () => {
      const scenario = loadScenario(name);
      expect(scenario).toHaveProperty('description');
      expect(typeof scenario.description).toBe('string');
    });

    it(`${name} has "steps" field (array)`, () => {
      const scenario = loadScenario(name);
      expect(scenario).toHaveProperty('steps');
      expect(Array.isArray(scenario.steps)).toBe(true);
    });
  }
});

// ──────────────────────────────────────────────
// 3. name matches filename
// ──────────────────────────────────────────────
describe('Scenario name matches filename', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name}.json has name === "${name}"`, () => {
      const scenario = loadScenario(name);
      expect(scenario.name).toBe(name);
    });
  }
});

// ──────────────────────────────────────────────
// 4. Steps array is not empty
// ──────────────────────────────────────────────
describe('Scenario steps are non-empty', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} has non-empty steps array`, () => {
      const scenario = loadScenario(name);
      expect(scenario.steps.length).toBeGreaterThan(0);
    });
  }
});

// ──────────────────────────────────────────────
// 5. Minimum step count for playthrough
// ──────────────────────────────────────────────
describe('Scenario has sufficient steps for a playthrough', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} has at least 15 steps`, () => {
      const scenario = loadScenario(name);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(15);
    });
  }
});

// ──────────────────────────────────────────────
// 6. All steps are strings
// ──────────────────────────────────────────────
describe('All steps are strings', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} — every step is a string`, () => {
      const scenario = loadScenario(name);
      for (let i = 0; i < scenario.steps.length; i++) {
        expect(
          typeof scenario.steps[i],
          `step[${i}] should be a string, got ${typeof scenario.steps[i]}`,
        ).toBe('string');
      }
    });
  }
});

// ──────────────────────────────────────────────
// 7. Description is meaningful (>20 chars)
// ──────────────────────────────────────────────
describe('Scenario description is meaningful', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} description length > 20 characters`, () => {
      const scenario = loadScenario(name);
      expect(scenario.description.length).toBeGreaterThan(20);
    });
  }
});

// ──────────────────────────────────────────────
// 8. All step first tokens are known commands
// ──────────────────────────────────────────────
describe('All steps use known console commands', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} — every step starts with a known command`, () => {
      const scenario = loadScenario(name);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const firstToken = step.trim().split(/\s+/)[0];
        expect(
          KNOWN_COMMANDS,
          `step[${i}]: "${step}" — unknown command "${firstToken}"`,
        ).toContain(firstToken);
      }
    });
  }
});

// ──────────────────────────────────────────────
// 9. Last step is a state inspection command
// ──────────────────────────────────────────────
describe('Last step is a state inspection command', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} — final step is an inspection command`, () => {
      const scenario = loadScenario(name);
      const lastStep = scenario.steps[scenario.steps.length - 1];
      const firstToken = lastStep.trim().split(/\s+/)[0];
      expect(
        INSPECTION_COMMANDS,
        `last step: "${lastStep}" — "${firstToken}" is not an inspection command`,
      ).toContain(firstToken);
    });
  }
});

// ──────────────────────────────────────────────
// 10. No steps use unknown / unregistered commands
//     (complementary to test 8 — explicit negative check)
// ──────────────────────────────────────────────
describe('No steps use unknown commands', () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} — no step references an unknown command`, () => {
      const scenario = loadScenario(name);
      const unknownCommands: string[] = [];
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const firstToken = step.trim().split(/\s+/)[0];
        if (!KNOWN_COMMANDS.includes(firstToken)) {
          unknownCommands.push(`step[${i}]: "${step}"`);
        }
      }
      expect(unknownCommands).toEqual([]);
    });
  }
});
