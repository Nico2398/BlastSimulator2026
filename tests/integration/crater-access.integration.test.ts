// BlastSimulator2026 — Integration: a stranded crater is the player's to open (#2082, #2095).
//
// After blasts deepen the pit, the only built ramp stops above the crater floor, so floor rubble
// haul/fragment orders are stamped debris_out_of_reach and planned drill holes buried_under_rubble.
// The core never orders, pays for or digs a way in on its own, never drops those orders and never
// moves a cut-off vehicle or worker: it keeps the orders with their reason and says what is cut off.
// A ramp the player orders opens the crater.
//
// Approach: tests/helpers/craterAccessFixture.ts levels a staffed progression site and cuts a
// straight-walled pit with no ramp (the same stranding a deepened pit produces, without firing
// blasts), then drops rubble on the floor. Everything after is driven through console commands.

import { describe, it, expect } from 'vitest';
import { makeCraterSite, dropRubble, type Pit } from '../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { findStrandedCrew } from '../../src/core/engine/StrandedCrew.js';

const PIT: Pit = { x0: 40, z0: 40, size: 12, drop: 8 };
const inPit = (x: number, z: number) => x >= PIT.x0 && x < PIT.x0 + PIT.size && z >= PIT.z0 && z < PIT.z0 + PIT.size;
/** Ticks the core is given to do something on its own; it must do nothing. */
const IDLE_TICKS = 3000;
/** Ticks allowed for the crew to dig the player's ramp and then clear the floor. */
const DIG_TICKS = 4000;
/** A straight ramp from the surface down to the pit floor, inside the 20 degree vehicle limit (8 m over 23 m). */
const PLAYER_RAMP = `build_ramp start:46,17 end:46,${PIT.z0} depth:${PIT.drop}`;

const constructionSpend = (state: ReturnType<typeof makeCraterSite>['state'], since: number) =>
  state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction' && e.tick >= since);

describe('a stranded crater gets no ramp by itself (#2095)', () => {
  it('orders, digs and pays for nothing, and its debris orders stay queued with their reason', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 8);
    const { state, run } = site;
    const crater = () => state.pendingActions.filter(a =>
      (a.type === 'haul_debris' || a.type === 'fragment_debris') && inPit(a.targetX, a.targetZ));

    tickUntilFresh(run, state, () => false, 2);
    const ids = crater().map(a => a.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    expect(crater().every(a => a.blockedReason === 'debris_out_of_reach')).toBe(true);

    const start = state.tickCount;
    tickUntilFresh(run, state, () => false, IDLE_TICKS);
    expect(state.plannedRamps).toEqual([]);
    expect(state.builtRamps).toEqual([]);
    expect(constructionSpend(state, start)).toEqual([]);
    expect(crater().map(a => a.id).sort()).toEqual(ids);
    expect(crater().every(a => a.status === 'queued' && a.blockedReason === 'debris_out_of_reach')).toBe(true);
    expectNoWorldInvariantViolations(state);
  });

  it('a ramp the player orders makes the crater rubble haulable', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 8);
    const { state, run } = site;
    const outOfReach = () => state.pendingActions.filter(a =>
      (a.type === 'haul_debris' || a.type === 'fragment_debris') && inPit(a.targetX, a.targetZ) && a.blockedReason === 'debris_out_of_reach');
    tickUntilFresh(run, state, () => false, 2);
    expect(outOfReach().length).toBeGreaterThan(0);

    expect(run(PLAYER_RAMP)).toMatchObject({ success: true });
    // A finished ramp leaves plannedRamps (TaskCompletionEffects), so completion is the list emptying.
    tickUntilFresh(run, state, () => state.plannedRamps.length === 0, DIG_TICKS);
    expect(state.builtRamps).toHaveLength(1);
    tickUntilFresh(run, state, () => outOfReach().length === 0, 50);
    expect(outOfReach()).toEqual([]);
    expectNoWorldInvariantViolations(state);
  });

  it('holes under rubble in a stranded crater stay queued as buried and no ramp is ordered for them', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 16);
    const { state, run } = site;
    expect(run('drill_plan grid rows:2 cols:2 spacing:2 depth:6 start:42,42')).toMatchObject({ success: true });
    const ids = state.plannedDrillHoles.map(h => h.id).sort();
    expect(ids).toHaveLength(4);

    tickUntilFresh(run, state, () => false, IDLE_TICKS);
    const drillOrders = state.pendingActions.filter(a => a.type === 'drill_hole');
    expect(drillOrders).toHaveLength(4);
    expect(drillOrders.every(a => a.blockedReason === 'buried_under_rubble')).toBe(true);
    expect(state.plannedDrillHoles.map(h => h.id).sort()).toEqual(ids);
    expect(state.plannedRamps).toEqual([]);
    expectNoWorldInvariantViolations(state);
  });
});

describe('crew cut off by a stranded crater (#2095)', () => {
  it('a driverless rock_digger parked in the pit stays where it is and is reported cut off', () => {
    const site = makeCraterSite([PIT]);
    const { state, run } = site;
    const digger = state.vehicles.vehicles.find(v => v.type === 'rock_digger')!;
    expect(digger).toBeDefined();
    digger.occupantIds = [];
    digger.x = PIT.x0 + 3;
    digger.z = PIT.z0 + 3;

    tickUntilFresh(run, state, () => false, IDLE_TICKS);
    expect(digger.x).toBe(PIT.x0 + 3);
    expect(digger.z).toBe(PIT.z0 + 3);
    expect(findStrandedCrew(state).vehicleIds).toContain(digger.id);
    expectNoWorldInvariantViolations(state);
  });
});
