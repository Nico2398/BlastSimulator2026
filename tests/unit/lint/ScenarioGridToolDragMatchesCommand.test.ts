// BlastSimulator2026 — a grid-tool drag orders the grid its step declares
// (issue #1069)
//
// `.claude/rules/scenario-defs.md`: "A step's `command` and its `interaction`
// must target the same place. Command mode reads the command, interaction mode
// reads the clicks; when they disagree the two channels silently test
// different things."
//
// `ScenarioDeclaredCommandMatchesInteraction.test.ts` enforces that rule for
// the degenerate shape — an interaction array holding nothing but one command
// action, where the two strings can simply be compared. This lint covers the
// one *click* sequence in the suite whose outcome is just as computable: the
// blast panel's Grid Tool. `DrillStep.armGridTool` (src/ui/panels/blastSteps/
// Drill.ts) turns a confirmed rectangle into exactly one console command,
//
//   cols = max(1, round((x2 - x1) / spacing) + 1)
//   rows = max(1, round((z2 - z1) / spacing) + 1)
//   drill_plan grid rows:<rows> cols:<cols> spacing:<spacing> depth:<depth> …
//              start:<x1>,<z1>
//
// where `spacing` and `depth` are the strip's own steppers — they start at
// DEFAULT_SPACING_M / DEFAULT_DEPTH_M and only move when the step itself
// clicks `[data-field="spacing"]` / `[data-field="depth"]`. So a step that
// declares `drill_plan grid …` and drags the tool has a fully determined
// interaction-mode result, and a mismatch against its own declared command is
// never intentional.
//
// Why it earns a permanent lint rather than a one-off correction: this is the
// defect that put `main` red for five hours. #1068 added
// fatigue-hard-threshold-vehicle-release.json declaring
// `rows:2 cols:3 spacing:5` beside a (14,14)-(29,24) drag that, at the
// untouched 3m default, orders 6 x 4 = 24 holes instead of 6. Nothing caught
// it: the interaction job did not run on that PR (it was optional on pull
// requests then), so the failure first appeared on the merge commit, where no
// PR-scoped workflow was watching. The shards now run on every pull request;
// this check still fails earlier, in the `logic` channel, where the mistake
// is made.
//
// #1072: spacing itself is now part of the comparison, not just hole
// count/origin — a step can declare a `spacing:` its drag never sets, or
// carry a stepper click the declared value does not account for, and the two
// channels drill the same COUNT of holes at the same origin but at different
// pitches. Catching that requires a whole-FILE stateful fold rather than a
// per-step reset: `DrillStep` (src/ui/panels/blastSteps/Drill.ts) is the real
// production UI class, constructed exactly once per session by `UIManager`'s
// constructor. Its `gridSpacing` field persists across every grid-tool step
// in a scenario file — it is never reset between steps, and a `new_game` /
// `sandbox start` command mid-file does NOT recreate it. So `spacing`
// (below) starts at DEFAULT_SPACING_M once per scenario FILE, and every
// step's stepper clicks — whether or not that step itself drags — thread
// into the running value the next dragging step reads. A per-step-reset
// model produces false positives on any file where a later grid-tool step
// inherits spacing set by an earlier one.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef, InteractionStepAction } from '../../../scripts/shared/scenario-types.js';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { DRILL_GRID_DEFAULT_SPACING_M } from '../../../src/core/config/balance.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

/** Drill.ts's DEFAULT_SPACING_M — the strip's start value, once per session/file. */
const DEFAULT_SPACING_M = DRILL_GRID_DEFAULT_SPACING_M;
/** Drill.ts's own clamp on the spacing stepper. */
const SPACING_RANGE = { min: 1, max: 20 };

/**
 * The part of a grid plan both channels must agree on: how many holes, at
 * what pitch, starting where.
 */
interface PlanShape { rows: number; cols: number; startX: number; startZ: number; spacing: number }

/** Parse `drill_plan grid rows:2 cols:3 spacing:5 depth:8 start:14,14`. */
function parseDeclaredGrid(command: string): PlanShape | null {
  if (!/^\s*drill_plan\s+grid\b/.test(command)) return null;
  const num = (key: string, fallback: number): number => {
    const m = new RegExp(`\\b${key}:(-?[\\d.]+)`).exec(command);
    return m ? Number(m[1]) : fallback;
  };
  // `origin:` and `start:` are the same parameter (drillPlan.ts reads
  // `named['origin'] ?? named['start'] ?? '0,0'`), so both spellings and the
  // absent case are all comparable against the drag's own corner.
  const start = /\b(?:origin|start):(-?\d+),(-?\d+)/.exec(command);
  return {
    rows: num('rows', 1),
    cols: num('cols', 1),
    spacing: num('spacing', DEFAULT_SPACING_M),
    startX: start === null ? 0 : Number(start[1]),
    startZ: start === null ? 0 : Number(start[2]),
  };
}

