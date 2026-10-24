// BlastSimulator2026 — shared fixture: a stranded crater on a progression site (#2082).
//
// Reproduces the pit-deepening stall without firing blasts: a `sandbox start` site (a progression
// site, `state.grade` set) is levelled flat, then a square pit is cut straight down. No ramp exists,
// so the floor is far past the climb limit. Rubble dropped on the floor makes the dispatcher queue
// haul_debris / fragment_debris orders, which classification stamps `debris_out_of_reach`.

import { expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState, PlannedRamp } from '../../src/core/state/GameState.js';
import type { MiningContext } from '../../src/console/commands/mining/types.js';
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import { computeVoxelColumnSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { GENERATED_TERRAIN_GRID_SIZE_Y } from './gameContext.js';
import { buyChargingTruck, hireDriver, makeRubbleFragment, tickUntilFresh } from './blastFixtures.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';

const FLAT_ROCK = { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 };

export interface Pit { x0: number; z0: number; size: number; drop: number }

export interface CraterSite {
  run: (cmd: string) => unknown;
  state: GameState;
  ctx: MiningContext;
  /** Surface height the site was levelled to. */
  top: number;
  pits: Pit[];
}

/** Levels the whole site to the surface found at (30, 30), so no natural slope links anything to anything. The NavGrid learns of it through terrain:updated, as for a pit. */
function flatten(ctx: MiningContext): number {
  const grid = ctx.grid!;
  const { minX, minZ, sizeX, sizeZ } = ctx.state!.world!;
  const top = computeVoxelColumnSurfaceY(grid, 30, 30)!;
  for (let z = minZ; z < minZ + sizeZ; z++) {
    for (let x = minX; x < minX + sizeX; x++) {
      for (let y = 0; y < GENERATED_TERRAIN_GRID_SIZE_Y; y++) {
        if (y <= top) grid.setVoxel(x, y, z, FLAT_ROCK);
        else grid.clearVoxel(x, y, z);
      }
    }
  }
  ctx.emitter.emit('terrain:updated', {
    region: { minX, maxX: minX + sizeX - 1, minZ, maxZ: minZ + sizeZ - 1, minY: 0, maxY: GENERATED_TERRAIN_GRID_SIZE_Y - 1 },
  });
  return top;
}

/** Cuts a straight-walled pit; the NavGrid learns of it through terrain:updated, as after a real blast. */
export function cutPit(site: Pick<CraterSite, 'ctx' | 'top' | 'pits'>, pit: Pit): void {
  const grid = site.ctx.grid!;
  const floor = site.top - pit.drop;
  for (let z = pit.z0; z < pit.z0 + pit.size; z++) {
    for (let x = pit.x0; x < pit.x0 + pit.size; x++) {
      for (let y = floor + 1; y <= site.top; y++) grid.clearVoxel(x, y, z);
    }
  }
  site.ctx.emitter.emit('terrain:updated', {
    region: { minX: pit.x0, maxX: pit.x0 + pit.size - 1, minZ: pit.z0, maxZ: pit.z0 + pit.size - 1, minY: 0, maxY: GENERATED_TERRAIN_GRID_SIZE_Y - 1 },
  });
  site.pits.push(pit);
}

/** Drops `count` on-ground rubble fragments onto a pit's floor. Ids start at `firstId`. */
export function dropRubble(site: CraterSite, pit: Pit, count: number, firstId = 9000): void {
  const y = site.top - pit.drop + 1;
  const frags = [];
  for (let i = 0; i < count; i++) {
    const f = makeRubbleFragment(firstId + i, 1000, { x: pit.x0 + 2, y, z: pit.z0 + 2 });
    f.position = { x: pit.x0 + 2 + (i % 4), y, z: pit.z0 + 2 + Math.floor(i / 4) };
    frags.push(f);
  }
  addBlastFragments(site.state.logistics, frags, site.state.navGrid);
}

/** Barren rubble is hauled to a spoil heap; without one every haul order stalls on no_spoil_heap. Placed clear of the pits. */
function placeSpoilHeap(run: (cmd: string) => unknown): void {
  for (let z = 14; z < 30; z += 4) {
    for (let x = 14; x < 30; x += 4) {
      if ((run(`build spoil_heap at:${x},${z}`) as { success: boolean }).success) return;
    }
  }
  throw new Error('no placeable site for spoil_heap');
}

/** A flat, staffed progression site (`sandbox start staffed:true`) with the given pits already cut. */
export function makeCraterSite(pits: Pit[], opts: { cash?: number; grade?: number } = {}): CraterSite {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true${opts.grade !== undefined ? ` grade:${opts.grade}` : ''}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  state.cash = opts.cash ?? 5_000_000;
  const site: CraterSite = { run, state, ctx, top: flatten(ctx), pits: [] };
  placeSpoilHeap(run);
  for (const pit of pits) cutPit(site, pit);
  tickUntilFresh(run, state, () => false, 1);
  return site;
}

/** Twelve dig_ramp_segment orders parked inside the pit, as the classifier stamps them target_unreachable (#2085). */
export function parkBlockedRamp(site: CraterSite, pit: Pit, count = 12): void {
  const { state } = site;
  const cx = pit.x0 + pit.size - 1;
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = state.nextPendingActionId++;
    ids.push(id);
    state.pendingActions.push({
      id, type: 'dig_ramp_segment', requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger',
      targetX: cx, targetZ: cx, targetY: 0, payload: { rampId: 900, segmentIndex: i, cells: [], region: null },
      targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: state.tickCount,
      blockedReason: 'target_unreachable',
    });
  }
  const planned: PlannedRamp = {
    id: 900,
    def: { originX: cx, originZ: cx, direction: 'south', length: 1, targetDepth: 2 },
    footprint: { minX: cx, maxX: cx, minZ: cx, maxZ: cx },
    segments: ids.map((actionId, index) => ({ index, actionId, cells: [], region: null, done: false })),
  };
  state.plannedRamps.push(planned);
}

