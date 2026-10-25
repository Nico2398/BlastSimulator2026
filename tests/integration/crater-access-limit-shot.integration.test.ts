// BlastSimulator2026 — Integration: crater access after limit-sized shots (#2086, #2095).
//
// The ladder probe fires permit-limit shots; each cuts a wide crater and strands its rubble. The core never opens
// a crater by itself (#2095): its haul orders stay debris_out_of_reach until the player orders a way in. Here the
// probe's access policy (`orderCraterAccess`, scripts/shared/probe-crater-access.ts) plays that player, ordering
// its ramps through the console and paying for them, for the first crater, a crater deepened by a later shot and
// a second crater.
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
import { isFragmentSealed } from '../../src/core/economy/SealedFragments.js';
import { getOperatingCostPerHour } from '../../src/core/economy/OperatingFinance.js';
import { describeRampClimbability } from '../../src/core/mining/RampGrade.js';
import { siteVehicleReach } from '../../src/core/engine/OrderReachability.js';
import { t } from '../../src/core/i18n/I18n.js';
import {
  ACCESS_CASH_RESERVE_TICKS, ACCESS_RECHECK_TICKS, newCraterAccessMemory, orderCraterAccess, type CraterAccessMemory,
} from '../../scripts/shared/probe-crater-access.js';

const THIN = 40;
/** Ticks allowed for the crew to dig an access ramp and then clear the crater floor. */
const DIG_TICKS = 4000;
const SHOT: LimitShot = { side: 4, spacing: 4, depth: 8, kgPerHole: 10, x0: 30, z0: 30, explosive: 'krackle', diameter: 0.089 };

/** Depth the player asks of the long access ramp; the order lands it on the floor its end row shows (#2045). */
const PLAYER_RAMP_DEPTH = 15;
/** Ticks the core is given to open a crater by itself; it must not. */
const IDLE_TICKS = 2000;

/**
 * Ticks with the score and cash topped up: a limit shot's rubble bleeds ecology to a shutdown before it is hauled.
 * With `access`, the probe's access policy plays the player between ticks.
 */
function tickSite(site: CraterSite, until: () => boolean, maxTicks: number, access?: CraterAccessMemory): void {
  const run = site.run as (cmd: string) => { success: boolean; output: string };
  tickUntilFresh(site.run, site.state, () => {
    site.state.scores.ecology = 100;
    site.state.cash = Math.max(site.state.cash, 3_000_000);
    if (access) orderCraterAccess(run, site.state, site.ctx.grid!, access);
    return until();
  }, maxTicks);
}

const onGround = (site: CraterSite) => site.state.logistics.fragments.filter(f => f.state === 'on_ground').length;
/**
 * Fragments a hauler can ever pick up: a blast also leaves rubble embedded in rock columns it did not break (the pillars of
 * a deepened crater). Those are sealed (`isFragmentSealed`), get no haul order until the rock is cut away, and no ramp
 * changes that, so the crater counts as hauled out once only sealed fragments remain.
 */
const unsealedOnGround = (site: CraterSite) => site.state.logistics.fragments
  .filter(f => f.state === 'on_ground' && !isFragmentSealed(site.ctx.grid!, f.fragment.position)).length;
const strandedOrders = (site: CraterSite) => site.state.pendingActions.filter(a =>
  (a.type === 'haul_debris' || a.type === 'fragment_debris') && a.blockedReason === 'debris_out_of_reach');

function limitSite(): CraterSite {
  const site = makeCraterSite([], { grade: 2 });
  expect(addSpoilHeaps(site.run, 6)).toBeGreaterThan(0);
  return site;
}

/** Fires a shot, thins its rubble and runs, the player ordering the way in, until no fragment is left on the ground. */
function shootAndClear(site: CraterSite, shot: LimitShot, access: CraterAccessMemory): void {
  fireLimitShot(site, shot);
  thinRubble(site, THIN);
  tickSite(site, () => onGround(site) === 0 && site.state.plannedRamps.length === 0, DIG_TICKS, access);
}

