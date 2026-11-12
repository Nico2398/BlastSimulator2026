// BlastSimulator2026 — drill_plan grid: burden between rows, staggered rows, and the line it prints

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { t } from '../../../src/core/i18n/I18n.js';
import { GRID_LAYOUTS, gridCellPositions, drillHoleCost } from '../../../src/core/mining/DrillPlan.js';
import { DRILL_HOLE_DEFAULT_DIAMETER_M } from '../../../src/core/config/balance.js';

function setup() {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  return { runner, state: ctx.state! };
}

const cellsOf = (holes: readonly { x: number; z: number }[]) => holes.map(h => ({ x: h.x, z: h.z }));

describe('drill_plan grid — burden', () => {
  it('burden: sets the distance between rows; every hole records the spacing and the burden', () => {
    const { runner, state } = setup();

    const res = runner.run('drill_plan grid rows:3 cols:2 spacing:4 burden:3 depth:8 start:12,12');

    expect(res.success).toBe(true);
    expect(res.output).toBe('Drill plan: 3×2 grid, 6 holes ordered, spacing 4m, burden 3m, depth 8m');
    expect(cellsOf(state.plannedDrillHoles)).toEqual(gridCellPositions({ x: 12, z: 12 }, 3, 2, 4, 3));
    expect(state.plannedDrillHoles.map(h => h.z)).toEqual([12, 12, 15, 15, 18, 18]);
    expect(state.plannedDrillHoles.every(h => h.spacingM === 4 && h.burdenM === 3)).toBe(true);
  });

  it('without burden: rows sit a spacing apart and the line names no burden', () => {
    const { runner, state } = setup();

    const res = runner.run('drill_plan grid rows:2 cols:2 spacing:4 depth:8 start:12,12');

    expect(res.output).toBe('Drill plan: 2×2 grid, 4 holes ordered, spacing 4m, depth 8m');
    expect(cellsOf(state.plannedDrillHoles)).toEqual(gridCellPositions({ x: 12, z: 12 }, 2, 2, 4));
    expect(state.plannedDrillHoles.every(h => h.spacingM === 4 && h.burdenM === 4)).toBe(true);
  });

  it('a burden equal to the spacing is a square mesh and reads like one', () => {
    const { runner } = setup();

    expect(runner.run('drill_plan grid rows:2 cols:2 spacing:4 burden:4 depth:8 start:12,12').output)
      .toBe('Drill plan: 2×2 grid, 4 holes ordered, spacing 4m, depth 8m');
  });

  it('fractional spacing and burden are kept as typed', () => {
    const { runner, state } = setup();

    const res = runner.run('drill_plan grid rows:2 cols:2 spacing:2.5 burden:3.5 depth:8 start:12,12');

    expect(res.output).toBe('Drill plan: 2×2 grid, 4 holes ordered, spacing 2.5m, burden 3.5m, depth 8m');
    expect(cellsOf(state.plannedDrillHoles)).toEqual([{ x: 12, z: 12 }, { x: 14.5, z: 12 }, { x: 12, z: 15.5 }, { x: 14.5, z: 15.5 }]);
  });
});

