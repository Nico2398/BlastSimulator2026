// BlastSimulator2026 — Integration: ghost colour follows a REAL blast (#1306).
// A blast leaves a climb-disconnected pocket (see blast-debris-reachability).
// An actor stranded in it turns the orders only they could serve red within a
// tick, and blue again once they are back on the main ground. A real queued
// ramp (queueRampOrder via `build_ramp`) is red on every layer while its crew is
// cut off, and flips blue on all layers together once connected.

import { describe, it, expect } from 'vitest';
import { drillChargeAndBlast, crewRockDigger, tickUntilFresh } from '../helpers/blastFixtures.js';
import { computeClimbComponents } from '../../src/core/nav/NavGridReachability.js';
import { NAV_CLEARANCE_EMPLOYEE_CELLS } from '../../src/core/config/balance.js';
import type { GameState } from '../../src/core/state/GameState.js';

const POCKET = { x: 18, z: 10 };

/** A main-ground cell on the warehouse's side of the blast, found from the live nav grid. */
function mainGroundCell(state: GameState): { x: number; z: number } {
  const components = computeClimbComponents(state.navGrid!, NAV_CLEARANCE_EMPLOYEE_CELLS);
  for (let x = 2; x < 12; x++) {
    for (let z = 2; z < 12; z++) {
      if (components.canReach(1, 8, x, z) && !components.canReach(POCKET.x, POCKET.z, x, z)) return { x, z };
    }
  }
  throw new Error('no main-ground cell cut off from the blast pocket');
}

describe('ghost colour after a real blast (#1306)', () => {
  it('an actor stranded by the blast turns the order red within a tick; back on main ground it is blue again', () => {
    const { run, state } = drillChargeAndBlast(18, 10, 3);
    // The driller who fired the shot does not survive it: the crew is hired after.
    expect(state.employees.employees.every(e => !e.alive)).toBe(true);
    expect(run('employee hire role:driver')).toMatchObject({ success: true });
    const actor = state.employees.employees.at(-1)!;
    const home = mainGroundCell(state);
    const buildGhost = () => state.ghostPreviews.find(g => g.type === 'place_building')!;

    actor.x = home.x;
    actor.z = home.z;
    expect(run('build freight_warehouse at:1,8')).toMatchObject({ success: true });
    expect(buildGhost().unreachable).toBe(false);

    actor.x = POCKET.x;
    actor.z = POCKET.z;
    actor.fatigue = 100;
    expect(run('tick 1')).toMatchObject({ success: true });
    expect(buildGhost().unreachable).toBe(true);

    actor.x = home.x;
    actor.z = home.z;
    actor.fatigue = 100;
    expect(run('tick 1')).toMatchObject({ success: true });
    expect(buildGhost().unreachable).toBe(false);
  });

  it('a queued ramp is red on every layer while its crew is cut off, and blue on every layer once connected', () => {
    const { run, state } = drillChargeAndBlast(18, 10, 3, 5_000_000);
    crewRockDigger(run, state);
    const digger = state.vehicles.vehicles.find(v => v.type === 'rock_digger')!;
    const driver = state.employees.employees.at(-1)!;
    const home = mainGroundCell(state);

    const place = (at: { x: number; z: number }): void => {
      for (const body of [driver, digger]) { body.x = at.x; body.z = at.z; }
      driver.fatigue = 100;
    };
    place(POCKET);
    expect(run('build_ramp start:27,9 end:17,9 depth:5')).toMatchObject({ success: true });

    const ramp = state.plannedRamps.at(-1)!;
    expect(ramp.segments.length).toBeGreaterThan(1);
    const layerGhosts = () => ramp.segments.map(s => state.ghostPreviews.find(g => g.id === s.actionId)!);
    expect(layerGhosts().every(g => g.unreachable === true)).toBe(true);

    place(home);
    tickUntilFresh(run, state, () => false, 1);
    expect(layerGhosts().every(g => g.unreachable !== true)).toBe(true);
  });
});
