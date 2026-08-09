import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ScenarioDef, ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { getAllVehicleRoles } from '../../src/core/entities/Vehicle.js';
import { checkStepActionAllowed } from '../../scripts/shared/interaction-executor.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

// ── Dual-play interaction action types ──

const KNOWN_INTERACTION_ACTION_TYPES = [
  'click', 'clickSelector', 'mousedown', 'mouseup', 'mousemove',
  'pickTile', 'dragTiles', 'cameraFocus',
  'keypress', 'keydown', 'keyup',
  'scroll', 'wheel',
  'wait', 'waitForSelector', 'waitForTutorialStep', 'type',
  'assert', 'viewport', 'command', 'screenshot',
  'loadingScreenDebug',
  // Shared with the playability harness (issue #479) — same names, same
  // implementations, so a converted step and its playtest counterpart do the
  // same thing. See InteractionStepAction in scripts/shared/scenario-types.ts.
  'set', 'clickLabel', 'awaitUsable', 'zoomOut', 'focusTile', 'clickEntity',
  // Conditional click for genuinely nondeterministic beats (`event choose`
  // after a bare tick). Not an escape hatch — see InteractionStepAction.
  'clickIfPresent',
  // Resolves a pending event via its dialog, deciding from game state rather
  // than DOM render timing. See InteractionStepAction.
  'resolveEventIfPending',
] as const;

const PLAYTHROUGH_SCENARIO_NAMES = [
  'tutorial-playthrough',
  'level1-playthrough-win',
  'level1-playthrough-revolt',
  'level2-playthrough-win',
  'level2-playthrough-bankruptcy',
  'level3-playthrough-win',
  'level3-playthrough-ecology',
  'survey-then-blast-playthrough',
] as const;

const FEATURE_SCENARIO_NAMES = [
  'survey-then-blast',
  'building-lifecycle',
  'research-center-gate',
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
  'blast-basic',
  'blast-charge-loading-ui',
  'blast-detonation-sequence-ui',
  'blast-drill-plan-ui',
  'blast-execution-effects',
  'blast-preview-software-tiers',
  'blast-report-metrics',
  'blast-voxel-fragmentation',
  'employee-skills-visual',
  'level1-lose-arrest',
  'level1-lose-bankruptcy',
  'level1-lose-ecology',
  'level1-lose-revolt',
  'level1-win-conservative',
  'level1-win-efficient',
  'hauling-gate',
  'economy-full-loop',
  'maintenance-cost-drain',
] as const;

const VISUAL_SCENARIO_NAMES = [
  'blast-drill-plan-visual',
  'blast-charge-sequence-visual',
  'blast-preview-tiers-visual',
  'blast-execution-visual',
  'blast-report-visual',
  'blast-voxel-fragmentation-visual',
  'blast-visual-full',
  'employee-skill-progression-visual',
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
  'building-research-progression-visual',
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
  'survey-confidence-display',
  'survey-confidence-overlay',
  'survey-execution',
  'survey-method-selection',
  'survey-ore-vein-visibility',
  'survey-overlay-lifecycle',
  'survey-post-blast-ore-report',
  'survey-result-visualization',
  'survey-seismic-side-effects',
  'survey-stale-handling',
  'tutorial-interactive',
  'scene-picking-visual',
  'landscape-continuity-visual',
] as const;

/**
 * Scenarios that exercise the UI by clicking real controls rather than
 * replaying console commands. These are the ones that prove a panel is
 * reachable and a button is not covered by something else.
 */
const UI_DRIVEN_SCENARIO_NAMES = [
  'tutorial-interactive',
  'building-tier-system-visual',
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
  'build', 'vehicle', 'stats', 'inspect', 'zone', 'research',
  'tutorial_start', 'corrupt', 'mafia', 'buy_software', 'weather', 'buy',
  'fragments', 'preview', 'blast_preview', 'install_tubing',
  'build_ramp', 'set_policy', 'terrain_info', 'help',
  'blast_plan', 'needs', 'save', 'load',
];

