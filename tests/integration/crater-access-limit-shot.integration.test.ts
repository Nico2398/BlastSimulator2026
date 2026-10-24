// BlastSimulator2026 — Integration: crater access after limit-sized shots (#2086).
//
// The ladder probe fires permit-limit shots; each cuts a wide crater and strands its rubble. #2082/#2085 order an
// access ramp for the first crater, but a crater deepened by a later shot, or a second crater, stayed sealed:
// haul orders read debris_out_of_reach until they were abandoned, and the pit never got deeper.
//
// The craters here come from real shots (drill_plan, charge, blast on a levelled grade 2 site), not hand-cut pits.
// A real shot leaves thousands of fragments and takes minutes to haul, so `thinRubble` keeps one fragment in forty
// at its real position: the crater geometry and the sealing stay as the blast left them.

import { describe, it, expect } from 'vitest';
import {
  addSpoilHeaps, craterCells, cutPit, dropRubble, fireLimitShot, makeCraterSite, restockShotFleet, thinRubble, type CraterSite, type LimitShot,
} from '../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { getOperatingCostPerHour } from '../../src/core/economy/OperatingFinance.js';
import { CRATER_ACCESS_ABANDON_DEBRIS_TICKS, CRATER_ACCESS_CASH_RESERVE_TICKS, CRATER_ACCESS_RECHECK_TICKS } from '../../src/core/config/balance.js';

const THIN = 40;
/** Ticks allowed for the crew to dig an access ramp and then clear the crater floor. */
const DIG_TICKS = 4000;
const SHOT: LimitShot = { side: 4, spacing: 4, depth: 8, kgPerHole: 10, x0: 30, z0: 30, explosive: 'krackle', diameter: 0.089 };

/** Ticks with the score and cash topped up: a limit shot's rubble bleeds ecology to a shutdown before it is hauled. */
function tickSite(site: CraterSite, until: () => boolean, maxTicks: number): void {
  tickUntilFresh(site.run, site.state, () => {
    site.state.scores.ecology = 100;
    site.state.cash = Math.max(site.state.cash, 3_000_000);
    return until();
  }, maxTicks);
}

const onGround = (site: CraterSite) => site.state.logistics.fragments.filter(f => f.state === 'on_ground').length;
const strandedOrders = (site: CraterSite) => site.state.pendingActions.filter(a =>
  (a.type === 'haul_debris' || a.type === 'fragment_debris') && a.blockedReason === 'debris_out_of_reach');

function limitSite(): CraterSite {
  const site = makeCraterSite([], { grade: 2 });
  expect(addSpoilHeaps(site.run, 6)).toBeGreaterThan(0);
  return site;
}

/** Fires a shot, thins its rubble and runs until no fragment is left on the ground. */
function shootAndClear(site: CraterSite, shot: LimitShot): void {
  fireLimitShot(site, shot);
  thinRubble(site, THIN);
  tickSite(site, () => onGround(site) === 0 && site.state.plannedRamps.length === 0, DIG_TICKS);
}

