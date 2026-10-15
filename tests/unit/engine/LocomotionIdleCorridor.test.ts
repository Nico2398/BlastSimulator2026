// BlastSimulator2026 — idle crew and parked trucks must not permanently block
// movers in 1-wide corridors / pockets (#1696). Behaviour lives in
// Locomotion.ts handleAgentOccupancyBlock; Locomotion.test.ts holds the
// older single-blocker cases.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { AGENT_WALK_SPEED, AGENT_OCCUPANCY_WAIT_TICKS, MOVE_STUCK_ABANDON_TICKS, BLOCK_EPISODE_ABANDON_LIMIT } from '../../../src/core/config/balance.js';
import { tickLocomotion, isStationaryBusyEmployee } from '../../../src/core/engine/Locomotion.js';
import { moveTo } from '../../../src/core/engine/MoveTo.js';
import { employeeWorkState } from '../../../src/core/engine/EmployeeDispatch.js';
import type { Itinerary } from '../../../src/core/engine/Itinerary.js';

const SEED = 42;
const MAX_TICKS = 200;

/** '#' blocked, anything else walkable. Row index = z, column index = x. */
function stateFromMap(rows: readonly string[]): GameState {
  const state = createGame({ seed: SEED });
  const cells: NavCell[][] = rows.map(row => [...row].map((ch): NavCell => (
    ch === '#'
      ? { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false }
      : { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false }
  )));
  state.navGrid = new NavGrid(rows[0]!.length, rows.length, cells);
  return state;
}

/**
 * Left room (x 0..2), 1-wide corridor on z=2 (x 3..10), right room (x 11..13).
 * Corridor cells have no side cells, so a blocker must yield into a room.
 */
function corridorState(): GameState {
  return stateFromMap([
    '...' + '########' + '...',
    '...' + '########' + '...',
    '..............',
    '...' + '########' + '...',
    '...' + '########' + '...',
  ]);
}

/** Pocket (x 1..2, z 1..3) opening onto a 1-wide corridor (z=2, x 3..10) and a right room. */
function pocketState(): GameState {
  return stateFromMap([
    '###' + '########' + '...',
    '#..' + '########' + '...',
    '#..' + '........' + '...',
    '#..' + '########' + '...',
    '###' + '########' + '...',
  ]);
}

function idleCrew(state: GameState, role: Parameters<typeof hireEmployee>[1], x: number, z: number): Employee {
  const { employee } = hireEmployee(state.employees, role, new Random(SEED + x * 31 + z), x, z);
  expect(employeeWorkState(employee)).toBe('idle');
  return employee;
}

function driveRig(state: GameState, x: number, z: number, destX: number, destZ: number): { driller: Employee; rig: Vehicle } {
  const driller = idleCrew(state, 'driller', x, z);
  const { vehicle: rig } = purchaseVehicle(state.vehicles, 'drill_rig', x, z);
  rig.occupantIds = [driller.id];
  driller.locomotion = { kind: 'mounted', vehicleId: rig.id };
  driller.itinerary = {
    legs: [{
      mode: 'drive', vehicleId: rig.id, destX, destZ,
      arrival: 'exact', onArrive: { kind: 'none' }, estTicks: Math.abs(destX - x) + Math.abs(destZ - z),
    }],
    goal: { kind: 'reposition', x: destX, z: destZ },
    workTicks: 0,
    estTotalTicks: Math.abs(destX - x) + Math.abs(destZ - z),
  } satisfies Itinerary;
  return { driller, rig };
}

function runUntil(
  state: GameState, done: () => boolean, max: number, watched?: Employee,
): { ticks: number; stuckTicks: number; abandoned: Array<{ employeeId: number; actionId: number | null }> } {
  const abandoned: Array<{ employeeId: number; actionId: number | null }> = [];
  let ticks = 0;
  let stuckTicks = 0;
  while (ticks < max && !done()) {
    abandoned.push(...tickLocomotion(state).abandoned);
    if (watched?.isMoveStuck) stuckTicks++;
    ticks++;
  }
  return { ticks, stuckTicks, abandoned };
}

/** Yielding is a short, deliberate step aside — never a full stuck ladder for the mover. */
const MAX_STUCK_TICKS = MOVE_STUCK_ABANDON_TICKS - 1;
/** Yield-aware passage through a boxed-in pocket: no stuck/abandon ladder at all. */
const MAX_BOXED_IN_TICKS = 60;

