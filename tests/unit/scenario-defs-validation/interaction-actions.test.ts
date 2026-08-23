import { describe, it, expect } from 'vitest';
import type { InteractionStepAction, ScenarioDef, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { ALL_SCENARIO_NAMES, KNOWN_INTERACTION_ACTION_TYPES } from './fixtures.js';

// Dual-play scenario steps — interaction array validation (data-driven) —
// split out of the former scenario-defs.test.ts (#703).

// ──────────────────────────────────────────────
// 11. Dual-play scenario steps — interaction array validation (data-driven)
// Note: Some tests (click, type, wait, waitForSelector, viewport, wheel) are
// currently vacuously true because all 99 scenarios only use command-type actions.
// These tests are forward-looking: they validate data when non-command action
// types are added to scenarios in the future.
// ──────────────────────────────────────────────

/**
 * Shared scaffold behind the per-action-type checks below (issue #722): skip
 * plain-string steps, skip steps with no `interaction` array, then run
 * `check` against every action in the array matching `actionType`.
 * `Extract<InteractionStepAction, { type: T }>` narrows the union to the one
 * variant `actionType` names; TypeScript can't carry that narrowing through a
 * runtime-supplied literal on its own, so the cast is confined to this one
 * helper rather than repeated at each call site.
 */
function forEachActionOfType<T extends InteractionStepAction['type']>(
  scenario: ScenarioDef,
  actionType: T,
  check: (action: Extract<InteractionStepAction, { type: T }>, stepIndex: number) => void,
): void {
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    if (typeof step === 'string') continue;
    const stepObj = step as ScenarioStepDef;
    if (!stepObj.interaction) continue;
    for (const action of stepObj.interaction) {
      if (action.type === actionType) {
        check(action as Extract<InteractionStepAction, { type: T }>, i);
      }
    }
  }
}

interface ActionTypeCheck<T extends InteractionStepAction['type'] = InteractionStepAction['type']> {
  actionType: T;
  description: string;
  check: (action: Extract<InteractionStepAction, { type: T }>, stepIndex: number) => void;
}

const ACTION_TYPE_CHECKS: ActionTypeCheck[] = [
  {
    actionType: 'click', description: 'click actions have x and y coordinates',
    check: (a) => { expect(typeof a.x).toBe('number'); expect(typeof a.y).toBe('number'); },
  },
  {
    actionType: 'type', description: 'type actions have selector and text',
    check: (a) => {
      expect(typeof a.selector).toBe('string');
      expect(a.selector.length).toBeGreaterThan(0);
      expect(typeof a.text).toBe('string');
    },
  },
  {
    actionType: 'wait', description: 'wait actions have durationMs',
    check: (a) => { expect(typeof a.durationMs).toBe('number'); expect(a.durationMs).toBeGreaterThan(0); },
  },
  {
    actionType: 'waitForSelector', description: 'waitForSelector actions have selector',
    check: (a) => { expect(typeof a.selector).toBe('string'); expect(a.selector.length).toBeGreaterThan(0); },
  },
  {
    actionType: 'waitForTutorialStep',
    description: 'waitForTutorialStep actions name at least one step id',
    check: (a, i) => {
      const ids = Array.isArray(a.stepId) ? a.stepId : [a.stepId];
      expect(ids.length, `step[${i}] stepId must not be empty`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(typeof id, `step[${i}] stepId entries must be strings`).toBe('string');
        expect(id.length, `step[${i}] stepId entries must be non-empty`).toBeGreaterThan(0);
      }
    },
  },
  {
    actionType: 'viewport', description: 'viewport actions have width and height',
    check: (a) => { expect(typeof a.width).toBe('number'); expect(typeof a.height).toBe('number'); },
  },
  {
    actionType: 'wheel', description: 'wheel actions have deltaX and deltaY',
    check: (a) => { expect(typeof a.deltaX).toBe('number'); expect(typeof a.deltaY).toBe('number'); },
  },
  {
    actionType: 'command',
    description: 'command actions within interaction arrays have a command field',
    check: (a) => { expect(typeof a.command).toBe('string'); expect(a.command.length).toBeGreaterThan(0); },
  },
  {
    actionType: 'waitUntil',
    description: 'waitUntil actions have field, equals, maxTicks, and timeoutMs',
    check: (a) => {
      expect(typeof a.field).toBe('string');
      expect(a.field.length).toBeGreaterThan(0);
      expect(a.equals).not.toBeUndefined();
      expect(Number.isInteger(a.maxTicks)).toBe(true);
      expect(a.maxTicks).toBeGreaterThan(0);
      expect(Number.isInteger(a.timeoutMs)).toBe(true);
      expect(a.timeoutMs).toBeGreaterThan(0);
    },
  },
  {
    actionType: 'cameraFocus', description: 'cameraFocus actions have x, z, and distance',
    check: (a) => {
      expect(typeof a.x).toBe('number');
      expect(typeof a.z).toBe('number');
      expect(typeof a.distance).toBe('number');
      expect(a.distance).toBeGreaterThan(0);
    },
  },
];

describe('Dual-play scenario steps — data-driven validation', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    // Not table-driven: no type filter — scans every action of every step and
    // throws (rather than skips) on a plain-string step, unlike the shared
    // scaffold below.
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

    for (const entry of ACTION_TYPE_CHECKS) {
      it(`${name} — ${entry.description}`, () => {
        const scenario = loadScenarioDef(name, SCENARIO_DIR);
        forEachActionOfType(scenario, entry.actionType, entry.check);
      });
    }

    // Not table-driven: spans two action types (waitUntil, resolveEventIfPending)
    // and computes one value per step rather than per action, unlike the
    // shared scaffold above.
    it(`${name} — outer step timeout covers every inner waitUntil/resolveEventIfPending timeoutMs`, () => {
      // Regression for PR #616's headline bug: interaction-executor.ts and
      // the step runner race a step's own outer `timeout` (seconds,
      // defaults to 60s) against an inner action's `timeoutMs` (ms)
      // independently. When the outer fires first it produces a generic
      // "Step N timed out after 60000ms" instead of the action's own,
      // more useful error — 12 steps across 3 files shipped with this
      // mismatch undetected. `resolveEventIfPending.timeoutMs` defaults to
      // 30000 (interaction-executor.ts) when absent, same default used here.
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        const outerMs = (stepObj.timeout ?? 60) * 1000;
        for (const action of stepObj.interaction) {
          if (action.type === 'waitUntil') {
            expect(action.timeoutMs).toBeLessThanOrEqual(outerMs);
          } else if (action.type === 'resolveEventIfPending') {
            const innerMs = action.timeoutMs ?? 30000;
            expect(innerMs).toBeLessThanOrEqual(outerMs);
          }
        }
      }
    });
  }
});