/** Commands that inspect state — valid as a final playthrough step */
const INSPECTION_COMMANDS = ['campaign', 'state', 'scores', 'finances', 'stats', 'inspect'];

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
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario).toHaveProperty('name');
      expect(typeof scenario.name).toBe('string');
    });

    it(`${name} — has "description" field (string)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario).toHaveProperty('description');
      expect(typeof scenario.description).toBe('string');
    });

    it(`${name} — has "steps" field (array)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
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
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
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
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
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
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(15);
    });
  }
});

// ──────────────────────────────────────────────
// 6. All steps are objects with command field (strings not allowed after dual-play conversion)
// ──────────────────────────────────────────────
describe('All steps are objects with command field', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every step is an object with a command field (no plain strings)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        expect(typeof step !== 'string',
          `step[${i}] is a plain string "${step}". All steps must be objects with a command field.`,
        ).toBe(true);
        const isStepObj = typeof step === 'object' && step !== null && typeof (step as ScenarioStepDef).command === 'string';
        expect(
          isStepObj,
          `step[${i}] should be an object with a command field, got ${typeof step}`,
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
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
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
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
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
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
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
// 8b. "vehicle buy" steps pass a valid VehicleRole
// Regression: scripts/scenario-defs/vehicle-traffic.json used to pass
// "hauler" as the role argument, which is not a member of VehicleRole
// (the valid id is "debris_hauler"). Because the console command layer
// rejects the buy with CommandResult.success:false rather than throwing,
// `npm run scenarios` (command-mode runner) never surfaced the bug — it
// only fails a step on a thrown exception. This test catches invalid
// role tokens directly against the VehicleRole set instead of relying on
// runtime command execution. See issue #445.
//
// Widened to every scenario in ALL_SCENARIO_NAMES (see issue #450):
// level3-playthrough-win.json, level1-lose-bankruptcy.json,
// level2-playthrough-win.json, level2-playthrough-bankruptcy.json, and
// tutorial-playthrough.json all still carry invalid legacy VehicleRole
// tokens (e.g. "excavator", "truck", "bulldozer", "hauler") in their
// "vehicle buy" steps. This check now covers all of them, not just
// vehicle-traffic.json.
// ──────────────────────────────────────────────
describe('"vehicle buy" steps use a valid VehicleRole', () => {
  const validRoles = getAllVehicleRoles();

  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every "vehicle buy" step's role is a valid VehicleRole`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const invalidRoleSteps: string[] = [];
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const cmdStr = typeof step === 'string' ? step : (step as ScenarioStepDef).command;
        if (!cmdStr.startsWith('vehicle buy ')) continue;
        const role = cmdStr.trim().split(/\s+/)[2];
        if (!validRoles.includes(role as never)) {
          invalidRoleSteps.push(
            `step[${i}]: "${cmdStr}" — role "${role}" is not a valid VehicleRole (valid: ${validRoles.join(', ')})`,
          );
        }
      }
      expect(
        invalidRoleSteps,
        `${name}.json has "vehicle buy" steps with invalid roles:\n${invalidRoleSteps.join('\n')}`,
      ).toEqual([]);
    });
  }
});

