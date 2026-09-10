// BlastSimulator2026 — Integration tests: ground-levelling order (#1009)
//
// Full round trip through src/console/: order a level_ground action over a
// rectangular area, let a qualified rock_digger driver carve it as queued
// work, and confirm the flattened area then passes the flat-footprint
// building-placement rule (#1008). Mirrors the console-driving style
// vehicles.integration.test.ts's "#924: dig_ramp_segment work duration
// scales with live voxel count" suite uses (createRunner/runCommand,
// new_game ... staffed:true, tick N).
//
// Every scenario below is RED today: levelGroundCommand/cancelLevelGroundCommand
// (src/console/commands/mining/level.ts) and the core LevelGround.ts functions
// they call are skeleton stubs that throw 'not implemented'.

import { describe, it, expect } from 'vitest';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { computeVoxelColumnSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { isFootprintFlat } from '../../src/core/entities/Building.js';
import { NAV_BENCH_HEIGHT } from '../../src/core/config/balance.js';

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

/** A flat 2x2 rect at (15,15)-(16,16), except (15,15) is one voxel lower — uneven, matching management_office tier1's own 2x2 footprint. */
function carveSlopedBuildingRect(grid: VoxelGrid): void {
  carveFlatRect(grid, 15, 16, 15, 16, BASE_HEIGHT);
  lowerColumn(grid, 15, 15, BASE_HEIGHT, 1);
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
  it('1. baseline: place_building on a sloped rect is refused (#1008 flat-footprint rule is live)', () => {
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

    const completed = tickUntilGone(engine, action!.id);
    expect(completed).toBe(true);

    // Cash was actually spent (charged at order time; no further charge on completion).
    expect(engine.ctx.state!.cash).toBe(cashAfterOrder);
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

    // The whole rect reads as flat via #1008's own isFootprintFlat rule.
    const footprint: Array<readonly [number, number]> = [];
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 3; dx++) footprint.push([dx, dz]);
    const flat = isFootprintFlat(footprint, 25, 25, (cx, cz) => computeVoxelColumnSurfaceY(grid, cx, cz));
    expect(flat).toBe(true);
  });
});
