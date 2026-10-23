// BlastSimulator2026 — Integration: pit-deepening stall at a stranded crater (#2082).
//
// After blasts deepen the pit, the only built ramp stops above the crater floor, so floor rubble
// haul/fragment orders are stamped debris_out_of_reach and planned drill holes buried_under_rubble;
// the driller idles and pit depth stalls. The core must order an access ramp on its own.
//
// Approach: tests/helpers/craterAccessFixture.ts levels a staffed progression site and cuts a
// straight-walled pit with no ramp (the same stranding a deepened pit produces, without firing
// blasts), then drops rubble on the floor. Everything after is driven through console commands.

import { describe, it, expect } from 'vitest';
import { makeCraterSite, dropRubble, type Pit } from '../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { CRATER_ACCESS_RECHECK_TICKS } from '../../src/core/config/balance.js';

const PIT: Pit = { x0: 40, z0: 40, size: 12, drop: 8 };
const inPit = (x: number, z: number) => x >= PIT.x0 && x < PIT.x0 + PIT.size && z >= PIT.z0 && z < PIT.z0 + PIT.size;
/** Ticks allowed for the crew to dig the ramp and then clear the floor. */
const DIG_TICKS = 4000;

describe('crater access ramp (#2082)', () => {
  it('haul regression: once the auto ramp is dug, no haul/fragment order of the crater stays debris_out_of_reach', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 8);
    const { state, run } = site;

    tickUntilFresh(run, state, () => false, 1);
    const crater = () => state.pendingActions.filter(a =>
      (a.type === 'haul_debris' || a.type === 'fragment_debris') && inPit(a.targetX, a.targetZ));
    expect(crater().length).toBeGreaterThan(0);
    expect(crater().every(a => a.blockedReason === 'debris_out_of_reach')).toBe(true);

    tickUntilFresh(run, state, () => state.plannedRamps.length > 0, CRATER_ACCESS_RECHECK_TICKS + 2);
    expect(state.plannedRamps).toHaveLength(1);

    tickUntilFresh(run, state, () => state.plannedRamps[0]!.segments.every(s => s.done), DIG_TICKS);
    expect(state.plannedRamps[0]!.segments.every(s => s.done)).toBe(true);

    tickUntilFresh(run, state, () => false, CRATER_ACCESS_RECHECK_TICKS);
    expect(crater().filter(a => a.blockedReason === 'debris_out_of_reach')).toEqual([]);
    expect(state.plannedRamps).toHaveLength(1);
    expectNoWorldInvariantViolations(state);
  });

  it('hole regression: holes under rubble in a stranded crater are kept, then drilled once access and hauling clear them', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 16);
    const { state, run } = site;

    expect(run('drill_plan grid rows:2 cols:2 spacing:2 depth:6 start:42,42')).toMatchObject({ success: true });
    expect(state.plannedDrillHoles).toHaveLength(4);
    const ids = state.plannedDrillHoles.map(h => h.id).sort();

    tickUntilFresh(run, state, () => false, 2);
    const drillOrders = () => state.pendingActions.filter(a => a.type === 'drill_hole');
    expect(drillOrders().every(a => a.blockedReason === 'buried_under_rubble')).toBe(true);

    // Through the whole stall and the ramp order the pattern is never cleared and no hole is dropped.
    tickUntilFresh(run, state, () => state.plannedRamps.length > 0, CRATER_ACCESS_RECHECK_TICKS + 2);
    expect(state.plannedRamps).toHaveLength(1);
    expect(state.plannedDrillHoles.map(h => h.id).sort()).toEqual(ids);

    tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0 && state.drillHoles.length === 4, DIG_TICKS * 2);
    // Drilled, not discarded: every planned hole became a real drill hole.
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(4);
    expect(state.drillHoles.map(h => h.id).sort()).toEqual(ids);
    expectNoWorldInvariantViolations(state);
  });

  it('a hole order becomes claimable (no blocked reason) after access and hauling', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 16);
    const { state, run } = site;
    expect(run('drill_plan grid rows:2 cols:2 spacing:2 depth:6 start:42,42')).toMatchObject({ success: true });
    tickUntilFresh(run, state, () => state.logistics.fragments.every(f => f.state !== 'on_ground'), DIG_TICKS * 2);
    const queuedHole = state.pendingActions.find(a => a.type === 'drill_hole' && a.status === 'queued');
    const started = state.drillHoles.length > 0 || state.pendingActions.some(a => a.type === 'drill_hole' && a.status !== 'queued');
    expect(started || queuedHole?.blockedReason === undefined).toBe(true);
    expect(state.logistics.fragments.some(f => f.state === 'on_ground')).toBe(false);
  });
});