describe('limit-sized shot on a levelled site (#2086, #2095)', () => {
  it('cuts a wide crater and strands its rubble, and the core opens nothing by itself', () => {
    const site = limitSite();
    fireLimitShot(site, SHOT);
    const crater = craterCells(site);
    expect(crater.length).toBeGreaterThan(150);
    expect(Math.max(...crater.map(c => c.depth))).toBeGreaterThanOrEqual(6);
    expect(thinRubble(site, THIN)).toBeGreaterThan(20);
    const { state } = site;

    tickSite(site, () => false, IDLE_TICKS);
    expect(state.plannedRamps).toEqual([]);
    expect(state.builtRamps).toEqual([]);
    expect(strandedOrders(site).length).toBeGreaterThan(0);
    expect(onGround(site)).toBeGreaterThan(0);
    expectNoWorldInvariantViolations(state);
  });

  it('the player orders an access ramp, it is dug, and the crater is hauled out', () => {
    const site = limitSite();
    fireLimitShot(site, SHOT);
    thinRubble(site, THIN);
    const { state } = site;
    const access = newCraterAccessMemory();

    tickSite(site, () => state.plannedRamps.length > 0, ACCESS_RECHECK_TICKS * 4, access);
    expect(state.plannedRamps).toHaveLength(1);
    const before = onGround(site);
    tickSite(site, () => onGround(site) === 0 && state.plannedRamps.length === 0, DIG_TICKS, access);
    expect(state.builtRamps.length).toBeGreaterThanOrEqual(1);
    expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toEqual([]);
    expect(onGround(site)).toBeLessThan(before);
    expect(onGround(site)).toBe(0);
    expect(strandedOrders(site)).toEqual([]);
    expectNoWorldInvariantViolations(state);
  });

  it('orders no second ramp for a crater the first ramp already opened', () => {
    const site = limitSite();
    const access = newCraterAccessMemory();
    shootAndClear(site, SHOT, access);
    const { state } = site;
    const built = state.builtRamps.length;
    expect(built).toBeGreaterThanOrEqual(1);
    tickSite(site, () => false, 2 * ACCESS_RECHECK_TICKS, access);
    expect(state.builtRamps).toHaveLength(built);
    expect(state.plannedRamps).toHaveLength(0);
  });
});

describe('a shot that deepens an opened crater (#2086, #2095)', () => {
  /** The first crater's way in, ordered by hand so the shot below cuts its foot whatever the access policy would plan. */
  const FIRST_RAMP = 'build_ramp start:37,11 end:37,36 depth:8';
  /** Centred in the first crater, one grid cell inside it. */
  const DEEPEN: LimitShot = { ...SHOT, side: 3, x0: 33, z0: 33 };

  function deepened(access: CraterAccessMemory): CraterSite {
    const site = limitSite();
    // The player opened the first crater with a straight ramp in from the north; the deepening shot cuts its foot.
    fireLimitShot(site, SHOT);
    thinRubble(site, THIN);
    expect(site.run(FIRST_RAMP)).toMatchObject({ success: true });
    tickSite(site, () => unsealedOnGround(site) === 0 && site.state.plannedRamps.length === 0, DIG_TICKS, access);
    const firstDepth = Math.max(...craterCells(site).map(c => c.depth));
    restockShotFleet(site);
    fireLimitShot(site, DEEPEN);
    thinRubble(site, THIN);
    restockShotFleet(site); // the blast threw the fragmenter away
    expect(Math.max(...craterCells(site).map(c => c.depth))).toBeGreaterThan(firstDepth + 2);
    return site;
  }

  it('the deepened floor waits for the player: no ramp by itself, its rubble keeps its haul orders', () => {
    const access = newCraterAccessMemory();
    const site = deepened(access);
    const { state } = site;
    const rampsBefore = state.builtRamps.length;
    expect(onGround(site)).toBeGreaterThan(0);
    tickSite(site, () => false, IDLE_TICKS);
    expect(state.plannedRamps).toEqual([]);
    expect(state.builtRamps).toHaveLength(rampsBefore);
    expect(strandedOrders(site).length).toBeGreaterThan(0);
  });

  it('the shot cut through the access ramp\'s foot: the ramp reads too steep and is past repair at its length', () => {
    const access = newCraterAccessMemory();
    const site = deepened(access);
    const { state, run } = site;
    const first = state.builtRamps[0]!;
    expect(describeRampClimbability(state.navGrid, first, true)?.climbable).toBe(false);
    expect(run(`repair_ramp id:${first.id}`)).toMatchObject({ success: false, output: t('mining.repair_ramp.out_of_reach', { id: first.id }) });
  });

  it('a longer ramp the player orders down to the deepened floor opens it, and the floor it lands on is hauled out', () => {
    const access = newCraterAccessMemory();
    const site = deepened(access);
    const { state, run } = site;
    const before = unsealedOnGround(site);
    expect(before).toBeGreaterThan(0);
    // 15 m down from the surface needs 42 m of road at 20 degrees: down the east side, then west into the crater.
    expect(run(`build_ramp path:55,5;55,37;43,37 depth:${PLAYER_RAMP_DEPTH}`)).toMatchObject({ success: true });

    tickSite(site, () => state.plannedRamps.length === 0, DIG_TICKS);
    expect(state.plannedRamps).toEqual([]);
    // The ramp lands flush on the deepened floor: its end tile is on the vehicle network.
    expect(siteVehicleReach(state)!(43, 37)).toBe(true);
    tickSite(site, () => false, DIG_TICKS);
    // What stays is rubble on the lumps, the pillar and the old ledge the shot left standing above or apart from
    // that floor: no ramp reaches those, the player levels the ground or leaves them (the pip says so).
    expect(unsealedOnGround(site)).toBeLessThan(before / 2);
    const leftover = state.logistics.fragments.filter(f => f.state === 'on_ground' && !isFragmentSealed(site.ctx.grid!, f.fragment.position));
    const orders = new Map(state.pendingActions.map(a => [a.payload['fragmentId'], a]));
    expect(leftover.every(f => orders.get(f.fragment.id)?.blockedReason === 'debris_out_of_reach')).toBe(true);
    expectNoWorldInvariantViolations(state);
  });
});