/**
 * What one action does to the spacing stepper. A `setStepper` on the
 * spacing field sets it outright (the only form the suite uses now —
 * `ScenarioStepperValueMatchesCommand.test.ts` forbids the click-count
 * form); a bare `.bsx-stepper-btn` click is still folded as ±1 so this lint
 * keeps reading a definition that predates the migration correctly rather
 * than treating it as a no-op. `:last-child` is the `+` button and
 * `:first-child` the `-` (dom.ts's `stepper` appends dec, value, inc in
 * that order). Only spacing is read: depth does not enter the cols/rows
 * arithmetic this lint checks.
 */
function applySpacingAction(spacing: number, action: InteractionStepAction): number {
  if (action.type === 'setStepper') {
    return /\[data-field="spacing"\]/.test(action.selector) ? action.value : spacing;
  }
  if (action.type !== 'clickSelector' && action.type !== 'clickIfPresent') return spacing;
  if (!/\[data-field="spacing"\]/.test(action.selector)) return spacing;
  const which = /\.bsx-stepper-btn:(first|last)-child/.exec(action.selector);
  if (which === null) return spacing;
  return spacing + (which[1] === 'last' ? 1 : -1);
}

/** Whether a step's own interaction drags the grid tool at all (stateless sanity check). */
function stepDragsGridTool(step: ScenarioStepDef): boolean {
  const actions = step.interaction;
  if (actions === undefined) return false;
  if (!actions.some(a => (a.type === 'clickSelector' || a.type === 'clickIfPresent') && /data-action="grid-tool"/.test(a.selector))) return false;
  return actions.some(a => a.type === 'dragTiles');
}

/**
 * Folds one scenario FILE's steps in declaration order, threading a single
 * running `spacing` value the way the real, once-constructed `DrillStep`
 * does — never reset between steps, even across `new_game`/`sandbox start`
 * mid-file. For every step that drags the grid tool, records what
 * `armGridTool`'s confirm handler would actually order using the spacing
 * value as it stands *after* that step's own preceding stepper clicks (not a
 * fresh per-step default).
 */
function simulateFileGridDrags(steps: readonly ScenarioStepDef[]): Map<number, PlanShape> {
  const results = new Map<number, PlanShape>();
  let spacing = DEFAULT_SPACING_M;

  steps.forEach((step, stepIndex) => {
    const actions = step.interaction;
    if (actions === undefined) return;

    let drag: { x1: number; z1: number; x2: number; z2: number } | null = null;
    for (const action of actions) {
      spacing = Math.min(SPACING_RANGE.max, Math.max(SPACING_RANGE.min, applySpacingAction(spacing, action)));
      if (action.type === 'dragTiles') drag = action;
    }

    if (!stepDragsGridTool(step) || drag === null) return;

    results.set(stepIndex, {
      cols: Math.max(1, Math.round((drag.x2 - drag.x1) / spacing) + 1),
      rows: Math.max(1, Math.round((drag.z2 - drag.z1) / spacing) + 1),
      startX: drag.x1,
      startZ: drag.z1,
      spacing,
    });
  });

  return results;
}

describe('repo-wide — a grid-tool drag orders the grid its step declares (issue #1069, spacing #1072)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('sanity: at least one step actually drags the grid tool, so this lint has something to check', () => {
    const dragging = ALL_SCENARIO_NAMES.flatMap(file =>
      loadScenarioDef(file, SCENARIO_DIR).steps.filter(s => stepDragsGridTool(s as ScenarioStepDef)));
    expect(dragging.length).toBeGreaterThan(0);
  });

  it('every grid-tool drag orders the same number of holes, at the same origin and spacing, as its own command declares', () => {
    const violations: string[] = [];

    for (const file of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      const steps = scenario.steps as ScenarioStepDef[];
      const dragged = simulateFileGridDrags(steps);

      dragged.forEach((computed, stepIndex) => {
        const step = steps[stepIndex]!;
        const declared = parseDeclaredGrid(step.command);
        if (declared === null) {
          violations.push(`  ${file}.json step[${stepIndex}]: drags the grid tool but its command is "${step.command}" — expected a "drill_plan grid …"`);
          return;
        }
        const mismatches = (['rows', 'cols', 'startX', 'startZ', 'spacing'] as const)
          .filter(key => declared[key] !== computed[key])
          .map(key => `${key} declared ${declared[key]} but the drag produces ${computed[key]}`);
        if (mismatches.length > 0) {
          violations.push(`  ${file}.json step[${stepIndex}] ("${step.command}"): ${mismatches.join('; ')}`);
        }
      });
    }

    expect(
      violations,
      `Grid-tool steps whose drag and declared command describe different plans — command mode\n`
      + `would drill one grid and interaction mode another, from that step on. Fix by clicking the\n`
      + `strip's spacing/depth steppers ([data-field] .bsx-stepper-btn:last-child increments,\n`
      + `:first-child decrements) and sizing the rectangle so that\n`
      + `cols = round((x2-x1)/spacing)+1 and rows = round((z2-z1)/spacing)+1, remembering that\n`
      + `spacing is a running total across the whole file (the real DrillStep is constructed once\n`
      + `per session and never resets between steps):\n`
      + `${violations.join('\n')}\n`,
    ).toEqual([]);
  });
});
