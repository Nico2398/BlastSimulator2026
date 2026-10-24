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
import { makeCraterSite, dropRubble, cutPit, parkBlockedRamp, type Pit } from '../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { CRATER_ACCESS_ABANDON_DEBRIS_TICKS, CRATER_ACCESS_RECHECK_TICKS, STRANDED_RECOVERY_TICKS } from '../../src/core/config/balance.js';
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import { makeRubbleFragment } from '../helpers/blastFixtures.js';

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

    // A finished ramp leaves plannedRamps (TaskCompletionEffects), so completion is the list emptying.
    tickUntilFresh(run, state, () => state.plannedRamps.length === 0, DIG_TICKS);
    expect(state.plannedRamps).toHaveLength(0);

    tickUntilFresh(run, state, () => false, CRATER_ACCESS_RECHECK_TICKS);
    expect(crater().filter(a => a.blockedReason === 'debris_out_of_reach')).toEqual([]);
    expect(state.plannedRamps).toHaveLength(0);
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
});

describe('deepened crater with a buried first ramp (#2085)', () => {
  /** Inner pit cut well below the floor the first ramp reached. */
  const DEEP: Pit = { x0: 44, z0: 44, size: 6, drop: 16 };
  const SETTLE_TICKS = 9000;

  // The inner pit sits 8 m below a 12 m wide outer floor: no straight ramp fits the slowest tier's grade inside a
  // 64-cell site, and a spiral rings the whole outer pit and ends nowhere near the inner floor. The floor is
  // unplannable, so its debris is abandoned after CRATER_ACCESS_ABANDON_DEBRIS_TICKS instead of ordering
  // useless ramps forever (an earlier build dug 40+ identical spirals here and drained the cash).
  it('abandons the stranded auto-debris of an unplannable deepened floor without digging useless ramps', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 8);
    const { state, run } = site;

    tickUntilFresh(run, state, () => state.builtRamps.length >= 1 && state.plannedRamps.length === 0, DIG_TICKS + CRATER_ACCESS_RECHECK_TICKS + 2);
    expect(state.builtRamps).toHaveLength(1);
    const first = state.builtRamps[0]!;

    // A later blast deepens the pit and its fragments bury the first ramp's whole corridor.
    cutPit(site, DEEP);
    dropRubble(site, DEEP, 10, 12000);
    const buried = [];
    let id = 30000;
    for (let z = first.footprint.minZ; z <= first.footprint.maxZ; z++) {
      for (let x = first.footprint.minX; x <= first.footprint.maxX; x++) {
        const f = makeRubbleFragment(id++, 1000, { x, y: site.top - PIT.drop + 1, z });
        f.position = { x, y: site.top - PIT.drop + 1, z };
        buried.push(f);
      }
    }
    addBlastFragments(state.logistics, buried, state.navGrid);

    const strandedAuto = () => state.pendingActions.filter(a =>
      (a.type === 'haul_debris' || a.type === 'fragment_debris')
      && a.blockedReason === 'debris_out_of_reach' && inPit(a.targetX, a.targetZ));
    tickUntilFresh(run, state, () => false, 2);
    expect(strandedAuto().length).toBeGreaterThan(0);
    const cutTick = state.tickCount;
    tickUntilFresh(run, state, () => strandedAuto().length === 0, SETTLE_TICKS);

    expect(strandedAuto()).toEqual([]);
    expect(state.tickCount - cutTick).toBeGreaterThanOrEqual(CRATER_ACCESS_ABANDON_DEBRIS_TICKS);
    expect(state.builtRamps).toHaveLength(1);
    expect(state.plannedRamps).toHaveLength(0);
    const rampSpend = state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction' && e.tick >= cutTick);
    expect(rampSpend).toEqual([]);
    expect(state.plannedRamps.every(r => r.segments.some(sg => !sg.done))).toBe(true);
    expectNoWorldInvariantViolations(state);
  });
});

describe('stranded digger recovery (#2085)', () => {
  it('a driverless rock_digger parked in a cut-off pit is towed out of it', () => {
    const site = makeCraterSite([PIT]);
    const { state, run } = site;
    const digger = state.vehicles.vehicles.find(v => v.type === 'rock_digger')!;
    expect(digger).toBeDefined();
    digger.occupantIds = [];
    digger.x = PIT.x0 + 3;
    digger.z = PIT.z0 + 3;
    parkBlockedRamp(site, PIT);

    tickUntilFresh(run, state, () => false, 2);
    expect(inPit(digger.x, digger.z)).toBe(true);

    tickUntilFresh(run, state, () => !inPit(digger.x, digger.z), STRANDED_RECOVERY_TICKS + 2 * CRATER_ACCESS_RECHECK_TICKS);
    expect(inPit(digger.x, digger.z)).toBe(false);
    expectNoWorldInvariantViolations(state);
  });
});
