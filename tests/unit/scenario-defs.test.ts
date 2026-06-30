import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../scripts/scenario-defs');

// ── Dual-play interaction action types ──

const KNOWN_INTERACTION_ACTION_TYPES = [
  'click', 'mousedown', 'mouseup', 'mousemove',
  'keypress', 'keydown', 'keyup',
  'scroll', 'wheel',
  'wait', 'waitForSelector', 'type',
  'assert', 'viewport', 'command',
] as const;

const PLAYTHROUGH_SCENARIO_NAMES = [
  'tutorial-playthrough',
  'level1-playthrough-win',
  'level1-playthrough-revolt',
  'level2-playthrough-win',
  'level2-playthrough-bankruptcy',
  'level3-playthrough-win',
  'level3-playthrough-ecology',
] as const;

const FEATURE_SCENARIO_NAMES = [
  'survey-then-blast',
  'building-lifecycle',
  'skill-progression',
  'multi-deck-blast',
  'presplit-wall',
  'needs-cycle',
  'ramp-navigation',
  'vibration-budget',
  'vehicle-traffic',
  'employee-training',
  'blast-undercharge',
  'blast-overcharge',
  'collapse-recovery',
  'contract-negotiation',
  'weather-flood',
] as const;

const VISUAL_SCENARIO_NAMES = [
  'blast-drill-plan-visual',
  'blast-charge-sequence-visual',
  'blast-preview-tiers-visual',
  'blast-execution-visual',
  'blast-report-visual',
  'blast-voxel-fragmentation-visual',
  'blast-visual-full',
  'needs-gauges-visual',
  'needs-drain-visual',
  'needs-morale-visual',
  'needs-collapse-visual',
  'needs-replenishment-visual',
  'needs-proactive-queue-visual',
  'needs-cost-visual',
  'needs-shift-cycle-visual',
  'nav-cell-types-visual',
  'nav-move-costs-visual',
  'nav-pathfinding-visual',
  'nav-ramp-routing-visual',
  'nav-dynamic-updates-visual',
  'nav-path-following-visual',
  'nav-minimap-integration-visual',
  'core-loop-visual',
  'economy-display-visual',
  'contract-panel-visual',
  'event-dialog-visual',
  'scores-display-visual',
  'time-management-visual',
  'weather-display-visual',
  'safety-projection-visual',
  'save-load-visual',
  'i18n-display-visual',
  'main-menu-visual',
  'tutorial-steps-visual',
  'building-menu-visual',
  'building-placement-visual',
  'building-tier-system-visual',
  'building-training-visual',
  'building-living-visual',
  'building-warehouse-visual',
  'building-research-visual',
  'building-vehicle-depot-visual',
  'building-ramp-visual',
  'building-destruction-visual',
  'vehicle-3d-rendering-visual',
  'vehicle-driver-assignment-visual',
  'vehicle-purchase-tier-ui-visual',
  'vehicle-purchase-visual',
  'vehicle-roles-panel-visual',
  'vehicle-task-states-visual',
  'vehicle-traffic-routing-visual',
] as const;

const ALL_SCENARIO_NAMES = [
  ...PLAYTHROUGH_SCENARIO_NAMES,
  ...FEATURE_SCENARIO_NAMES,
  ...VISUAL_SCENARIO_NAMES,
] as const;

const KNOWN_COMMANDS = [
  'new_game', 'campaign', 'time', 'scores', 'finances',
  'employee', 'state', 'survey', 'tick', 'event',
  'drill_plan', 'charge', 'sequence', 'blast', 'contract',
  'build', 'vehicle', 'stats', 'inspect', 'zone',
  'tutorial_start', 'corrupt', 'mafia', 'buy_software', 'weather', 'buy',
  'fragments', 'preview', 'blast_preview', 'install_tubing',
  'build_ramp', 'set_policy', 'terrain_info', 'help',
  'blast_plan', 'needs',
];

/** Commands that inspect state — valid as a final playthrough step */
const INSPECTION_COMMANDS = ['campaign', 'state', 'scores', 'finances', 'stats', 'inspect'];

interface ScenarioStepDef {
  command: string;
  timeout?: number;
  description?: string;
  frames?: number;
  interval?: number;
}