// ──────────────────────────────────────────────
// 9. Last step is a state inspection command
// ──────────────────────────────────────────────
describe('Playthrough last step is a state inspection command', () => {
  for (const name of PLAYTHROUGH_SCENARIO_NAMES) {
    it(`${name} — final step is an inspection command`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
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
      const scenario = loadScenarioDef(name, SCENARIO_DIR) as ScenarioDef;
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
// 11. Dual-play scenario steps — interaction array validation (data-driven)
// Note: Some tests (click, type, wait, waitForSelector, viewport, wheel) are
// currently vacuously true because all 99 scenarios only use command-type actions.
// These tests are forward-looking: they validate data when non-command action
// types are added to scenarios in the future.
// ──────────────────────────────────────────────

describe('Dual-play scenario steps — data-driven validation', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — all interaction action types are in the known set`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') {
          throw new Error(`step[${i}] is a plain string — all steps must be objects with interaction arrays`);
        }
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          expect(
            KNOWN_INTERACTION_ACTION_TYPES,
            `step[${i}] action type "${action.type}" is not a known interaction type`,
          ).toContain(action.type);
        }
      }
    });

    it(`${name} — click actions have x and y coordinates`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'click') {
            expect(typeof action.x).toBe('number');
            expect(typeof action.y).toBe('number');
          }
        }
      }
    });

    it(`${name} — type actions have selector and text`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'type') {
            expect(typeof action.selector).toBe('string');
            expect(action.selector.length).toBeGreaterThan(0);
            expect(typeof action.text).toBe('string');
          }
        }
      }
    });

    it(`${name} — wait actions have durationMs`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'wait') {
            expect(typeof action.durationMs).toBe('number');
            expect(action.durationMs).toBeGreaterThan(0);
          }
        }
      }
    });

    it(`${name} — waitForSelector actions have selector`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'waitForSelector') {
            expect(typeof action.selector).toBe('string');
            expect(action.selector.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it(`${name} — waitForTutorialStep actions name at least one step id`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'waitForTutorialStep') {
            const ids = Array.isArray(action.stepId) ? action.stepId : [action.stepId];
            expect(ids.length, `step[${i}] stepId must not be empty`).toBeGreaterThan(0);
            for (const id of ids) {
              expect(typeof id, `step[${i}] stepId entries must be strings`).toBe('string');
              expect(id.length, `step[${i}] stepId entries must be non-empty`).toBeGreaterThan(0);
            }
          }
        }
      }
    });

    it(`${name} — viewport actions have width and height`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'viewport') {
            expect(typeof action.width).toBe('number');
            expect(typeof action.height).toBe('number');
          }
        }
      }
    });

    it(`${name} — wheel actions have deltaX and deltaY`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'wheel') {
            expect(typeof action.deltaX).toBe('number');
            expect(typeof action.deltaY).toBe('number');
          }
        }
      }
    });

    it(`${name} — command actions within interaction arrays have a command field`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'command') {
            expect(typeof action.command).toBe('string');
            expect(action.command.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it(`${name} — cameraFocus actions have x, z, and distance`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'cameraFocus') {
            expect(typeof action.x).toBe('number');
            expect(typeof action.z).toBe('number');
            expect(typeof action.distance).toBe('number');
            expect(action.distance).toBeGreaterThan(0);
          }
        }
      }
    });
  }
});

// ──────────────────────────────────────────────
// 12. Every scenario step has dual-play interaction array
// ──────────────────────────────────────────────

describe('Every scenario step has a dual-play interaction array', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every step has an interaction array with at least one action`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        // All steps must be objects with interaction arrays — plain strings are not allowed
        expect(
          typeof step !== 'string',
          `step[${i}] is a plain string "${step}". All steps must be objects with a dual-play interaction array.`,
        ).toBe(true);
        const stepObj = step as any;
        // Object steps must have an interaction array
        expect(
          stepObj.interaction,
          `step[${i}] ("${stepObj.command ?? '(no command)'}") must have an interaction array`,
        ).toBeDefined();
        expect(
          Array.isArray(stepObj.interaction),
          `step[${i}] interaction must be an array`,
        ).toBe(true);
        expect(
          stepObj.interaction.length,
          `step[${i}] interaction array must have at least one action`,
        ).toBeGreaterThan(0);
      }
    });

    it(`${name} — unconverted steps still replay step.command as their first action`, () => {
      // A role-marked step drives the UI instead of replaying the command, so
      // it is exempt — its `command` field is the command-mode equivalent, not
      // a script for interaction mode. Derived from the data rather than a
      // hardcoded name list so that converting a scenario (issue #479) does not
      // also require remembering to edit this test's exemption list; a step
      // that is still unconverted is still held to the mirror rule.
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      if (UI_DRIVEN_SCENARIO_NAMES.includes(name as never)) return;
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        expect(step.interaction).toBeDefined();
        expect(step.interaction!.length).toBeGreaterThan(0);
        if (step.role !== undefined) continue;
        const firstAction = step.interaction![0];
        expect(
          firstAction.type,
          `step[${i}] ("${step.command}") is unconverted, so its interaction must still mirror the command`,
        ).toBe('command');
        if (firstAction.type === 'command') {
          expect(firstAction.command).toBe(step.command);
        }
      }
    });
  }
});

