// BlastSimulator2026 — Integration tests: ground-levelling order (#1009)
//
// Full round trip through src/console/: order a level_ground action over a
// rectangular area, let a qualified rock_digger driver carve it as queued
// work, and confirm the flattened area then passes the flat-footprint
// building-placement rule (#1008). Mirrors the console-driving style
// vehicles.integration.test.ts's "#924: dig_ramp_segment work duration
// scales with live voxel count" suite uses (createRunner/runCommand,
// new_game ... staffed:true, tick N).

import { describe, it, expect } from 'vitest';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import {
  computeVoxelColumnSurfaceY, computeVoxelColumnSurfaceHeight, setVoxelColumnSurfaceHeight,
} from '../../src/core/world/VoxelGrid.js';
import { footprintHeightSpread, getBuildingDef, getDefSize } from '../../src/core/entities/Building.js';
import { NAV_BENCH_HEIGHT, MAX_LEVEL_GROUND_AREA, BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD } from '../../src/core/config/balance.js';
import { levelGroundCommand } from '../../src/console/commands/mining/level.js';
import type { MiningContext } from '../../src/console/commands/mining/types.js';
import { PlayableArea } from '../../src/core/world/PlayableArea.js';
import { terrainConfigOf } from '../../src/console/commands/world.js';
import { makeGameContext } from '../helpers/gameContext.js';

const ROCK = { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 };
const BASE_HEIGHT = 15;

/** Force every column in `[minX, maxX] x [minZ, maxZ]` solid up to `height`, void above. */
function carveFlatRect(grid: VoxelGrid, minX: number, maxX: number, minZ: number, maxZ: number, height: number): void {
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      for (let y = 0; y < grid.sizeY; y++) {
        if (y <= height) grid.setVoxel(x, y, z, ROCK);
        else grid.clearVoxel(x, y, z);
      }
    }
  }
}

/** Lower one column's surface by `drop` voxels below `fromHeight` — leaves a rect uneven. */
function lowerColumn(grid: VoxelGrid, x: number, z: number, fromHeight: number, drop: number): void {
  for (let y = fromHeight; y > fromHeight - drop; y--) grid.clearVoxel(x, y, z);
}

/**
 * Raise one column's surface by `rise` voxels above `fromHeight` — the
 * opposite of `lowerColumn`. Levelling only ever cuts down to a target, never
 * fills up to it, so proving a widened skirt column actually gets carved (as
 * opposed to a column that already reads at or below target, which a carve
 * would legitimately leave untouched) needs the column raised above the
 * target, not dropped below it (#1144 defect 2, target-decoupling follow-up).
 */
function raiseColumn(grid: VoxelGrid, x: number, z: number, fromHeight: number, rise: number): void {
  for (let y = fromHeight; y < fromHeight + rise; y++) grid.setVoxel(x, y, z, ROCK);
}

/**
 * A flat 2x2 rect at (15,15)-(16,16), except (15,15) sits one voxel past the
 * placement tolerance below the rest — uneven enough to be refused, and
 * matching management_office tier1's own 2x2 footprint.
 *
 * The drop is derived from BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD rather than
 * hardcoded: #1008's refinement lets a footprint straddle a one-voxel step, so
 * a fixed one-voxel drop (what this used to carve) is a legal placement and
 * gives the levelling round trip below no baseline to prove anything against.
 */
function carveSlopedBuildingRect(grid: VoxelGrid): void {
  carveFlatRect(grid, 15, 16, 15, 16, BASE_HEIGHT);
  lowerColumn(grid, 15, 15, BASE_HEIGHT, BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD + 1);
}

function makeStaffedRunner(cash?: number): RunnerWithContext {
  const engine = createRunner();
  const cmd = cash !== undefined ? `new_game seed:42 size:32 staffed:true cash:${cash}` : 'new_game seed:42 size:32 staffed:true';
  expect(runCommand(engine, cmd).success).toBe(true);
  return engine;
}