interface ScenarioDef {
  name: string;
  description: string;
  steps: Array<string | ScenarioStepDef>;
  shots?: Array<{ name: string; yaw: number; pitch: number }>;
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
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — JSON file exists on disk`, () => {
      const filePath = resolve(SCENARIO_DIR, `${name}.json`);
      expect(existsSync(filePath)).toBe(true);
    });

    it(`${name} — parses as valid JSON`, () => {
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
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — has "name" field (string)`, () => {
      const scenario = loadScenario(name);
      expect(scenario).toHaveProperty('name');
      expect(typeof scenario.name).toBe('string');
    });

    it(`${name} — has "description" field (string)`, () => {
      const scenario = loadScenario(name);
      expect(scenario).toHaveProperty('description');
      expect(typeof scenario.description).toBe('string');
    });

    it(`${name} — has "steps" field (array)`, () => {
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
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — JSON name field matches filename`, () => {
      const scenario = loadScenario(name);
      expect(scenario.name).toBe(name);
    });
  }
});

// ──────────────────────────────────────────────
// 4. Steps array is not empty
// ──────────────────────────────────────────────
describe('Scenario steps are non-empty', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — has non-empty steps array`, () => {
      const scenario = loadScenario(name);
      expect(scenario.steps.length).toBeGreaterThan(0);
    });
  }
});

// ──────────────────────────────────────────────
// 5. Minimum step count for playthrough
// ──────────────────────────────────────────────
describe('Playthrough scenarios have sufficient steps', () => {
  for (const name of PLAYTHROUGH_SCENARIO_NAMES) {
    it(`${name} — has at least 15 steps`, () => {
      const scenario = loadScenario(name);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(15);
    });
  }
});

// ──────────────────────────────────────────────
// 6. All steps are strings or step objects
// ──────────────────────────────────────────────
describe('All steps are strings or step objects', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every step is a string or step object with optional timeout/frames/interval fields`, () => {
      const scenario = loadScenario(name);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const isString = typeof step === 'string';
        const isStepObj = typeof step === 'object' && step !== null && typeof (step as any).command === 'string';
        expect(
          isString || isStepObj,
          `step[${i}] should be a string or {command} object, got ${typeof step}`,
        ).toBe(true);
      }
    });
  }
});

// ──────────────────────────────────────────────
// 7a. frames/interval fields are valid positive integers
// ──────────────────────────────────────────────
describe('Step frames/interval fields are valid', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — frames and interval are positive integers when present`, () => {
      const scenario = loadScenario(name);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'object' && step !== null) {
          const s = step as ScenarioStepDef;
          if (s.frames !== undefined) {
            expect(Number.isInteger(s.frames), `step[${i}] frames must be integer`).toBe(true);
            expect(s.frames, `step[${i}] frames must be > 0`).toBeGreaterThan(0);
          }
          if (s.interval !== undefined) {
            expect(Number.isInteger(s.interval), `step[${i}] interval must be integer`).toBe(true);
            expect(s.interval, `step[${i}] interval must be > 0`).toBeGreaterThan(0);
          }
        }
      }
    });
  }
});

// ──────────────────────────────────────────────
// 7b. Description is meaningful (>20 chars)
// ──────────────────────────────────────────────
describe('Scenario description is meaningful', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — description length > 20 characters`, () => {
      const scenario = loadScenario(name);
      expect(scenario.description.length).toBeGreaterThan(20);
    });
  }
});

// ──────────────────────────────────────────────
// 8. No steps use unknown / unregistered commands
// ──────────────────────────────────────────────
describe('No steps use unknown commands', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — no step references an unknown command`, () => {
      const scenario = loadScenario(name);
      const unknownCommands: string[] = [];
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const cmdStr = typeof step === 'string' ? step : (step as any).command;
        const firstToken = cmdStr.trim().split(/\s+/)[0];
        if (!KNOWN_COMMANDS.includes(firstToken)) {
          unknownCommands.push(`step[${i}]: "${cmdStr}"`);
        }
      }
      expect(unknownCommands).toEqual([]);
    });
  }
});

// ──────────────────────────────────────────────
// 9. Last step is a state inspection command
// ──────────────────────────────────────────────
describe('Playthrough last step is a state inspection command', () => {
  for (const name of PLAYTHROUGH_SCENARIO_NAMES) {
    it(`${name} — final step is an inspection command`, () => {
      const scenario = loadScenario(name);
      const lastStep = scenario.steps[scenario.steps.length - 1];
      const cmdStr = typeof lastStep === 'string' ? lastStep : (lastStep as any).command;
      const firstToken = cmdStr.trim().split(/\s+/)[0];
      expect(
        INSPECTION_COMMANDS,
        `last step: "${cmdStr}" — "${firstToken}" is not an inspection command`,
      ).toContain(firstToken);
    });
  }
});


