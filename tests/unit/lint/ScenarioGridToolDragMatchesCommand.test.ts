// BlastSimulator2026 — a grid-tool drag plans the same number of holes as the
// step's own drill_plan command (issue #1069)
//
// `.claude/rules/scenario-defs.md`: "A step's `command` and its `interaction`
// must target the same place. Command mode reads the command, interaction mode
// reads the clicks; when they disagree the two channels silently test
// different things."
//
// `ScenarioDeclaredCommandMatchesInteraction.test.ts` covers the degenerate
// shape — an interaction array holding nothing but one `command` action. This
// lint covers the one real click sequence whose two halves can still be
// compared number for number: the grid tool. The placement strip opens at
// DRILL_GRID_DEFAULT_SPACING_M (balance.ts, mirrored by Drill.ts's own
// DEFAULT_SPACING_M) and the confirm handler derives the grid from the dragged
// rectangle, so rows/cols follow from the rectangle and whatever spacing
// stepper clicks precede it — never from the `spacing:` the step's command
// declares.
//
// fatigue-hard-threshold-vehicle-release.json (added by #1068) declared
// `rows:2 cols:3 spacing:5` and dragged (14,14)-(29,24) without touching the
// stepper, so interaction mode confirmed a 6x4 grid: 24 holes against the
// step's own asserted 6. Command mode never saw it — `scenario-interaction`
// runs only on push to `main` or behind the `full-ci` label — so it landed and
// turned `main` red (#1069).
//
// Deliberately narrow: only the hole count (rows x cols) is compared, not the
// spacing itself. A dozen existing steps declare a `spacing:` their drag does
// not reproduce while still planning the same number of holes — a real but
// separate divergence (the holes land at different coordinates in each mode),
// too broad to fold into this lint without re-timing every scenario that
// carries one. Recorded in this run's follow-up rather than fixed here.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { DRILL_GRID_DEFAULT_SPACING_M } from '../../../src/core/config/balance.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

/** The strip's own bounds on the spacing stepper (ParamStrip field wiring, Drill.ts). */
const SPACING_MIN_M = 1;
const SPACING_MAX_M = 20;

/** `[data-field="spacing"] … .bsx-stepper-btn:last-child` increments, `:first-child` decrements. */
const SPACING_STEPPER = /\[data-field="spacing"\][^]*stepper-btn:(first|last)-child/;

interface DragRect { x1: number; z1: number; x2: number; z2: number }

/** Named `key:value` arguments of a console command, ignoring the verb and subcommand. */
function namedArgs(command: string): Record<string, string> {
  const named: Record<string, string> = {};
  for (const token of command.trim().split(/\s+/).slice(2)) {
    const split = token.indexOf(':');
    if (split > 0) named[token.slice(0, split)] = token.slice(split + 1);
  }
  return named;
}

/**
 * The spacing the strip is sitting at by the time this step's drag happens:
 * the strip's own opening value, moved one metre per stepper click the
 * interaction array performs before the drag.
 */
function spacingAtDrag(step: ScenarioStepDef): number {
  let spacing = DRILL_GRID_DEFAULT_SPACING_M;
  for (const action of step.interaction ?? []) {
    if (action.type === 'dragTiles') break;
    if (action.type !== 'clickSelector') continue;
    const match = SPACING_STEPPER.exec(action.selector);
    if (match === null) continue;
    const stepped = spacing + (match[1] === 'last' ? 1 : -1);
    spacing = Math.min(SPACING_MAX_M, Math.max(SPACING_MIN_M, stepped));
  }
  return spacing;
}

function dragRect(step: ScenarioStepDef): DragRect | null {
  for (const action of step.interaction ?? []) {
    if (action.type === 'dragTiles') {
      return { x1: action.x1, z1: action.z1, x2: action.x2, z2: action.z2 };
    }
  }
  return null;
}

/** Drill.ts's own confirm handler, to the letter. */
function gridFromDrag(rect: DragRect, spacing: number): { rows: number; cols: number } {
  return {
    cols: Math.max(1, Math.round((rect.x2 - rect.x1) / spacing) + 1),
    rows: Math.max(1, Math.round((rect.z2 - rect.z1) / spacing) + 1),
  };
}

describe('repo-wide — a grid-tool drag plans the command\'s own hole count (issue #1069)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('no drill_plan grid step drags a rectangle that plans a different number of holes than it declares', () => {
    const violations: string[] = [];

    for (const file of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      scenario.steps.forEach((rawStep, stepIndex) => {
        const step = rawStep as ScenarioStepDef;
        if (!/^\s*drill_plan\s+grid\b/.test(step.command)) return;
        const rect = dragRect(step);
        if (rect === null) return;

        const declared = namedArgs(step.command);
        const rows = Number(declared['rows']);
        const cols = Number(declared['cols']);
        if (!Number.isFinite(rows) || !Number.isFinite(cols)) return;

        const dragged = gridFromDrag(rect, spacingAtDrag(step));
        if (dragged.rows === rows && dragged.cols === cols) return;

        violations.push(
          `  ${file}.json step[${stepIndex}]: declares ${cols}x${rows} (${cols * rows} holes) but the drag `
          + `(${rect.x1},${rect.z1})-(${rect.x2},${rect.z2}) at ${spacingAtDrag(step)}m spacing plans `
          + `${dragged.cols}x${dragged.rows} (${dragged.cols * dragged.rows} holes)`,
        );
      });
    }

    expect(
      violations,
      `Grid-tool steps whose drag plans a different hole count than their command declares —\n`
      + `interaction mode would confirm a grid the step's own assertions were never written for.\n`
      + `Either drag a rectangle that matches, or click the spacing stepper\n`
      + `(#bs-param-strip [data-field="spacing"] .bsx-stepper-btn:last-child) until it does:\n`
      + `${violations.join('\n')}\n`,
    ).toEqual([]);
  });
});