describe('limit-sized shot on a levelled site (#2086)', () => {
  it('cuts a wide crater and strands its rubble, and the crater is opened and hauled out', () => {
    const site = limitSite();
    fireLimitShot(site, SHOT);
    const crater = craterCells(site);
    expect(crater.length).toBeGreaterThan(150);
    expect(Math.max(...crater.map(c => c.depth))).toBeGreaterThanOrEqual(6);
    const kept = thinRubble(site, THIN);
    expect(kept).toBeGreaterThan(20);
    const { state } = site;

    tickSite(site, () => state.plannedRamps.length > 0 || state.builtRamps.length > 0, CRATER_ACCESS_RECHECK_TICKS * 4);
    expect(state.plannedRamps.length + state.builtRamps.length).toBeGreaterThan(0);

    const before = onGround(site);
    tickSite(site, () => onGround(site) === 0, DIG_TICKS);
    expect(onGround(site)).toBeLessThan(before);
    expect(onGround(site)).toBe(0);
    expect(strandedOrders(site)).toEqual([]);
    expectNoWorldInvariantViolations(state);
  });

  it('digs the access ramp: it leaves plannedRamps with every segment done', () => {
    const site = limitSite();
    fireLimitShot(site, SHOT);
    thinRubble(site, THIN);
    const { state } = site;
    tickSite(site, () => state.builtRamps.length >= 1 && state.plannedRamps.length === 0, DIG_TICKS);
    expect(state.builtRamps.length).toBeGreaterThanOrEqual(1);
    expect(state.plannedRamps).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toEqual([]);
  });

  it('does not queue a second ramp for a crater the first ramp already opened', () => {
    const site = limitSite();
    shootAndClear(site, SHOT);
    const { state } = site;
    const built = state.builtRamps.length;
    expect(built).toBeGreaterThanOrEqual(1);
    tickSite(site, () => false, 2 * CRATER_ACCESS_RECHECK_TICKS);
    expect(state.builtRamps).toHaveLength(built);
    expect(state.plannedRamps).toHaveLength(0);
  });
});

describe('a shot that deepens an opened crater (#2086)', () => {
  /** Centred in the first crater, one grid cell inside it. */
  const DEEPEN: LimitShot = { ...SHOT, side: 3, x0: 33, z0: 33 };

  function deepened(): CraterSite {
    const site = limitSite();
    shootAndClear(site, SHOT);
    const firstDepth = Math.max(...craterCells(site).map(c => c.depth));
    restockShotFleet(site);
    fireLimitShot(site, DEEPEN);
    thinRubble(site, THIN);
    restockShotFleet(site); // the blast threw the fragmenter away
    expect(Math.max(...craterCells(site).map(c => c.depth))).toBeGreaterThan(firstDepth + 2);
    return site;
  }

  it('orders an access ramp to the deepened floor instead of leaving its rubble sealed', () => {
    const site = deepened();
    const { state } = site;
    const rampsBefore = state.builtRamps.length;
    expect(onGround(site)).toBeGreaterThan(0);

    tickSite(site, () => state.plannedRamps.length > 0 || state.builtRamps.length > rampsBefore,
      CRATER_ACCESS_ABANDON_DEBRIS_TICKS + 2 * CRATER_ACCESS_RECHECK_TICKS);
    expect(state.plannedRamps.length + state.builtRamps.length - rampsBefore).toBeGreaterThan(0);
  });

  it('hauls the deepened crater out within the dig window, with no order left debris_out_of_reach', () => {
    const site = deepened();
    const { state } = site;
    const before = onGround(site);
    expect(before).toBeGreaterThan(0);

    tickSite(site, () => onGround(site) === 0 && state.plannedRamps.length === 0, DIG_TICKS);
    expect(onGround(site)).toBe(0);
    expect(strandedOrders(site)).toEqual([]);
    expect(state.pendingActions.filter(a => a.type === 'haul_debris' || a.type === 'fragment_debris')).toEqual([]);
    expectNoWorldInvariantViolations(state);
  });

  it('does not silently abandon the sealed rubble: fragments on the ground keep a haul order or a ramp is under way', () => {
    const site = deepened();
    const { state } = site;
    tickSite(site, () => false, CRATER_ACCESS_ABANDON_DEBRIS_TICKS + 3 * CRATER_ACCESS_RECHECK_TICKS);
    const hasHaulOrder = state.pendingActions.some(a => a.type === 'haul_debris');
    const rampUnderway = state.plannedRamps.length > 0;
    expect(onGround(site) === 0 || hasHaulOrder || rampUnderway).toBe(true);
  });
});

