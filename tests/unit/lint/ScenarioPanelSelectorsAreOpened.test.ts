// BlastSimulator2026 — a panel-scoped selector needs the panel opened (#929)
//
// UIManager.update() only refreshes a panel that is visible, and showPanel()
// hides every other panel first. So `#bs-vehicle-panel [data-vehicle-id="2"]
// .bsx-btn-danger` is not merely invisible while the Fleet panel is closed —
// the card holding it was never rendered, and the selector matches nothing.
//
// That is not a theoretical failure mode. #921 converted three files' opening
// `vehicle driver` steps (which reached the Fleet panel through a real
// toolbar click) into instant `bootstrap` console commands, and took the only
// panel-open in each file with them. The vehicle-scrap steps that followed
// still clicked into the Fleet panel, and three interaction shards went red
// on `clickSelector ... failed` — twice, because the report read as a
// mid-click race rather than "nothing rendered this".
//
// `ensurePanel` (scenario-types.ts) already exists for exactly this and is
// idempotent, so the rule is cheap to hold: before a step's selector names a
// panel's element id, some earlier action in the same file must have left
// that panel open. This lint enforces it in the `logic` channel, where it
// costs milliseconds, instead of leaving it to a five-minute browser shard.

import { describe, it, expect } from 'vitest';
import {
  scenarioFiles, SCENARIO_DIR, loadScenarioDef, formatScenarioViolations,
  type ScenarioViolation,
} from '../../../scripts/shared/scenario-utils.js';
import { PANEL_ELEMENT_ID } from '../../../scripts/shared/interaction-executor.js';
import type { InteractionStepAction, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

/** `bs-vehicle-panel` -> `vehicles`, from the executor's own map. */
const PANEL_OF_ELEMENT_ID = new Map(
  Object.entries(PANEL_ELEMENT_ID).map(([panel, id]) => [id as string, panel]),
);

/** `#bs-toolbar [data-panel="vehicles"]` — the toggle `ensurePanel` clicks. */
const TOOLBAR_TOGGLE = /#bs-toolbar \[data-panel="([a-z]+)"\]/;

interface PanelViolation extends ScenarioViolation {
  selector: string;
  needs: string;
  openPanel: string | null;
}

function selectorOf(action: InteractionStepAction): string | undefined {
  return 'selector' in action && typeof action.selector === 'string' ? action.selector : undefined;
}

/** The panel whose element id `selector` reaches into, if any. */
function panelScopeOf(selector: string): string | undefined {
  for (const [elementId, panel] of PANEL_OF_ELEMENT_ID) {
    if (selector.includes(`#${elementId}`)) return panel;
  }
  return undefined;
}

/**
 * Replay one file's actions in order, tracking which panel is open, and
 * report every selector that reaches into a panel that is not.
 *
 * Only one panel is ever open (showPanel hides the rest), so the state is a
 * single value: `ensurePanel` sets it, and a bare click on a toolbar button
 * toggles it the way the real control does.
 */
function violationsIn(file: string): PanelViolation[] {
  const found: PanelViolation[] = [];
  let openPanel: string | null = null;

  loadScenarioDef(file, SCENARIO_DIR).steps.forEach((rawStep, stepIndex) => {
    const step = rawStep as ScenarioStepDef;
    for (const action of step.interaction ?? []) {
      if (action.type === 'ensurePanel') {
        openPanel = action.panel;
        continue;
      }
      const selector = selectorOf(action);
      if (selector === undefined) continue;

      const toggled = TOOLBAR_TOGGLE.exec(selector);
      if (toggled !== null && action.type === 'clickSelector') {
        openPanel = openPanel === toggled[1] ? null : toggled[1]!;
        continue;
      }

      const needs = panelScopeOf(selector);
      if (needs !== undefined && needs !== openPanel) {
        found.push({ file, stepIndex, command: step.command, selector, needs, openPanel });
      }
    }
  });
  return found;
}

/**
 * `ensureStep` clicks a Blast panel step tab and throws outright when the
 * Blast panel is closed, so it carries the same requirement without being
 * able to satisfy it — tracked here rather than in `violationsIn` so its
 * failure message can name what it needs.
 */
function ensureStepViolationsIn(file: string): PanelViolation[] {
  const found: PanelViolation[] = [];
  let openPanel: string | null = null;

  loadScenarioDef(file, SCENARIO_DIR).steps.forEach((rawStep, stepIndex) => {
    const step = rawStep as ScenarioStepDef;
    for (const action of step.interaction ?? []) {
      if (action.type === 'ensurePanel') {
        openPanel = action.panel;
        continue;
      }
      if (action.type === 'ensureStep') {
        if (openPanel !== 'blast') {
          found.push({
            file, stepIndex, command: step.command,
            selector: `ensureStep ${action.step}`, needs: 'blast', openPanel,
          });
        }
        continue;
      }
      const selector = selectorOf(action);
      const toggled = selector === undefined ? null : TOOLBAR_TOGGLE.exec(selector);
      if (toggled !== null && action.type === 'clickSelector') {
        openPanel = openPanel === toggled[1] ? null : toggled[1]!;
      }
    }
  });
  return found;
}

function describeExtra(v: PanelViolation): string {
  return ` — "${v.selector}" needs the ${v.needs} panel open, `
    + `but ${v.openPanel === null ? 'no panel is' : `the ${v.openPanel} panel is the one`} open`;
}

describe('repo-wide — a selector inside a panel is preceded by an ensurePanel for it (#929)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('sanity: the executor still exports the panel element ids this lint reads', () => {
    expect(PANEL_OF_ELEMENT_ID.get('bs-vehicle-panel')).toBe('vehicles');
    expect(PANEL_OF_ELEMENT_ID.size).toBeGreaterThan(1);
  });

  it('every panel-scoped selector has its panel open by the time it is used', () => {
    const violations = ALL_SCENARIO_NAMES.flatMap(violationsIn);
    expect(
      violations,
      `${violations.length} selector(s) reaching into a closed panel — the control is not rendered `
      + `at all, so the click has nothing to land on. Add { "type": "ensurePanel", "panel": "<panel>" } `
      + `to the step:\n${formatScenarioViolations(violations, describeExtra)}`,
    ).toEqual([]);
  });

  it('every ensureStep runs with the Blast panel already open', () => {
    const violations = ALL_SCENARIO_NAMES.flatMap(ensureStepViolationsIn);
    expect(
      violations,
      `${violations.length} ensureStep action(s) with the Blast panel closed — ensureStep throws `
      + `rather than opening it:\n${formatScenarioViolations(violations, describeExtra)}`,
    ).toEqual([]);
  });
});