export interface LimitShot { side: number; spacing: number; depth: number; kgPerHole: number; x0: number; z0: number; explosive: string; diameter: number }

/**
 * Drills, charges and fires one n x n shot on a flat site (`makeCraterSite([], { grade })`), the way the ladder
 * probe sizes shots at a permit limit (#2086). The crater is read back with `craterCells`. Throws when any step stalls, so a fixture failure is never mistaken for the bug.
 */
export function fireLimitShot(site: CraterSite, shot: LimitShot): void {
  const { run, state } = site;
  const holes = shot.side * shot.side;
  expect(run(`drill_plan grid rows:${shot.side} cols:${shot.side} spacing:${shot.spacing} depth:${shot.depth} start:${shot.x0},${shot.z0} diameter:${shot.diameter}`)).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0, 6000);
  if (state.drillHoles.length !== holes) throw new Error(`drilled ${state.drillHoles.length}/${holes}; ended=${state.levelEndReason}; orders=${JSON.stringify(state.pendingActions.filter(a => a.type === 'drill_hole').map(a => `${a.status}/${a.blockedReason}/${a.targetX},${a.targetZ}`).slice(0, 6))}`);
  const charged = run(`charge hole:* explosive:${shot.explosive} amount:${shot.kgPerHole} stemming:2`) as { success: boolean; output: string };
  expect(charged.output).toBeTruthy();
  if (!charged.success) throw new Error(charged.output);
  tickUntilFresh(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 6000 + EXPLOSIVE_DELIVERY_TICKS);
  if (Object.keys(state.plannedChargesByHole).length !== 0) {
    throw new Error(`charging stalled: ${Object.keys(state.plannedChargesByHole).length} holes; orders=${JSON.stringify(state.pendingActions.filter(a => a.type.includes('charge')).map(a => `${a.type}/${a.status}/${a.blockedReason}/${a.targetX},${a.targetZ}`).slice(0, 4))}`);
  }
  expect(run('blast')).toMatchObject({ success: true });
  expect(state.lastBlastReport).not.toBeNull();
}

/**
 * Keeps one on-ground fragment in every `keepEvery` and drops the rest (their NavGrid occupants too), so a real
 * limit-sized blast's crater geometry can be exercised without simulating thousands of haul orders (#2086).
 * Surviving fragments keep their real positions, so the crater floor stays as sealed as the blast left it.
 */