// ──────────────────────────────────────────────
// 12. UI-driven scenarios actually drive the UI
// ──────────────────────────────────────────────
describe('UI-driven scenarios click real controls', () => {
  for (const name of UI_DRIVEN_SCENARIO_NAMES) {
    it(`${name} — has clickSelector actions on more than half its steps`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const clicking = scenario.steps.filter(step => {
        const s = step as ScenarioStepDef;
        return (s.interaction ?? []).some(a => a.type === 'clickSelector');
      });
      expect(clicking.length).toBeGreaterThan(scenario.steps.length / 2);
    });

    it(`${name} — every clickSelector targets a non-empty selector`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const s = scenario.steps[i] as ScenarioStepDef;
        for (const action of s.interaction ?? []) {
          if (action.type === 'clickSelector') {
            expect(typeof action.selector, `step[${i}] selector`).toBe('string');
            expect(action.selector.length).toBeGreaterThan(0);
          }
        }
      }
    });
  }
});

// ──────────────────────────────────────────────
// 13. Step role, when present, is a recognized value (issue #479)
// ──────────────────────────────────────────────
describe('Step role field is a recognized value when present', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every step's role, if set, is "player", "setup" or "observe"`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        if (step.role === undefined) continue;
        expect(
          ['player', 'setup', 'observe'],
          `step[${i}] role "${step.role}" must be "player", "setup" or "observe"`,
        ).toContain(step.role);
      }
    });
  }
});