describe('drill_plan grid — pattern', () => {
  it('pattern:staggered shifts every other row by half a spacing and says so', () => {
    const { runner, state } = setup();

    const res = runner.run('drill_plan grid rows:3 cols:2 spacing:5 pattern:staggered depth:8 start:12,12');

    expect(res.success).toBe(true);
    expect(res.output).toBe('Drill plan: 3×2 staggered grid, 5 holes ordered, spacing 5m, depth 8m');
    // Odd rows shift floor(5 / 2) = 2 m and drop their last hole, so the grid stays inside its rectangle.
    expect(cellsOf(state.plannedDrillHoles)).toEqual([
      { x: 12, z: 12 }, { x: 17, z: 12 },
      { x: 14, z: 17 },
      { x: 12, z: 22 }, { x: 17, z: 22 },
    ]);
  });

  it('a staggered grid with a burden names both', () => {
    const { runner, state } = setup();

    const res = runner.run('drill_plan grid rows:3 cols:2 spacing:4 burden:3 pattern:staggered depth:8 start:12,12');

    expect(res.output).toBe('Drill plan: 3×2 staggered grid, 5 holes ordered, spacing 4m, burden 3m, depth 8m');
    expect(cellsOf(state.plannedDrillHoles)).toEqual(gridCellPositions({ x: 12, z: 12 }, 3, 2, 4, 3, 'staggered'));
  });

  it('pattern:square is the default, aligned layout', () => {
    const { runner, state } = setup();

    const res = runner.run('drill_plan grid rows:2 cols:2 spacing:4 pattern:square depth:8 start:12,12');

    expect(res.output).toBe('Drill plan: 2×2 grid, 4 holes ordered, spacing 4m, depth 8m');
    expect(cellsOf(state.plannedDrillHoles)).toEqual(gridCellPositions({ x: 12, z: 12 }, 2, 2, 4));
  });

  it('the command the Drill step sends for a staggered, burdened grid drills the cells it previewed', () => {
    const { runner, state } = setup();

    const res = runner.run(`drill_plan grid rows:2 cols:3 spacing:4 burden:3 pattern:staggered depth:8 diameter:${DRILL_HOLE_DEFAULT_DIAMETER_M} start:10,10`);

    expect(res.success).toBe(true);
    expect(cellsOf(state.plannedDrillHoles)).toEqual(gridCellPositions({ x: 10, z: 10 }, 2, 3, 4, 3, 'staggered'));
  });
});

describe('drill_plan grid — refusals leave the plan as it was', () => {
  /** A game already holding an ordered 2×2 grid, and a snapshot of its plan and drill orders. */
  function withPlan() {
    const made = setup();
    expect(made.runner.run('drill_plan grid rows:2 cols:2 spacing:4 depth:8 start:12,12').success).toBe(true);
    const snapshot = () => JSON.stringify({
      planned: made.state.plannedDrillHoles,
      drilled: made.state.drillHoles,
      orders: made.state.pendingActions.filter(a => a.type === 'drill_hole').map(a => a.id),
    });
    return { ...made, before: snapshot(), snapshot };
  }

  for (const shape of ['spacing:0', 'spacing:-2', 'spacing:abc', 'burden:0', 'burden:-1', 'burden:abc']) {
    it(`${shape} is refused with invalid_spacing`, () => {
      const { runner, before, snapshot } = withPlan();
      const spacing = shape.startsWith('spacing') ? shape : 'spacing:4';
      const burden = shape.startsWith('burden') ? ` ${shape}` : '';

      const res = runner.run(`drill_plan grid rows:2 cols:2 ${spacing}${burden} depth:8 start:20,20`);

      expect(res.success).toBe(false);
      expect(res.output).toBe(t('mining.drill_plan.invalid_spacing'));
      expect(res.output).not.toBe('mining.drill_plan.invalid_spacing');
      expect(snapshot()).toBe(before);
    });
  }

  it('an unknown pattern is refused with invalid_pattern, listing the layouts', () => {
    const { runner, before, snapshot } = withPlan();

    const res = runner.run('drill_plan grid rows:2 cols:2 spacing:4 pattern:diagonal depth:8 start:20,20');

    expect(res.success).toBe(false);
    expect(res.output).toBe(t('mining.drill_plan.invalid_pattern', { options: GRID_LAYOUTS.join(', ') }));
    for (const layout of ['square', 'staggered']) expect(res.output).toContain(layout);
    expect(snapshot()).toBe(before);
  });
});

describe('drill_plan grid — the pattern cell survives drilling', () => {
  it('a drilled grid hole keeps its spacing and burden, and is paid for as it lands', () => {
    const { runner, state } = setup();
    expect(runner.run('drill_plan grid rows:1 cols:1 spacing:4 burden:3 depth:8 start:12,12').success).toBe(true);

    for (let i = 0; i < 2000 && state.plannedDrillHoles.length > 0; i++) runner.run('tick 1');

    expect(state.drillHoles).toEqual([{ id: 'H1', x: 12, z: 12, depth: 8, diameter: DRILL_HOLE_DEFAULT_DIAMETER_M, spacingM: 4, burdenM: 3 }]);
    const drilling = state.finances.transactions.filter(tx => tx.category === 'drilling');
    expect(drilling.map(tx => [tx.type, tx.amount, tx.description]))
      .toEqual([['expense', drillHoleCost(8, DRILL_HOLE_DEFAULT_DIAMETER_M), 'Drilling: hole H1']]);
  });
});
