import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
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

    it(`${name} — waitUntil actions have field, equals, maxTicks, and timeoutMs`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          if (action.type === 'waitUntil') {
            expect(typeof action.field).toBe('string');
            expect(action.field.length).toBeGreaterThan(0);
            expect(action.equals).not.toBeUndefined();
            expect(Number.isInteger(action.maxTicks)).toBe(true);
            expect(action.maxTicks).toBeGreaterThan(0);
            expect(Number.isInteger(action.timeoutMs)).toBe(true);
            expect(action.timeoutMs).toBeGreaterThan(0);
          }
        }
      }
    });

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