describe('a second crater (#2086)', () => {
  it('gets its own access ramp even though the first crater already has one', () => {
    const site = limitSite();
    shootAndClear(site, { ...SHOT, x0: 36, z0: 36 });
    const { state } = site;
    const first = state.builtRamps.length;
    expect(first).toBeGreaterThanOrEqual(1);

    restockShotFleet(site);
    fireLimitShot(site, { ...SHOT, x0: 14, z0: 26 });
    thinRubble(site, THIN);
    restockShotFleet(site); // the blast threw the hauler away
    tickSite(site, () => state.builtRamps.length > first && state.plannedRamps.length === 0 && onGround(site) === 0, DIG_TICKS);
    expect(state.builtRamps.length).toBeGreaterThan(first);
    expect(onGround(site)).toBe(0);
    expect(strandedOrders(site)).toEqual([]);
    expectNoWorldInvariantViolations(state);
  });
});

describe('stranded rubble the planner cannot or may not act on (#2086)', () => {
  const PIT = { x0: 40, z0: 40, size: 12, drop: 8 };
  const inPit = (x: number, z: number) => x >= PIT.x0 && x < PIT.x0 + PIT.size && z >= PIT.z0 && z < PIT.z0 + PIT.size;
  const crater = (site: CraterSite) => site.state.pendingActions.filter(a =>
    (a.type === 'haul_debris' || a.type === 'fragment_debris') && inPit(a.targetX, a.targetZ));

  it('an unaffordable plan prunes nothing: the stranded orders stay past the abandon window, and the ramp is ordered once cash allows', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 8);
    const { state, run } = site;
    // Just above the cash reserve the planner keeps back for payroll: any ramp costs more than the surplus.
    const broke = Math.ceil(getOperatingCostPerHour(state).payroll * CRATER_ACCESS_CASH_RESERVE_TICKS) + 1;
    const hold = () => { state.cash = broke; return false; };
    tickUntilFresh(run, state, hold, CRATER_ACCESS_ABANDON_DEBRIS_TICKS + 4 * CRATER_ACCESS_RECHECK_TICKS);
    expect(state.plannedRamps).toHaveLength(0);
    expect(crater(site).length).toBeGreaterThan(0);
    expect(crater(site).every(a => a.blockedReason === 'debris_out_of_reach')).toBe(true);
    expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toEqual([]);

    state.cash = 5_000_000;
    tickUntilFresh(run, state, () => state.plannedRamps.length > 0, 2 * CRATER_ACCESS_RECHECK_TICKS);
    expect(state.plannedRamps).toHaveLength(1);
    expectNoWorldInvariantViolations(state);
  });

  it('a floor no ramp can reach is abandoned after the abandon window, with nothing dug and nothing spent', () => {
    const site = makeCraterSite([]);
    // A 4 m square shaft as deep as the site allows: no straight run fits the 64 m site and a lap round it is too short.
    const shaft = { x0: 30, z0: 30, size: 4, drop: site.top - 1 };
    cutPit(site, shaft);
    dropRubble(site, shaft, 8);
    const { state, run } = site;
    const stranded = () => state.pendingActions.filter(a =>
      (a.type === 'haul_debris' || a.type === 'fragment_debris') && a.blockedReason === 'debris_out_of_reach');
    tickUntilFresh(run, state, () => false, 2);
    expect(stranded().length).toBeGreaterThan(0);
    const start = state.tickCount;
    const cashStart = state.cash;
    tickUntilFresh(run, state, () => stranded().length === 0, CRATER_ACCESS_ABANDON_DEBRIS_TICKS + 4 * CRATER_ACCESS_RECHECK_TICKS);
    expect(stranded()).toEqual([]);
    expect(state.tickCount - start).toBeGreaterThanOrEqual(CRATER_ACCESS_ABANDON_DEBRIS_TICKS);
    expect(state.plannedRamps).toHaveLength(0);
    expect(state.builtRamps).toHaveLength(0);
    expect(state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction' && e.tick >= start)).toEqual([]);
    expect(state.cash).toBeLessThanOrEqual(cashStart);
    expectNoWorldInvariantViolations(state);
  });
});
