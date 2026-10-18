// BlastSimulator2026 — Integration: blast, one ramp to the crater floor, haul (#1723).
//
// A pattern breaks deeper under each hole than between holes; unless the blast
// floors the rock between the holes to grade, the crater floor is a grid of
// 1-4 m steps (far over NAV_MAX_SLOPE_DEGREES) and a ramp opens only its own
// landing. Measured pattern: sandbox desert_badlands seed 42, 3x3 grid,
// spacing 4, depth 8, krackle 8 kg, stemming 2.5; ramp 32,46 -> 32,27 depth 8.
// Drives the real console command layer: no DOM, no Three.js.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { getSmoothTerrainSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { employeeClimbReach } from '../../src/core/engine/OrderReachability.js';
import { upgradeFreightWarehousesToTier3 } from '../helpers/freightWarehouse.js';
import { assertWorldInvariants } from '../../src/core/state/WorldInvariants.js';

const RAMP_LANDING = { x: 32, z: 27 };

function refresh(state: GameState): void {
  state.cash = Math.max(state.cash, 1_000_000);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickWhile(run: (c: string) => unknown, state: GameState, until: () => boolean, max: number): void {
  for (let i = 0; i < max && !until(); i++) { refresh(state); run('tick 1'); }
}

/** Sandbox site, blast fired, ramp dug to the landing; returns what the tests measure. */
function blastAndRamp() {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true')).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0; // a pending event halts `tick`; the haul loop is under test
  const grid = ctx.grid!;
  refresh(state);

  expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:28,18')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 800);
  expect(run('charge hole:* explosive:krackle amount:8 stemming:2.5')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 800);

  const before = new Map<string, number>();
  for (let z = 10; z < 40; z++) for (let x = 18; x < 50; x++) before.set(`${x},${z}`, getSmoothTerrainSurfaceY(grid, x, z));
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 400);
  expect(state.lastBlastReport).not.toBeNull();

  const crater: Array<{ x: number; z: number }> = [];
  for (const [key, h0] of before) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    if (h0 - getSmoothTerrainSurfaceY(grid, x, z) > 0.5) crater.push({ x, z });
  }

  const inCrater = new Set(crater.map(c => `${c.x},${c.z}`));
  const craterFragmentIds = new Set(state.logistics.fragments
    .filter(f => inCrater.has(`${Math.round(f.fragment.position.x)},${Math.round(f.fragment.position.z)}`))
    .map(f => f.fragment.id));

  expect(run('build_ramp start:32,46 end:32,27 depth:8')).toMatchObject({ success: true });
  tickWhile(run, state, () => !state.pendingActions.some(a => a.type === 'dig_ramp_segment'), 3000);
  expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toEqual([]);
  return { run, state, crater, craterFragmentIds };
}

/**
 * Builds `type` on the first spot of a coarse scan the placement rules accept
 * (the pad is not flat everywhere). The scan starts beside the ramp's upper end
 * on the open plateau: a building on the sloped terrain elsewhere levels a pad
 * that ends up ringed by steps, stranding the hauler on it.
 */
function placeAnywhere(run: (c: string) => unknown, type: string): void {
  for (let z = 50; z < 62; z += 4) {
    for (let x = 20; x < 48; x += 4) {
      if ((run(`build ${type} at:${x},${z}`) as { success: boolean }).success) return;
    }
  }
  throw new Error(`no placeable site for ${type}`);
}

describe('blast, ramp to the floor, haul (#1723)', () => {
  it('at least 80% of the crater columns are reachable from the ramp landing', () => {
    const { state, crater } = blastAndRamp();
    expect(crater.length).toBeGreaterThan(20);
    const reach = employeeClimbReach(state)!;
    expect(reach).not.toBeNull();
    const reachable = crater.filter(c => reach.canReach(RAMP_LANDING.x, RAMP_LANDING.z, c.x, c.z)).length;
    expect(reachable / crater.length).toBeGreaterThanOrEqual(0.8);
  }, 600_000);

  it('the hauler picks up debris from inside the crater without further orders', () => {
    const { run, state, craterFragmentIds } = blastAndRamp();
    placeAnywhere(run, 'freight_warehouse');
    tickWhile(run, state, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active), 600);
    upgradeFreightWarehousesToTier3(state, 75_000);
    placeAnywhere(run, 'spoil_heap');

    // Hauled debris leaves its crater column, so follow the fragments that started there by id.
    const hauled = () => state.logistics.fragments.filter(f =>
      craterFragmentIds.has(f.fragment.id) && f.state !== 'on_ground').length;
    const storedBefore = state.logistics.storedMassKg;
    tickWhile(run, state, () => hauled() > 0 && state.logistics.storedMassKg > storedBefore, 1500);

    expect(hauled()).toBeGreaterThan(0);
    expect(state.logistics.storedMassKg).toBeGreaterThan(storedBefore);
    expect(assertWorldInvariants(state)).toEqual([]);
  }, 600_000);
});