describe('idle crew / parked truck in a 1-wide corridor (#1696)', () => {
  it('a driven drill rig reaches the hole cell past a parked charging truck and two idle on-foot employees', () => {
    const state = corridorState();
    const { driller, rig } = driveRig(state, 1, 2, 12, 2);
    const { vehicle: truck } = purchaseVehicle(state.vehicles, 'charging_truck', 6, 2);
    const a = idleCrew(state, 'blaster', 5, 2);
    const b = idleCrew(state, 'driver', 8, 2);

    runUntil(state, () => rig.x === 12 && rig.z === 2, MAX_TICKS);

    expect(rig.x).toBe(12);
    expect(rig.z).toBe(2);
    expect(driller.x).toBe(rig.x);
    // Idle bystanders are still idle and nobody was teleported into the rig's cell.
    expect(employeeWorkState(a)).toBe('idle');
    expect(employeeWorkState(b)).toBe('idle');
    expect(truck.occupantIds).toHaveLength(0);
  });

  it('the rig arrives without the whole stuck/abandon ladder repeating (bounded abandons)', () => {
    const state = corridorState();
    const { driller, rig } = driveRig(state, 1, 2, 12, 2);
    purchaseVehicle(state.vehicles, 'charging_truck', 6, 2);
    idleCrew(state, 'blaster', 5, 2);
    idleCrew(state, 'blaster', 8, 2);

    const { abandoned, stuckTicks } = runUntil(state, () => rig.x === 12 && rig.z === 2, MAX_TICKS, driller);
    expect(rig.x).toBe(12);
    expect(abandoned).toHaveLength(0);
    expect(stuckTicks).toBeLessThanOrEqual(MAX_STUCK_TICKS);
  });

  it('an on-foot hauler boxed in a pocket by idle crew reaches its destination', () => {
    const state = pocketState();
    const hauler = idleCrew(state, 'driver', 1, 1);
    idleCrew(state, 'blaster', 2, 1);
    idleCrew(state, 'blaster', 2, 2);
    idleCrew(state, 'driller', 2, 3);
    idleCrew(state, 'driller', 1, 2);
    expect(moveTo(state, hauler.id, { x: 12, z: 2 }).success).toBe(true);

    runUntil(state, () => hauler.itinerary === null, MAX_TICKS);

    expect(Math.round(hauler.x)).toBe(12);
    expect(Math.round(hauler.z)).toBe(2);
  });

  it('a driller on a rig boxed in at the pocket mouth by 3 idle crew and a truck exits', () => {
    const state = pocketState();
    const { rig } = driveRig(state, 1, 2, 12, 2);
    idleCrew(state, 'blaster', 2, 1);
    idleCrew(state, 'blaster', 2, 2);
    idleCrew(state, 'blaster', 2, 3);
    purchaseVehicle(state.vehicles, 'charging_truck', 3, 2);

    runUntil(state, () => rig.x === 12 && rig.z === 2, MAX_TICKS);

    expect(rig.x).toBe(12);
    expect(rig.z).toBe(2);
  });

  it('a rig boxed in its pocket by idle crew on every mouth cell leaves without a stuck ladder', () => {
    const state = pocketState();
    const { driller, rig } = driveRig(state, 1, 2, 12, 2);
    for (const [x, z] of [[2, 1], [2, 2], [2, 3], [1, 1], [1, 3]] as const) idleCrew(state, 'blaster', x, z);

    const run = runUntil(state, () => rig.x === 12 && rig.z === 2, MAX_TICKS, driller);

    expect(rig.x).toBe(12);
    expect(run.abandoned).toHaveLength(0);
    expect(run.stuckTicks).toBeLessThanOrEqual(MAX_STUCK_TICKS);
    expect(run.ticks).toBeLessThanOrEqual(MAX_BOXED_IN_TICKS);
  });

  it('a rig behind a single idle employee parked at the lane mouth is not held up by a stuck ladder', () => {
    const state = pocketState();
    const { driller, rig } = driveRig(state, 1, 2, 12, 2);
    idleCrew(state, 'blaster', 3, 2);

    const run = runUntil(state, () => rig.x === 12 && rig.z === 2, MAX_TICKS, driller);

    expect(rig.x).toBe(12);
    expect(run.stuckTicks).toBeLessThanOrEqual(MAX_STUCK_TICKS);
  });

  it('a working employee in the lane is not relocated', () => {
    const state = corridorState();
    const mover = idleCrew(state, 'driller', 1, 2);
    const busy = idleCrew(state, 'blaster', 6, 2);
    busy.activeActionId = 999;
    expect(isStationaryBusyEmployee(busy)).toBe(true);
    expect(moveTo(state, mover.id, { x: 12, z: 2 }).success).toBe(true);

    runUntil(state, () => mover.itinerary === null, AGENT_OCCUPANCY_WAIT_TICKS + MOVE_STUCK_ABANDON_TICKS + 20);

    expect(busy.x).toBe(6);
    expect(busy.z).toBe(2);
  });

  it('a resting employee in the lane is not relocated', () => {
    const state = corridorState();
    const mover = idleCrew(state, 'driller', 1, 2);
    const resting = idleCrew(state, 'blaster', 6, 2);
    resting.restTicksRemaining = 500;
    expect(isStationaryBusyEmployee(resting)).toBe(true);
    expect(moveTo(state, mover.id, { x: 12, z: 2 }).success).toBe(true);

    runUntil(state, () => mover.itinerary === null, AGENT_OCCUPANCY_WAIT_TICKS + MOVE_STUCK_ABANDON_TICKS + 20);

    expect(resting.x).toBe(6);
    expect(resting.z).toBe(2);
  });

  it('a live moving peer is never teleported: its per-tick displacement stays within walking speed', () => {
    const state = corridorState();
    const mover = idleCrew(state, 'driller', 1, 2);
    const peer = idleCrew(state, 'blaster', 4, 2);
    expect(moveTo(state, mover.id, { x: 12, z: 2 }).success).toBe(true);
    expect(moveTo(state, peer.id, { x: 12, z: 2 }, { allowUnreachable: true }).success).toBe(true);

    let maxStep = 0;
    for (let i = 0; i < 80; i++) {
      const px = peer.x, pz = peer.z;
      tickLocomotion(state);
      maxStep = Math.max(maxStep, Math.hypot(peer.x - px, peer.z - pz));
    }
    expect(maxStep).toBeLessThanOrEqual(AGENT_WALK_SPEED + 1e-6);
  });

  it('a mover blocked by a permanently busy lane blocker ends its leg within the ladder plus margin (no endless sidestep/return loop)', () => {
    const state = corridorState();
    const mover = idleCrew(state, 'driller', 1, 2);
    const busy = idleCrew(state, 'blaster', 12, 2);
    busy.activeActionId = 999;
    expect(moveTo(state, mover.id, { x: 12, z: 2 }).success).toBe(true);

    const budget = AGENT_OCCUPANCY_WAIT_TICKS + MOVE_STUCK_ABANDON_TICKS + 30;
    runUntil(state, () => mover.itinerary === null, budget);

    expect(mover.itinerary).toBeNull();
    expect(mover.blockEpisode).toBeUndefined();
    expect(busy.x).toBe(12);
    expect(busy.z).toBe(2);
  });

  describe('blockEpisode guard', () => {
    function blockedMover(): { state: GameState; mover: Employee } {
      const state = corridorState();
      const mover = idleCrew(state, 'driller', 1, 2);
      const busy = idleCrew(state, 'blaster', 12, 2);
      busy.activeActionId = 999;
      expect(moveTo(state, mover.id, { x: 12, z: 2 }).success).toBe(true);
      return { state, mover };
    }

    it('abandons the leg once the episode for its destination reaches the limit, then clears it', () => {
      const { state, mover } = blockedMover();
      mover.blockEpisode = { destX: 12, destZ: 2, count: BLOCK_EPISODE_ABANDON_LIMIT - 1 };

      const { abandoned } = runUntil(state, () => false, AGENT_OCCUPANCY_WAIT_TICKS + 5);

      expect(abandoned.some(a => a.employeeId === mover.id)).toBe(true);
      expect(mover.itinerary).toBeNull();
      expect(mover.blockEpisode).toBeUndefined();
    });

    it('a new destination restarts the count instead of inheriting a stale episode', () => {
      const { state, mover } = blockedMover();
      mover.blockEpisode = { destX: 99, destZ: 99, count: BLOCK_EPISODE_ABANDON_LIMIT - 1 };

      let seen = false;
      for (let i = 0; i < AGENT_OCCUPANCY_WAIT_TICKS + 40 && !seen; i++) {
        const r = tickLocomotion(state);
        const ep = mover.blockEpisode;
        if (ep && ep.destX === 12) {
          seen = true;
          expect(ep.count).toBeLessThan(BLOCK_EPISODE_ABANDON_LIMIT);
          expect(r.abandoned.some(a => a.employeeId === mover.id)).toBe(false);
        }
      }
      expect(seen).toBe(true);
    });

    it('clears the episode when the leg ends by arrival', () => {
      const { state, mover } = blockedMover();

      runUntil(state, () => mover.blockEpisode !== undefined, MAX_TICKS);
      expect(mover.blockEpisode).toBeDefined();
      runUntil(state, () => mover.itinerary === null, MAX_TICKS);

      expect(mover.itinerary).toBeNull();
      expect(mover.blockEpisode).toBeUndefined();
    });
  });
});
