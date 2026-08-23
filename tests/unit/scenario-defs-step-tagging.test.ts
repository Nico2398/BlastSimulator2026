import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { ALL_SCENARIO_NAMES, UI_DRIVEN_SCENARIO_NAMES } from './scenario-defs-fixtures.js';

// Step metadata tagging checks (interaction array presence, UI-driven
// scenarios, role/commandOutcome field validity) — split out of
// the former scenario-defs.test.ts (#703).

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
    it(`${name} — every step's role, if set, is "player", "setup", "observe", "bootstrap" or "guard"`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        if (step.role === undefined) continue;
        expect(
          ['player', 'setup', 'observe', 'bootstrap', 'guard'],
          `step[${i}] role "${step.role}" must be "player", "setup", "observe", "bootstrap" or "guard"`,
        ).toContain(step.role);
      }
    });
  }
});

// ──────────────────────────────────────────────
// 13b. Step commandOutcome, when present, is a recognized value (issue #585)
// Forward-looking, like the `role` check above: no scenario definition sets
// `commandOutcome` yet (the implementer's triage pass is what adds them), so
// today this passes vacuously across all files — it exists to hold the
// contract once that pass lands, exactly the way the `role` check did for
// issue #479 before any file was tagged.
// ──────────────────────────────────────────────
describe('Step commandOutcome field is a recognized value when present', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every step's commandOutcome, if set, is "refused" or "either"`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i] as ScenarioStepDef;
        if (step.commandOutcome === undefined) continue;
        expect(
          ['refused', 'either'],
          `step[${i}] commandOutcome "${step.commandOutcome}" must be "refused" or "either"`,
        ).toContain(step.commandOutcome);
      }
    });
  }
});