// ──────────────────────────────────────────────
// 14. Role-marked steps never reach the console for anything but an
// allowlisted setup command (issue #479). A step with no role tag predates
// the distinction and is unconstrained — true of every definition here
// except the pilot conversion, tutorial-interactive.json.
// ──────────────────────────────────────────────
describe('Role-marked steps obey checkStepActionAllowed (issue #479)', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — no role-marked step's interaction runs a disallowed console command`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const violations: string[] = [];
      for (const step of scenario.steps as ScenarioStepDef[]) {
        if (step.role === undefined) continue;
        for (const action of step.interaction ?? []) {
          if (action.type !== 'command') continue;
          const violation = checkStepActionAllowed(step, action);
          if (violation !== null) violations.push(violation);
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('a player-marked step carrying a command action is rejected, naming the step', () => {
    const step: ScenarioStepDef = {
      command: 'vehicle driver 1 4',
      description: 'vehicle-buy-assign complete',
      role: 'player',
      interaction: [{ type: 'command', command: 'vehicle driver 1 4' }],
    };
    const violation = checkStepActionAllowed(step, { type: 'command', command: 'vehicle driver 1 4' });
    expect(violation).not.toBeNull();
    expect(violation).toContain('vehicle-buy-assign complete');
    expect(violation).toContain('vehicle driver 1 4');
  });

  it('a setup-marked step may still use an allowlisted command', () => {
    const step: ScenarioStepDef = {
      command: 'tick 6',
      role: 'setup',
      interaction: [{ type: 'command', command: 'tick 6' }],
    };
    expect(checkStepActionAllowed(step, { type: 'command', command: 'tick 6' })).toBeNull();
    expect(checkStepActionAllowed(step, { type: 'command', command: 'new_game seed:1' })).toBeNull();
  });

  it('a setup-marked step is rejected for a command outside the allowlist', () => {
    const cheat = 'employee assign_skill 1 skill:geology level:3';
    const step: ScenarioStepDef = {
      command: cheat,
      role: 'setup',
      interaction: [{ type: 'command', command: cheat }],
    };
    const violation = checkStepActionAllowed(step, { type: 'command', command: cheat });
    expect(violation).not.toBeNull();
    expect(violation).toContain(cheat);
  });

  it('an observe-marked step may run a read-only command', () => {
    for (const readOnly of ['state full', 'scores', 'vehicle list', 'contract status', 'drill_plan show']) {
      const step: ScenarioStepDef = { command: readOnly, role: 'observe' };
      expect(
        checkStepActionAllowed(step, { type: 'command', command: readOnly }),
        `"${readOnly}" reports state and must be allowed`,
      ).toBeNull();
    }
  });

  it('an observe-marked step is rejected for a command that changes state', () => {
    for (const mutating of ['vehicle buy debris_hauler', 'build freight_warehouse at:4,4', 'contract accept 1']) {
      const step: ScenarioStepDef = { command: mutating, role: 'observe' };
      const violation = checkStepActionAllowed(step, { type: 'command', command: mutating });
      expect(violation, `"${mutating}" changes state and must be refused`).not.toBeNull();
      expect(violation).toContain('changes state rather than reporting it');
    }
  });

  it('a step with no role tag is unconstrained (predates the distinction)', () => {
    const step: ScenarioStepDef = {
      command: 'build freight_warehouse at:4,4',
      interaction: [{ type: 'command', command: 'build freight_warehouse at:4,4' }],
    };
    expect(checkStepActionAllowed(
      step, { type: 'command', command: 'build freight_warehouse at:4,4' },
    )).toBeNull();
  });
});

// ──────────────────────────────────────────────
// 15. A step's `expect`, when present, is shaped correctly and checkable
// (issue #479 follow-up: scenarios gained assertions instead of proving only
// "the command didn't throw" — mirrors playtest-defs.test.ts's equivalent
// rule for beats). Checked in BOTH modes: command mode via
// checkGoalAgainstState (equals/increased only — no DOM), interaction mode
// via checkGoal (all fields) — scripts/shared/scenario-goal.ts and
// scripts/shared/playtest-driver.ts respectively.
// ──────────────────────────────────────────────
describe('Step expect field is shaped correctly when present', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every step's expect, if set, has well-typed fields`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        const e = step.expect;
        if (e === undefined) continue;
        if (e.increased !== undefined) {
          expect(Array.isArray(e.increased), `step[${i}] expect.increased must be an array`).toBe(true);
          for (const field of e.increased) {
            expect(typeof field, `step[${i}] expect.increased entries must be field names`).toBe('string');
            expect(field.length, `step[${i}] expect.increased has an empty field name`).toBeGreaterThan(0);
          }
        }
        if (e.decreased !== undefined) {
          expect(Array.isArray(e.decreased), `step[${i}] expect.decreased must be an array`).toBe(true);
          for (const field of e.decreased) {
            expect(typeof field, `step[${i}] expect.decreased entries must be field names`).toBe('string');
            expect(field.length, `step[${i}] expect.decreased has an empty field name`).toBeGreaterThan(0);
          }
        }
        if (e.equals !== undefined) {
          expect(typeof e.equals, `step[${i}] expect.equals must be an object`).toBe('object');
          expect(Object.keys(e.equals).length, `step[${i}] expect.equals is empty`).toBeGreaterThan(0);
        }
        for (const field of ['usable', 'blocked', 'tutorialStep'] as const) {
          if (e[field] === undefined) continue;
          expect(typeof e[field], `step[${i}] expect.${field} must be a string`).toBe('string');
          expect((e[field] as string).length, `step[${i}] expect.${field} is empty`).toBeGreaterThan(0);
        }
        if (e.note !== undefined) {
          expect(typeof e.note, `step[${i}] expect.note must be a string`).toBe('string');
        }
      }
    });

    it(`${name} — every step's expect, if set, carries at least one checkable field`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        const e = step.expect;
        if (e === undefined) continue;
        const checkable = e.tutorialStep !== undefined
          || (e.increased?.length ?? 0) > 0
          || (e.decreased?.length ?? 0) > 0
          || e.equals !== undefined
          || e.usable !== undefined
          || e.blocked !== undefined;
        expect(
          checkable,
          `step[${i}] expect has no checkable field (equals/increased/decreased/usable/blocked/tutorialStep) — a note alone proves nothing`,
        ).toBe(true);
      }
    });
  }
});