describe('a second crater (#2086, #2095)', () => {
  /** Fragments the second shot may leave on a wall it did not break, out of every ramp's reach. */
  const LEFT_ON_WALLS = 2;

  it('gets its own access ramp even though the first crater already has one', () => {
    const site = limitSite();
    const access = newCraterAccessMemory();
    shootAndClear(site, { ...SHOT, x0: 36, z0: 36 }, access);
    const { state } = site;
    const first = state.builtRamps.length;
    expect(first).toBeGreaterThanOrEqual(1);

    restockShotFleet(site);
    fireLimitShot(site, { ...SHOT, x0: 14, z0: 26 });
    thinRubble(site, THIN);
    restockShotFleet(site); // the blast threw the hauler away
    tickSite(site, () => state.builtRamps.length > first && state.plannedRamps.length === 0 && onGround(site) <= LEFT_ON_WALLS, DIG_TICKS, access);
    expect(state.builtRamps.length).toBeGreaterThan(first);
    // What may stay lies lodged against a wall the shot left standing between the craters and the first ramp, metres
    // below the wall top a hauler drives on: at most a couple of pieces.
    const left = state.logistics.fragments.filter(f => f.state === 'on_ground');
    expect(left.length).toBeLessThanOrEqual(LEFT_ON_WALLS);
    expect(strandedOrders(site).length).toBeLessThanOrEqual(left.length);
    expectNoWorldInvariantViolations(state);
  });
});

describe('stranded rubble the player cannot or may not open yet (#2086, #2095)', () => {
  const PIT = { x0: 40, z0: 40, size: 12, drop: 8 };
  const inPit = (x: number, z: number) => x >= PIT.x0 && x < PIT.x0 + PIT.size && z >= PIT.z0 && z < PIT.z0 + PIT.size;
  const crater = (site: CraterSite) => site.state.pendingActions.filter(a =>
    (a.type === 'haul_debris' || a.type === 'fragment_debris') && inPit(a.targetX, a.targetZ));

  it('a ramp the cash cannot cover is not ordered and drops nothing; it is ordered once cash allows', () => {
    const site = makeCraterSite([PIT]);
    dropRubble(site, PIT, 8);
    const { state, run } = site;
    const access = newCraterAccessMemory();
    const runner = run as (cmd: string) => { success: boolean; output: string };
    // Just above the reserve the probe keeps back for payroll: any ramp costs more than the surplus.
    const broke = Math.ceil(getOperatingCostPerHour(state).payroll * ACCESS_CASH_RESERVE_TICKS) + 1;
    const hold = () => { state.cash = broke; orderCraterAccess(runner, state, site.ctx.grid!, access); return false; };
    tickUntilFresh(run, state, hold, IDLE_TICKS);
    expect(state.plannedRamps).toHaveLength(0);
    expect(crater(site).length).toBeGreaterThan(0);
    expect(crater(site).every(a => a.blockedReason === 'debris_out_of_reach')).toBe(true);
    expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toEqual([]);

    state.cash = 5_000_000;
    tickUntilFresh(run, state, () => { orderCraterAccess(runner, state, site.ctx.grid!, access); return state.plannedRamps.length > 0; }, 2 * ACCESS_RECHECK_TICKS);
    expect(state.plannedRamps).toHaveLength(1);
    expectNoWorldInvariantViolations(state);
  });

  it('a floor no ramp can reach keeps its debris orders: nothing is dropped, dug or spent', () => {
    const site = makeCraterSite([]);
    // A 4 m square shaft as deep as the site allows: no straight run fits the 64 m site and a lap round it is too short.
    const shaft = { x0: 30, z0: 30, size: 4, drop: site.top - 1 };
    cutPit(site, shaft);
    dropRubble(site, shaft, 8);
    const { state, run } = site;
    const access = newCraterAccessMemory();
    const runner = run as (cmd: string) => { success: boolean; output: string };
    const stranded = () => state.pendingActions.filter(a =>
      (a.type === 'haul_debris' || a.type === 'fragment_debris') && a.blockedReason === 'debris_out_of_reach');
    tickUntilFresh(run, state, () => false, 2);
    const ids = stranded().map(a => a.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    const start = state.tickCount;
    tickUntilFresh(run, state, () => { orderCraterAccess(runner, state, site.ctx.grid!, access); return false; }, IDLE_TICKS);
    expect(stranded().map(a => a.id).sort()).toEqual(ids);
    expect(state.plannedRamps).toHaveLength(0);
    expect(state.builtRamps).toHaveLength(0);
    expect(state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction' && e.tick >= start)).toEqual([]);
    expectNoWorldInvariantViolations(state);
  });
});