export function thinRubble(site: CraterSite, keepEvery: number): number {
  const { state } = site;
  const kept = state.logistics.fragments.filter((t, i) => {
    if (t.state !== 'on_ground' || i % keepEvery === 0) return true;
    state.navGrid?.removeFragmentOccupant(Math.round(t.fragment.position.x), Math.round(t.fragment.position.z));
    return false;
  });
  state.logistics.fragments = kept;
  return kept.length;
}

/** Cells whose surface lies more than 1 m under the levelled top: the crater a blast cut. */
export function craterCells(site: Pick<CraterSite, 'ctx' | 'top'>): Array<{ x: number; z: number; depth: number }> {
  const grid = site.ctx.grid!;
  const out: Array<{ x: number; z: number; depth: number }> = [];
  for (let z = 0; z < grid.sizeZ; z++) {
    for (let x = 0; x < grid.sizeX; x++) {
      const y = computeVoxelColumnSurfaceY(grid, x, z);
      if (y !== null && y < site.top - 1) out.push({ x, z, depth: site.top - y });
    }
  }
  return out;
}

/** Extra spoil heaps along the north edge (z = 4), clear of any blast area, so thinned rubble never stalls on spoil_heap_full. */
export function addSpoilHeaps(run: (cmd: string) => unknown, count: number): number {
  let placed = 0;
  for (let x = 4; x < 60 && placed < count; x += 8) {
    if ((run(`build spoil_heap at:${x},4`) as { success: boolean }).success) placed++;
  }
  return placed;
}

/** A shot kills the crew standing at the pattern and destroys its drill rig and charging truck; rehires the driller and buys the missing vehicles (digger included) back so the next shot can be drilled (#2086). */
export function restockShotFleet(site: CraterSite): void {
  const { run, state } = site;
  if (!state.employees.employees.some(e => e.role === 'driller' && e.alive)) {
    tickUntilFresh(run, state, () => state.hiringPool.candidates.some(c => c.role === 'driller'), 400);
    expect(run('employee hire role:driller')).toMatchObject({ success: true });
  }
  const driller = state.employees.employees.find(e => e.role === 'driller' && e.alive)!;
  if (!state.vehicles.vehicles.some(v => v.type === 'drill_rig')) {
    expect(run('vehicle buy drill_rig')).toMatchObject({ success: true });
    expect(run(`employee assign_skill ${driller.id} skill:driving.drill_rig level:1`)).toMatchObject({ success: true });
  }
  if (!state.vehicles.vehicles.some(v => v.type === 'charging_truck')) buyChargingTruck(run, state, driller.id);
  crewIfMissing(site, 'debris_hauler', 'driving.truck');
  crewIfMissing(site, 'rock_fragmenter', 'driving.rock_fragmenter');
  crewIfMissing(site, 'rock_digger', 'driving.excavator'); // the blast also buries the digger that cut the first ramp
}

/** Buys `type` when the fleet lacks one and crews it with the first free driver the vehicle can be routed to. */
function crewIfMissing(site: CraterSite, type: string, skill: string): void {
  const { run, state } = site;
  if (state.vehicles.vehicles.some(v => v.type === type)) return;
  expect(run(`vehicle buy ${type}`)).toMatchObject({ success: true });
  const vehicle = state.vehicles.vehicles.find(v => v.type === type)!;
  const freeDrivers = () => state.employees.employees.filter(e => e.role === 'driver' && e.alive
    && !state.vehicles.vehicles.some(v => v.occupantIds.includes(e.id)));
  if (freeDrivers().length === 0) hireDriver(run, state);
  let last = '';
  for (const driver of freeDrivers()) {
    expect(run(`employee assign_skill ${driver.id} skill:${skill} level:1`)).toMatchObject({ success: true });
    const assigned = run(`vehicle driver ${vehicle.id} ${driver.id}`) as { success: boolean; output: string };
    last = assigned.output;
    if (assigned.success) return;
  }
  throw new Error(`${type} crew: ${last}`);
}