function makeBareRunner(cash = 300_000): RunnerWithContext {
  const engine = createRunner();
  expect(runCommand(engine, `new_game seed:42 size:32 cash:${cash}`).success).toBe(true);
  return engine;
}

/** Ticks up to `maxTicks` times, returning true once no PendingAction with `actionId` remains. */
function tickUntilGone(engine: RunnerWithContext, actionId: number, maxTicks = 500): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (!engine.ctx.state!.pendingActions.some(a => a.id === actionId)) return true;
    runCommand(engine, 'tick 1');
  }
  return !engine.ctx.state!.pendingActions.some(a => a.id === actionId);
}

describe('level_ground — console round trip (#1009)', () => {
  it('1. baseline: place_building on a rect steeper than the tolerance is refused (#1008 placement rule is live)', () => {
    const engine = makeStaffedRunner();
    carveSlopedBuildingRect(engine.ctx.grid!);

    const result = runCommand(engine, 'build management_office at:15,15');
    expect(result.success).toBe(false);
  });

  it('2. a level_ground order on a sloped rect is accepted with a qualified rock_digger driver present; ticking completes it with real cash deducted', () => {
    const engine = makeStaffedRunner();
    carveSlopedBuildingRect(engine.ctx.grid!);

    const cashBefore = engine.ctx.state!.cash;
    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true);

    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground');
    expect(action).toBeDefined();

    const cashAfterOrder = engine.ctx.state!.cash;
    expect(cashAfterOrder).toBeLessThan(cashBefore);

    const orderCost = cashBefore - cashAfterOrder;

    const completed = tickUntilGone(engine, action!.id);
    expect(completed).toBe(true);

    // Raw cash alone can't prove "no double-charge on completion": ticking
    // up to 500 times to drain the queue legitimately crosses employee pay
    // cycles (PAY_CYCLE_TICKS, every 10 ticks) on a staffed roster, so cash
    // keeps falling for reasons unrelated to level-ground's own cost, and a
    // loose bound (e.g. toBeLessThanOrEqual(cashAfterOrder)) would happily
    // pass even with an extra charge injected at completion — a double
    // charge makes cash *lower*, which a "not above" bound can't catch.
    // Isolate the levelling charge itself via the finance ledger
    // (src/core/economy/Finance.ts) instead: every cash-moving operation
    // records its own category/description there, and levelGroundCommand
    // (src/console/commands/mining/level.ts) charges exactly once, at order
    // time, tagged 'construction'/'Level ground'. Exactly one such
    // transaction, for exactly the amount actually deducted at order time,
    // proves nothing extra happened at completion — regardless of how much
    // payroll noise ticked past in between.
    const levelGroundExpenses = engine.ctx.state!.finances.transactions.filter(
      tx => tx.type === 'expense' && tx.category === 'construction' && tx.description === 'Level ground',
    );
    expect(levelGroundExpenses.length).toBe(1);
    expect(levelGroundExpenses[0]!.amount).toBe(orderCost);

    expect(engine.ctx.state!.cash).toBeLessThanOrEqual(cashAfterOrder);
    expect(engine.ctx.state!.cash).toBeLessThan(cashBefore);
  });

  it('3. after completion, the identical place_building command that was refused now succeeds', () => {
    const engine = makeStaffedRunner();
    carveSlopedBuildingRect(engine.ctx.grid!);

    expect(runCommand(engine, 'build management_office at:15,15').success).toBe(false);

    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true);
    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground')!;
    expect(tickUntilGone(engine, action.id)).toBe(true);

    const result = runCommand(engine, 'build management_office at:15,15');
    expect(result.success).toBe(true);
  });

  it('4. navmesh cells over the levelled area are walkable/drivable post-completion', () => {
    const engine = makeStaffedRunner();
    carveSlopedBuildingRect(engine.ctx.grid!);

    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true);
    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground')!;
    expect(tickUntilGone(engine, action.id)).toBe(true);

    const nav = engine.ctx.state!.navGrid;
    expect(nav).not.toBeNull();
    for (let z = 15; z <= 16; z++) {
      for (let x = 15; x <= 16; x++) {
        const cell = nav!.cellAt(x, z);
        expect(cell).toBeDefined();
        expect(cell!.type).not.toBe('blocked');
        expect(cell!.type).not.toBe('void');
      }
    }
  });

  it('5. no rock_digger vehicle in the fleet: order still queues, but stays pending/unclaimed after many ticks', () => {
    const engine = makeBareRunner();
    expect(runCommand(engine, 'employee hire role:driver').success).toBe(true);
    const emp = engine.ctx.state!.employees.employees[engine.ctx.state!.employees.employees.length - 1]!;
    expect(runCommand(engine, `employee assign_skill ${emp.id} skill:driving.excavator level:1`).success).toBe(true);
    // Deliberately no `vehicle buy rock_digger` — no vehicle exists for the role this action requires.

    carveSlopedBuildingRect(engine.ctx.grid!);

    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true); // confirms the order, not a refusal

    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground');
    expect(action).toBeDefined();

    for (let i = 0; i < 300; i++) runCommand(engine, 'tick 1');

    const stillPending = engine.ctx.state!.pendingActions.find(a => a.id === action!.id);
    expect(stillPending).toBeDefined();
    expect(stillPending!.status).toBe('queued');
  });

  it('6. no driving.excavator-licensed employee: order still queues, but stays pending/unclaimed after many ticks', () => {
    const engine = makeBareRunner();
    expect(runCommand(engine, 'vehicle buy rock_digger').success).toBe(true);
    // An employee exists, but holds no driving.excavator qualification.
    expect(runCommand(engine, 'employee hire role:driver').success).toBe(true);

    carveSlopedBuildingRect(engine.ctx.grid!);

    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true); // confirms the order, not a refusal

    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground');
    expect(action).toBeDefined();

    for (let i = 0; i < 300; i++) runCommand(engine, 'tick 1');

    const stillPending = engine.ctx.state!.pendingActions.find(a => a.id === action!.id);
    expect(stillPending).toBeDefined();
    expect(stillPending!.status).toBe('queued');
  });

  it('7. a rect already entirely flat completes instantly, $0 charged, no pending action created', () => {
    const engine = makeStaffedRunner();
    carveFlatRect(engine.ctx.grid!, 20, 21, 20, 21, BASE_HEIGHT); // no drop anywhere — already flat

    const cashBefore = engine.ctx.state!.cash;
    const orderResult = runCommand(engine, 'level_ground minX:20 maxX:21 minZ:20 maxZ:21');
    expect(orderResult.success).toBe(true);

    expect(engine.ctx.state!.cash).toBe(cashBefore);
    expect(engine.ctx.state!.pendingActions.some(a => a.type === 'level_ground')).toBe(false);
  });

  it('8. a rect overlapping an existing building\'s footprint is refused synchronously, no cash charged', () => {
    const engine = makeStaffedRunner();
    // Flatten and build at (20,20)-(21,21), tick it to completion.
    carveFlatRect(engine.ctx.grid!, 20, 21, 20, 21, BASE_HEIGHT);
    expect(runCommand(engine, 'build management_office at:20,20').success).toBe(true);
    for (let i = 0; i < 500 && engine.ctx.state!.plannedBuildings.length > 0; i++) {
      runCommand(engine, 'tick 1');
    }
    expect(engine.ctx.state!.plannedBuildings.length).toBe(0);
    expect(engine.ctx.state!.buildings.buildings.length).toBeGreaterThan(0);

    const cashBefore = engine.ctx.state!.cash;
    const orderResult = runCommand(engine, 'level_ground minX:20 maxX:21 minZ:20 maxZ:21');
    expect(orderResult.success).toBe(false);
    expect(engine.ctx.state!.cash).toBe(cashBefore);
    expect(engine.ctx.state!.pendingActions.some(a => a.type === 'level_ground')).toBe(false);
  });

  it('9. cancelling a queued, not-yet-claimed order refunds the full order cost', () => {
    const engine = makeStaffedRunner();
    carveSlopedBuildingRect(engine.ctx.grid!);

    const cashBefore = engine.ctx.state!.cash;
    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true);
    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground')!;
    expect(action.status).toBe('queued'); // not yet claimed — no tick has run

    const cancelResult = runCommand(engine, `level_ground cancel id:${action.id}`);
    expect(cancelResult.success).toBe(true);

    expect(engine.ctx.state!.cash).toBe(cashBefore);
    expect(engine.ctx.state!.pendingActions.some(a => a.id === action.id)).toBe(false);
  });

  it('10. a rect spanning two benches levels to the lower bench\'s height, and the footprint reads flat on completion', () => {
    const engine = makeStaffedRunner();
    const grid = engine.ctx.grid!;
    const lowY = 12;
    const highY = lowY + NAV_BENCH_HEIGHT;
    // x in [25,26] at the low bench, x in [27,28] at the high bench — one rect straddling both.
    carveFlatRect(grid, 25, 26, 25, 26, lowY);
    carveFlatRect(grid, 27, 28, 25, 26, highY);

    const orderResult = runCommand(engine, 'level_ground minX:25 maxX:28 minZ:25 maxZ:26');
    expect(orderResult.success).toBe(true);
    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground')!;
    expect(tickUntilGone(engine, action.id)).toBe(true);

    // Every column in the rect now sits at the lower bench's height.
    for (let z = 25; z <= 26; z++) {
      for (let x = 25; x <= 28; x++) {
        expect(computeVoxelColumnSurfaceY(grid, x, z)).toBe(lowY);
      }
    }

    // The whole rect reads as dead flat via #1008's own spread measure — a
    // levelled rect leaves nothing for the placement tolerance to absorb.
    const footprint: Array<readonly [number, number]> = [];
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 3; dx++) footprint.push([dx, dz]);
    const spread = footprintHeightSpread(
      footprint, 25, 25, (cx: number, cz: number) => computeVoxelColumnSurfaceY(grid, cx, cz),
    );
    expect(spread).toBe(0);
  });

  it('11. refused before any game is started (requireGame guard)', () => {
    const engine = createRunner();
    const result = runCommand(engine, 'level_ground minX:0 maxX:1 minZ:0 maxZ:1');
    expect(result.success).toBe(false);
  });

  it('12. cancel with no id at all (positional or named) is refused with the cancel usage message', () => {
    const engine = makeStaffedRunner();
    const result = runCommand(engine, 'level_ground cancel');
    expect(result.success).toBe(false);
  });

  it('13. cancel with a positional id that does not exist is refused as not found', () => {
    const engine = makeStaffedRunner();
    const result = runCommand(engine, 'level_ground cancel 999999');
    expect(result.success).toBe(false);
  });

  it('14. an inverted rectangle (minX > maxX) is refused as an invalid area, no cash charged', () => {
    const engine = makeStaffedRunner();
    const cashBefore = engine.ctx.state!.cash;
    const result = runCommand(engine, 'level_ground minX:5 maxX:2 minZ:0 maxZ:1');
    expect(result.success).toBe(false);
    expect(engine.ctx.state!.cash).toBe(cashBefore);
  });

  it('15. omitting every rect field is refused as an invalid area (parseInt of missing named args is NaN)', () => {
    const engine = makeStaffedRunner();
    const result = runCommand(engine, 'level_ground');
    expect(result.success).toBe(false);
  });

  it('16. a rect exceeding MAX_LEVEL_GROUND_AREA is refused as too large, no cash charged', () => {
    const engine = makeStaffedRunner();
    const cashBefore = engine.ctx.state!.cash;
    const side = Math.ceil(Math.sqrt(MAX_LEVEL_GROUND_AREA)) + 1; // guarantees area > cap
    const result = runCommand(engine, `level_ground minX:0 maxX:${side - 1} minZ:0 maxZ:${side - 1}`);
    expect(result.success).toBe(false);
    expect(engine.ctx.state!.cash).toBe(cashBefore);
  });

  it('17. insufficient cash for an otherwise-valid order is refused, using the plain (non-keyed) message', () => {
    const engine = makeStaffedRunner(10);
    carveSlopedBuildingRect(engine.ctx.grid!);
    const cashBefore = engine.ctx.state!.cash;
    const result = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(result.success).toBe(false);
    expect(engine.ctx.state!.cash).toBe(cashBefore);
  });

  it('18. a rect overlapping a building still under construction (plannedBuildings, not yet placed) is refused', () => {
    const engine = makeStaffedRunner();
    carveFlatRect(engine.ctx.grid!, 20, 21, 20, 21, BASE_HEIGHT);
    expect(runCommand(engine, 'build management_office at:20,20').success).toBe(true);
    expect(engine.ctx.state!.plannedBuildings.length).toBeGreaterThan(0);
    expect(engine.ctx.state!.buildings.buildings.length).toBe(0);

    const cashBefore = engine.ctx.state!.cash;
    const result = runCommand(engine, 'level_ground minX:20 maxX:21 minZ:20 maxZ:21');
    expect(result.success).toBe(false);
    expect(engine.ctx.state!.cash).toBe(cashBefore);
  });

  it('19. a rect straddling the site edge, with expansion disabled, is refused at the claim step', () => {
    const ctx: MiningContext = makeGameContext({ cash: 500_000 });
    const config = terrainConfigOf(ctx.state!)!;
    ctx.playableArea = new PlayableArea(ctx.grid!, config, { expansionEnabled: false });

    // On-site part (x=28..31) carved uneven so the order isn't a no-op
    // "already flat" success; off-site part (x=32..33) is past the 32m site
    // and cannot be claimed with expansion disabled.
    carveFlatRect(ctx.grid!, 28, 31, 6, 7, BASE_HEIGHT);
    lowerColumn(ctx.grid!, 28, 6, BASE_HEIGHT, 1);

    const cashBefore = ctx.state!.cash;
    const result = levelGroundCommand(ctx, [], { minX: '28', maxX: '33', minZ: '6', maxZ: '7' });
    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.pendingActions.some(a => a.type === 'level_ground')).toBe(false);
  });

  it('20. every column of the ordered rect ends at the identical continuous height as the target, including a column integer-flush with target but fractionally proud (#1144 defect 1)', () => {
    const engine = makeStaffedRunner();
    const grid = engine.ctx.grid!;
    const compId = grid.palette.intern({ rocks: [{ rockId: 'sandite', coefficient: 1 }] });

    // Three columns at 24.500, one (16,16) at 24.622 — every column shares
    // integer floor 24, so the pre-#1144 Math.floor comparison would have
    // treated the whole rect as already level and skipped the proud column.
    for (let z = 15; z <= 16; z++) {
      for (let x = 15; x <= 16; x++) setVoxelColumnSurfaceHeight(grid, x, z, 24.5, compId);
    }
    setVoxelColumnSurfaceHeight(grid, 16, 16, 24.622, compId);

    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true);
    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground')!;
    expect(tickUntilGone(engine, action.id)).toBe(true);

    for (let z = 15; z <= 16; z++) {
      for (let x = 15; x <= 16; x++) {
        expect(computeVoxelColumnSurfaceHeight(grid, x, z)).toBeCloseTo(24.5, 6);
      }
    }
  });

  it('21. a moved building levels every lattice column from footprint x..x+sizeX and z..z+sizeZ INCLUSIVE, not just x+sizeX-1 (#1144 defect 2: one-column-short)', () => {
    const engine = makeStaffedRunner();
    const grid = engine.ctx.grid!;
    // A fresh build's own completion-carve is deliberately scoped to its
    // UNWIDENED footprint (#1144 follow-up fix, TaskCompletionEffects.ts):
    // widening it by one column reached into ground a second, adjacent
    // building or this same building's own later tier upgrade needed
    // untouched (buildings.integration.test.ts, needs.integration.test.ts
    // #928/#945). The widened carve this test proves stays real for
    // `entities.ts`'s move/upgrade paths, where the widened region only ever
    // extends past the footprint the order itself just grew into or
    // relocated onto — ground that order already owns. Build somewhere
    // flat and unrelated first, then move onto the engineered pad below so
    // the MOVE's own widened carve is what is under test, not construction's.
    carveFlatRect(grid, 0, 1, 0, 1, BASE_HEIGHT);
    expect(runCommand(engine, 'build management_office at:0,0').success).toBe(true);
    for (let i = 0; i < 500 && engine.ctx.state!.plannedBuildings.length > 0; i++) {
      runCommand(engine, 'tick 1');
    }
    expect(engine.ctx.state!.buildings.buildings.length).toBeGreaterThan(0);
    const built = engine.ctx.state!.buildings.buildings[0]!;
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(built.type, built.tier));
    expect(sizeX).toBe(2);
    expect(sizeZ).toBe(2);

    // 4x4 flat pad: two columns past management_office tier1's own 2x2
    // footprint (x=20,21 / z=20,21) on the high side.
    carveFlatRect(grid, 20, 23, 20, 23, BASE_HEIGHT);
    // One column past the TRUE footprint (x=22, i.e. x + sizeX) — RAISED
    // above the pad, not lowered: levelling only ever cuts down to a target,
    // so proving the widened region actually reaches and carves this column
    // needs it starting above the target, not below (#1144 target-decoupling
    // follow-up — the target itself now comes from the TRUE footprint alone,
    // so a column started BELOW it, as this test used to do, would
    // legitimately stay untouched and prove nothing about whether the carve
    // reaches it).
    raiseColumn(grid, 22, 20, BASE_HEIGHT, 3);
    // Two columns past the true footprint (x=23) — must NOT be carved; the
    // widened region only extends one column beyond the footprint. Raised by
    // a DIFFERENT amount than the x=22 column above, so an untouched column
    // landing on the same value as the pad height by chance would not make
    // the assertion below pass regardless of whether the carve actually
    // reached this column.
    raiseColumn(grid, 23, 20, BASE_HEIGHT, 6);

    // The true footprint itself (20,21 x 20,21) is untouched and flat, so
    // the move succeeds regardless of the widened-carve fix under test.
    const move = runCommand(engine, `build move ${built.id} to:20,20`);
    expect(move.success, move.output).toBe(true);

    const building = engine.ctx.state!.buildings.buildings.find(b => b.id === built.id)!;
    const padHeight = computeVoxelColumnSurfaceY(grid, building.x, building.z);

    // Every lattice column the building's own mesh spans — footprint x..x+sizeX
    // and z..z+sizeZ INCLUSIVE — reads the same pad height.
    for (let z = building.z; z <= building.z + sizeZ; z++) {
      for (let x = building.x; x <= building.x + sizeX; x++) {
        expect(computeVoxelColumnSurfaceY(grid, x, z)).toBe(padHeight);
      }
    }

    // One column further out than the widened region was never touched.
    expect(computeVoxelColumnSurfaceY(grid, building.x + sizeX + 1, building.z)).not.toBe(padHeight);
  });

  it('21b. a FRESH build levels every lattice column from footprint x..x+sizeX and z..z+sizeZ INCLUSIVE, not just x+sizeX-1 (#1144 defect 2, fresh-construction path)', () => {
    // Test 21 above proves the widened skirt carve for `build move` — the
    // path the #1144 follow-up fixer round scoped this behaviour down to
    // after finding it broke adjacent-building placement for FRESH
    // construction (living_quarters then driving_center, touching with no
    // gap between them). That regression was actually a target-computation
    // bug (the widened region's own low skirt column was dragging the whole
    // building's target height down with it, over-cutting), fixed by
    // decoupling `levelGroundRect`'s target rect from its carve rect
    // (TaskCompletionEffects.ts) rather than by disabling the widen for
    // fresh builds — issue #1144's own Verification section requires this to
    // hold for fresh construction specifically, the majority case, not just
    // move/upgrade. This is that fresh-build proof, on an isolated pad with
    // no neighbouring building to conflict with.
    const engine = makeStaffedRunner();
    const grid = engine.ctx.grid!;

    // 4x4 flat pad far from anything else already on the map, two columns
    // past management_office tier1's own 2x2 footprint (x=5,6 / z=5,6)
    // on the high side.
    carveFlatRect(grid, 5, 8, 5, 8, BASE_HEIGHT);
    // One column past the TRUE footprint (x=7, i.e. x + sizeX) — raised
    // above the pad. Levelling only ever cuts down to a target, so proving
    // the widened region actually reaches and carves this column needs it
    // starting above the target, not below.
    raiseColumn(grid, 7, 5, BASE_HEIGHT, 3);
    // Two columns past the true footprint (x=8) — must NOT be carved; the
    // widened region only extends one column beyond the footprint. Raised by
    // a DIFFERENT amount than the x=7 column above, so an untouched column
    // landing on the same value as the pad height by chance would not make
    // the assertion below pass regardless of whether the carve actually
    // reached this column.
    raiseColumn(grid, 8, 5, BASE_HEIGHT, 6);

    // The true footprint itself (5,6 x 5,6) is untouched and flat, so
    // the build succeeds regardless of the widened-carve fix under test.
    expect(runCommand(engine, 'build management_office at:5,5').success).toBe(true);
    for (let i = 0; i < 500 && engine.ctx.state!.plannedBuildings.length > 0; i++) {
      runCommand(engine, 'tick 1');
    }
    expect(engine.ctx.state!.buildings.buildings.length).toBeGreaterThan(0);
    const building = engine.ctx.state!.buildings.buildings.find(b => b.x === 5 && b.z === 5)!;
    expect(building).toBeDefined();
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(building.type, building.tier));
    const padHeight = computeVoxelColumnSurfaceY(grid, building.x, building.z);
    // The true footprint's own target is untouched by either raised column —
    // the fresh build finishes at the SAME height the pad started at.
    expect(padHeight).toBe(BASE_HEIGHT);

    // Every lattice column the building's own mesh spans — footprint x..x+sizeX
    // and z..z+sizeZ INCLUSIVE — reads the same pad height.
    for (let z = building.z; z <= building.z + sizeZ; z++) {
      for (let x = building.x; x <= building.x + sizeX; x++) {
        expect(computeVoxelColumnSurfaceY(grid, x, z)).toBe(padHeight);
      }
    }

    // One column further out than the widened region was never touched.
    expect(computeVoxelColumnSurfaceY(grid, building.x + sizeX + 1, building.z)).not.toBe(padHeight);
  });

  it('22. NavGrid occupancy after construction reflects only the true (unwidened) footprint — the widened carve does not expand the blocked area', () => {
    const engine = makeStaffedRunner();
    const grid = engine.ctx.grid!;
    carveFlatRect(grid, 20, 23, 20, 23, BASE_HEIGHT);

    expect(runCommand(engine, 'build management_office at:20,20').success).toBe(true);
    for (let i = 0; i < 500 && engine.ctx.state!.plannedBuildings.length > 0; i++) {
      runCommand(engine, 'tick 1');
    }
    expect(engine.ctx.state!.buildings.buildings.length).toBeGreaterThan(0);

    const building = engine.ctx.state!.buildings.buildings[engine.ctx.state!.buildings.buildings.length - 1]!;
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(building.type, building.tier));
    const nav = engine.ctx.state!.navGrid!;

    // True footprint columns (x..x+sizeX-1, z..z+sizeZ-1) are occupied.
    for (let z = building.z; z <= building.z + sizeZ - 1; z++) {
      for (let x = building.x; x <= building.x + sizeX - 1; x++) {
        expect(nav.cellAt(x, z)!.type).toBe('blocked');
      }
    }

    // The widened carve's own extra column (x+sizeX, z+sizeZ) is levelled
    // ground but was never claimed as occupied — the building's true
    // footprint never grew to match the wider carve.
    expect(nav.cellAt(building.x + sizeX, building.z)!.type).not.toBe('blocked');
    expect(nav.cellAt(building.x, building.z + sizeZ)!.type).not.toBe('blocked');
  });
});