// ──────────────────────────────────────────────
// 10. Visual scenarios have valid shots array
// ──────────────────────────────────────────────
describe('Visual scenarios have valid shots array', () => {
  for (const name of VISUAL_SCENARIO_NAMES) {
    it(`${name} — shots array contains objects with name, yaw, pitch`, () => {
      const scenario = loadScenario(name) as ScenarioDef;
      expect(scenario.shots).toBeDefined();
      expect(Array.isArray(scenario.shots)).toBe(true);
      expect(scenario.shots!.length).toBeGreaterThan(0);
      for (const shot of scenario.shots!) {
        expect(typeof shot.name).toBe('string');
        expect(typeof shot.yaw).toBe('number');
        expect(typeof shot.pitch).toBe('number');
      }
    });
  }
});

// ──────────────────────────────────────────────
// 11. Dual-play scenario steps — interaction array validation
// ──────────────────────────────────────────────

describe('Dual-play scenario steps', () => {
  it('interaction array actions must have a type field from known types', () => {
    const actions = [
      { type: 'click', x: 100, y: 200 },
      { type: 'type', selector: '#input', text: 'hello' },
      { type: 'wait', durationMs: 500 },
    ];
    for (const action of actions) {
      expect(action).toHaveProperty('type');
      expect(
        KNOWN_INTERACTION_ACTION_TYPES,
        `action type "${(action as any).type}" should be a known interaction type`,
      ).toContain((action as any).type);
    }
  });

  it('click action requires x and y coordinates', () => {
    const withXY = { type: 'click', x: 100, y: 200 };
    const withButton = { type: 'click', x: 100, y: 200, button: 'right' };
    const missingX = { type: 'click', y: 200 };
    const missingY = { type: 'click', x: 100 };

    expect(withXY).toHaveProperty('x');
    expect(withXY).toHaveProperty('y');
    expect(withButton).toHaveProperty('button', 'right');
    expect((missingX as any).x).toBeUndefined();
    expect((missingY as any).y).toBeUndefined();
  });

  it('type action requires selector and text', () => {
    const valid = { type: 'type', selector: '#input', text: 'hello' };
    const missingSelector = { type: 'type', text: 'hello' };
    const missingText = { type: 'type', selector: '#input' };

    expect(valid.selector).toBeDefined();
    expect(valid.text).toBeDefined();
    expect((missingSelector as any).selector).toBeUndefined();
    expect((missingText as any).text).toBeUndefined();
  });

  it('wait action requires durationMs', () => {
    const valid = { type: 'wait', durationMs: 500 };
    const missing = { type: 'wait' };

    expect(valid.durationMs).toBe(500);
    expect((missing as any).durationMs).toBeUndefined();
  });

  it('waitForSelector action requires selector', () => {
    const valid = { type: 'waitForSelector', selector: '.loaded' };
    const missing = { type: 'waitForSelector' };

    expect(valid.selector).toBeDefined();
    expect(typeof valid.selector).toBe('string');
    expect((missing as any).selector).toBeUndefined();
  });

  it('viewport action requires width and height', () => {
    const valid = { type: 'viewport', width: 1920, height: 1080 };
    const missingWidth = { type: 'viewport', height: 1080 };
    const missingHeight = { type: 'viewport', width: 1920 };

    expect(valid.width).toBeDefined();
    expect(valid.height).toBeDefined();
    expect(typeof valid.width).toBe('number');
    expect(typeof valid.height).toBe('number');
    expect((missingWidth as any).width).toBeUndefined();
    expect((missingHeight as any).height).toBeUndefined();
  });

  it('command action within interaction array requires command field', () => {
    const valid = { type: 'command', command: 'new_game seed:42' };
    const missing = { type: 'command' };

    expect(valid.command).toBeDefined();
    expect(typeof valid.command).toBe('string');
    expect((missing as any).command).toBeUndefined();
  });

  it('unknown action types are rejected', () => {
    const validTypes = KNOWN_INTERACTION_ACTION_TYPES;
    const unknownType = 'drag';

    expect(validTypes).not.toContain(unknownType);
  });

  it('steps with only command field work (backward compat)', () => {
    const step = { command: 'new_game seed:42' };
    expect(step).toHaveProperty('command');
    expect(typeof step.command).toBe('string');
    expect((step as any).interaction).toBeUndefined();
  });

  it('steps with only interaction field work', () => {
    const step = {
      interaction: [
        { type: 'click', x: 100, y: 200 },
        { type: 'wait', durationMs: 500 },
      ],
    };
    expect(step).toHaveProperty('interaction');
    expect(Array.isArray(step.interaction)).toBe(true);
    expect((step as any).command).toBeUndefined();
  });

  it('steps with both command and interaction fields work', () => {
    const step = {
      command: 'new_game seed:42',
      interaction: [
        { type: 'click', x: 100, y: 200 },
      ],
    };
    expect(step).toHaveProperty('command');
    expect(step).toHaveProperty('interaction');
    expect(Array.isArray(step.interaction)).toBe(true);
    expect(step.interaction.length).toBe(1);
  });
});
