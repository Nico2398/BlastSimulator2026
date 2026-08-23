import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { ALL_SCENARIO_NAMES } from './fixtures.js';

// `expect` field shape checks — split out of the former scenario-defs.test.ts
// (#703).

// ──────────────────────────────────────────────
// 15. A step's `expect`, when present, is shaped correctly and checkable
// (issue #479 follow-up: scenarios gained assertions instead of proving only
// "the command didn't throw" — mirrored the now-deleted playtest-defs.test.ts's
// equivalent rule for beats). Checked in BOTH modes: command mode via
// checkGoalAgainstState (equals/increased/decreased/changedBy — no DOM),
// interaction mode via checkGoal (all fields) — scripts/shared/scenario-goal.ts
// and scripts/shared/interaction-driver.ts respectively.
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
        if (e.changedBy !== undefined) {
          expect(typeof e.changedBy, `step[${i}] expect.changedBy must be an object`).toBe('object');
          const entries = Object.entries(e.changedBy);
          expect(entries.length, `step[${i}] expect.changedBy is empty`).toBeGreaterThan(0);
          for (const [field, amount] of entries) {
            expect(typeof amount, `step[${i}] expect.changedBy.${field} must be a number`).toBe('number');
          }
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
          || e.changedBy !== undefined
          || e.usable !== undefined
          || e.blocked !== undefined;
        expect(
          checkable,
          `step[${i}] expect has no checkable field (equals/increased/decreased/changedBy/usable/blocked/tutorialStep) — a note alone proves nothing`,
        ).toBe(true);
      }
    });
  }
});

// ──────────────────────────────────────────────
// 15b. expect.changedBy shape, in isolation (issue #596) — the data-driven
// checks above only exercise what today's scenario files actually contain,
// and none of them use changedBy yet. These construct steps directly so the
// accept/reject shape rules are proven regardless of file adoption.
// ──────────────────────────────────────────────
describe('expect.changedBy shape (issue #596)', () => {
  it('a well-formed changedBy (object of field name -> numeric amount) satisfies the shape and checkable-field rules', () => {
    const step: ScenarioStepDef = {
      command: 'employee hire role:driller',
      expect: { changedBy: { cash: -1000 } },
    };
    const e = step.expect!;
    expect(typeof e.changedBy).toBe('object');
    const entries = Object.entries(e.changedBy!);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, amount] of entries) {
      expect(typeof amount).toBe('number');
    }
    const checkable = e.tutorialStep !== undefined
      || (e.increased?.length ?? 0) > 0
      || (e.decreased?.length ?? 0) > 0
      || e.equals !== undefined
      || e.changedBy !== undefined
      || e.usable !== undefined
      || e.blocked !== undefined;
    expect(checkable).toBe(true);
  });

  it('a changedBy entry with a non-numeric amount fails the shape rule', () => {
    const step = {
      command: 'employee hire role:driller',
      expect: { changedBy: { cash: '-1000' } },
    } as unknown as ScenarioStepDef;
    const amount = (step.expect!.changedBy as unknown as Record<string, unknown>)['cash'];
    expect(typeof amount).not.toBe('number');
  });

  it('an empty changedBy object fails the non-empty rule — it names no field, so it proves nothing', () => {
    const step: ScenarioStepDef = { command: 'state', expect: { changedBy: {} } };
    expect(Object.keys(step.expect!.changedBy!).length).toBe(0);
  });
});
