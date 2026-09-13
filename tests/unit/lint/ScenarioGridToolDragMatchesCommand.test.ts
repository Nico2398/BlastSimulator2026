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
// it: `ci.yml`'s `scenario-interaction` job runs on push to `main`, on
// schedule/dispatch, or on a PR labelled `full-ci`, and that PR carried no
// such label — so the failure first appeared on the merge commit, where no
// PR-scoped workflow was watching. Unit tests run on every PR, so this check
// fails where the mistake is made.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef, InteractionStepAction } from '../../../scripts/shared/scenario-types.js';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

/** Drill.ts's DEFAULT_SPACING_M / DEFAULT_DEPTH_M — the strip's start values. */
const DEFAULT_SPACING_M = 3;
/** Drill.ts's own clamp on the spacing stepper. */
const SPACING_RANGE = { min: 1, max: 20 };

/**
 * The part of a grid plan both channels must agree on: how many holes, and
 * where the pattern starts.
 *
 * Deliberately not the pitch itself. Fourteen steps across the suite declare a
 * `spacing:` their drag never sets (the strip's steppers are simply not
 * clicked), so both channels drill the same COUNT of holes at the same origin
 * but at different pitches — a real divergence, but a pre-existing one whose
 * correction re-derives every downstream expectation in fourteen files, so it
 * is its own change and is filed separately. Add `spacing` here once those are
 * settled: `simulateGridDrag` already resolves it.
 */
interface PlanShape { rows: number; cols: number; startX: number; startZ: number }

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
    startX: start === null ? 0 : Number(start[1]),
    startZ: start === null ? 0 : Number(start[2]),
  };
}

/**
 * How far one action moves the spacing stepper, as
 * `#bs-param-strip [data-field="spacing"] .bsx-stepper-btn:last-child`.
 * `:last-child` is the `+` button and `:first-child` the `-` (dom.ts's
 * `stepper` appends dec, value, inc in that order). Only spacing is read:
 * depth does not enter the cols/rows arithmetic this lint checks.
 */
function spacingStepperDelta(action: InteractionStepAction): number {
  if (action.type !== 'clickSelector' && action.type !== 'clickIfPresent') return 0;
  if (!/\[data-field="spacing"\]/.test(action.selector)) return 0;
  const which = /\.bsx-stepper-btn:(first|last)-child/.exec(action.selector);
  if (which === null) return 0;
  return which[1] === 'last' ? 1 : -1;
}

/** What `armGridTool`'s confirm handler would actually order for this step. */
function simulateGridDrag(step: ScenarioStepDef): PlanShape | null {
  const actions = step.interaction;
  if (actions === undefined) return null;
  if (!actions.some(a => (a.type === 'clickSelector' || a.type === 'clickIfPresent') && /data-action="grid-tool"/.test(a.selector))) return null;
  const drag = actions.find(a => a.type === 'dragTiles');
  if (drag === undefined || drag.type !== 'dragTiles') return null;

  let spacing = DEFAULT_SPACING_M;
  for (const action of actions) {
    spacing = Math.min(SPACING_RANGE.max, Math.max(SPACING_RANGE.min, spacing + spacingStepperDelta(action)));
  }

  return {
    cols: Math.max(1, Math.round((drag.x2 - drag.x1) / spacing) + 1),
    rows: Math.max(1, Math.round((drag.z2 - drag.z1) / spacing) + 1),
    startX: drag.x1,
    startZ: drag.z1,
  };
}

describe('repo-wide — a grid-tool drag orders the grid its step declares (issue #1069)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('sanity: at least one step actually drags the grid tool, so this lint has something to check', () => {
    const dragging = ALL_SCENARIO_NAMES.flatMap(file =>
      loadScenarioDef(file, SCENARIO_DIR).steps.filter(s => simulateGridDrag(s as ScenarioStepDef) !== null));
    expect(dragging.length).toBeGreaterThan(0);
  });

  it('every grid-tool drag orders the same number of holes, at the same origin, as its own command declares', () => {
    const violations: string[] = [];

    for (const file of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      scenario.steps.forEach((rawStep, stepIndex) => {
        const step = rawStep as ScenarioStepDef;
        const dragged = simulateGridDrag(step);
        if (dragged === null) return;
        const declared = parseDeclaredGrid(step.command);
        if (declared === null) {
          violations.push(`  ${file}.json step[${stepIndex}]: drags the grid tool but its command is "${step.command}" — expected a "drill_plan grid …"`);
          return;
        }
        const mismatches = (['rows', 'cols', 'startX', 'startZ'] as const)
          .filter(key => declared[key] !== dragged[key])
          .map(key => `${key} declared ${declared[key]} but the drag produces ${dragged[key]}`);
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
      + `cols = round((x2-x1)/spacing)+1 and rows = round((z2-z1)/spacing)+1:\n`
      + `${violations.join('\n')}\n`,
    ).toEqual([]);
  });
});
