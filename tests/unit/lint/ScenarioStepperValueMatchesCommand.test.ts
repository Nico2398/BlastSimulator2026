// BlastSimulator2026 — a stepper is set to the value its step declares, never
// to a click count
//
// `.claude/rules/scenario-defs.md`: "A step's `command` and its `interaction`
// must target the same place." A `-/value/+` stepper was the one control the
// click vocabulary could only drive by *counting*: N clicks on
// `.bsx-stepper-btn:last-child` meant "the default plus N", and the default
// lived in `src/`. The moment `DRILL_GRID_DEFAULT_SPACING_M`, a charge
// panel's `DEFAULT_AMOUNT_KG` or a strip's persistence across steps changed,
// every count was silently wrong while its command still read right —
// PR #1070's first red shard was exactly that: `spacing:5` declared beside a
// drag whose strip still sat at 3 m, ordering 24 holes where 6 were expected.
// #1072 closed it for the grid tool's spacing by simulating the clicks;
// this closes it for every stepper by making the value explicit.
//
// Two rules, both mechanical:
//
//   1. No step clicks a `.bsx-stepper-btn` directly. `setStepper` reads the
//      control's displayed value and clicks until it matches, so the JSON
//      carries the figure, not a count that assumes a start.
//   2. Where a step's own command declares the same parameter — `spacing:`,
//      `depth:`, `amount:`, `stemming:`, `delay_step:` — the `setStepper`
//      value equals it. That is the whole invariant in one comparison: the
//      value command mode runs is the value interaction mode clicks to.
//
// Enforced in the `logic` channel, where it costs milliseconds, instead of
// left to a browser shard.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef, InteractionStepAction } from '../../../scripts/shared/scenario-types.js';
import {
  scenarioFiles, SCENARIO_DIR, loadScenarioDef, formatScenarioViolations,
  type ScenarioViolation,
} from '../../../scripts/shared/scenario-utils.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

/**
 * `[data-field="…"]` → the console parameter the same figure travels under.
 * `delay-step` is the Sequence panel's field; its command is
 * `sequence auto delay_step:N`.
 */
export const STEPPER_FIELD_TO_COMMAND_PARAM: Readonly<Record<string, string>> = {
  spacing: 'spacing',
  depth: 'depth',
  amount: 'amount',
  stemming: 'stemming',
  'delay-step': 'delay_step',
};

/** The `data-field` a stepper action targets, from its container selector. */
export function stepperField(selector: string): string | null {
  const m = /\[data-field="([^"]+)"\]/.exec(selector);
  return m ? m[1]! : null;
}

/**
 * The figure a command declares for `param`, unit suffix stripped: the
 * Charge panel emits `amount:5kg stemming:2.0m`, the Sequence panel
 * `delay_step:30ms`, and scenario authors write either form.
 */
export function declaredParam(command: string, param: string): number | null {
  const m = new RegExp(`\\b${param}:(-?\\d+(?:\\.\\d+)?)(?:kg|m|ms)?\\b`).exec(command);
  return m ? Number(m[1]) : null;
}

interface StepperViolation extends ScenarioViolation { detail: string }

function isStepperButtonClick(action: InteractionStepAction): boolean {
  return (action.type === 'clickSelector' || action.type === 'clickIfPresent')
    && /\.bsx-stepper-btn/.test(action.selector);
}

describe('repo-wide — a stepper is set to the value its step declares (PR #1070 shard 1, #1072)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('sanity: at least one step drives a stepper, so this lint has something to check', () => {
    const any = ALL_SCENARIO_NAMES.some((name) =>
      loadScenarioDef(name, SCENARIO_DIR).steps.some((s) =>
        ((s as ScenarioStepDef).interaction ?? []).some((a) => a.type === 'setStepper')));
    expect(any).toBe(true);
  });

  it('no step clicks a .bsx-stepper-btn directly — the count-encoded form', () => {
    const violations: StepperViolation[] = [];
    for (const file of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      scenario.steps.forEach((rawStep, stepIndex) => {
        const step = rawStep as ScenarioStepDef;
        for (const action of step.interaction ?? []) {
          if (!isStepperButtonClick(action)) continue;
          const selector = (action as { selector: string }).selector;
          violations.push({ file, stepIndex, command: step.command, detail: selector });
        }
      });
    }
    expect(
      violations.length,
      `${violations.length} stepper button click(s) encode a value as a click count. Use `
      + `\`{ "type": "setStepper", "selector": "<container> [data-field=\\"…\\"]", "value": N }\` `
      + `so the figure is explicit and compared against the command:\n`
      + formatScenarioViolations(violations, (v) => ` clicks ${v.detail}`),
    ).toBe(0);
  });

  it('every setStepper value equals the parameter its step\'s command declares', () => {
    const violations: StepperViolation[] = [];
    for (const file of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      scenario.steps.forEach((rawStep, stepIndex) => {
        const step = rawStep as ScenarioStepDef;
        for (const action of step.interaction ?? []) {
          if (action.type !== 'setStepper') continue;
          const field = stepperField(action.selector);
          if (field === null) {
            violations.push({ file, stepIndex, command: step.command, detail: `selector "${action.selector}" names no [data-field]` });
            continue;
          }
          const param = STEPPER_FIELD_TO_COMMAND_PARAM[field];
          if (param === undefined) {
            violations.push({ file, stepIndex, command: step.command, detail: `unknown stepper field "${field}" — add it to STEPPER_FIELD_TO_COMMAND_PARAM with its command parameter` });
            continue;
          }
          const declared = declaredParam(step.command, param);
          if (declared === null) continue; // the command does not pin it; nothing to compare
          if (Math.abs(declared - action.value) > 1e-9) {
            violations.push({
              file, stepIndex, command: step.command,
              detail: `setStepper ${field}=${action.value} but the command declares ${param}:${declared}`,
            });
          }
        }
      });
    }
    expect(
      violations.length,
      `${violations.length} setStepper action(s) disagree with their own step's command — command mode `
      + `and interaction mode would run different values:\n`
      + formatScenarioViolations(violations, (v) => ` — ${v.detail}`),
    ).toBe(0);
  });
});
