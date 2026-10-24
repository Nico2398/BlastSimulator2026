// BlastSimulator2026 — CraterAccessSync tests (#2082)
// The stranded crater is built by tests/helpers/craterAccessFixture.ts: a flat staffed progression
// site with a straight-walled pit and rubble on its floor, so haul orders classify as
// debris_out_of_reach. Everything runs through the real tick pipeline; nothing is mocked.

import { describe, it, expect } from 'vitest';
import { makeCraterSite, cutPit, dropRubble, parkBlockedRamp, type CraterSite, type Pit } from '../../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../../helpers/blastFixtures.js';
import { CRATER_ACCESS_MIN_STRANDED_ORDERS, CRATER_ACCESS_RECHECK_TICKS } from '../../../src/core/config/balance.js';
import { strandedDebrisTargets } from '../../../src/core/engine/OrderReachability.js';
import { hasLiveRampWork } from '../../../src/core/engine/StrandedAccess.js';

const PIT: Pit = { x0: 40, z0: 40, size: 12, drop: 8 };
/** One recheck window, plus a tick of classification lag before the first scan can see the orders. */
const WINDOW = CRATER_ACCESS_RECHECK_TICKS + 2;

function strandedSite(rubble = CRATER_ACCESS_MIN_STRANDED_ORDERS + 2): CraterSite {
  const site = makeCraterSite([PIT]);
  dropRubble(site, PIT, rubble);
  return site;
}

const rampOrders = (site: CraterSite) => site.state.pendingActions.filter(a => a.type === 'dig_ramp_segment');

/** Ticks until a planned ramp exists (at most `max` ticks). */
function tickUntilRamp(site: CraterSite, max: number): void {
  tickUntilFresh(site.run, site.state, () => site.state.plannedRamps.length > 0, max);
}

describe('syncCraterAccess', () => {
  it('the fixture really strands the crater: haul orders are debris_out_of_reach before any ramp', () => {
    const site = strandedSite();
    tickUntilFresh(site.run, site.state, () => false, 1);
    const stuck = site.state.pendingActions.filter(a => a.blockedReason === 'debris_out_of_reach');
    expect(stuck.length).toBeGreaterThanOrEqual(CRATER_ACCESS_MIN_STRANDED_ORDERS);
    expect(site.state.plannedRamps).toHaveLength(0);
    expect(strandedDebrisTargets(site.state).length).toBeGreaterThanOrEqual(CRATER_ACCESS_MIN_STRANDED_ORDERS);
  });

  it('orders exactly one access ramp within one recheck window', () => {
    const site = strandedSite();
    tickUntilRamp(site, WINDOW);
    expect(site.state.plannedRamps).toHaveLength(1);
    expect(rampOrders(site).length).toBeGreaterThan(0);
  });

  it('judges the network by where the fleet drives, not by a rally point cut off from it (#2076)', () => {
    const site = strandedSite();
    // A flag in a pit of its own stands for a pocket the fleet does not use: the fleet is on the surface.
    cutPit(site, { x0: 8, z0: 8, size: 8, drop: 8 });
    site.state.rallyPoint = { x: 12, z: 12 };
    tickUntilRamp(site, WINDOW);
    expect(site.state.plannedRamps).toHaveLength(1);
  });

  it('charges the ramp as construction spending', () => {
    const site = strandedSite();
    const before = site.state.finances.transactions.length;
    tickUntilRamp(site, WINDOW);
    const spent = site.state.finances.transactions.slice(before).filter(e => e.type === 'expense' && e.category === 'construction');
    expect(spent.length).toBeGreaterThan(0);
  });

  it('is idempotent: scanning again later does not order a second ramp for the same crater', () => {
    const site = strandedSite();
    const constructionSpend = () => site.state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction').length;
    tickUntilRamp(site, WINDOW);
    const ordered = constructionSpend();
    expect(ordered).toBeGreaterThan(0);
    // The crew may finish the ramp meanwhile (planned entry removed), so count charges, not plans.
    tickUntilFresh(site.run, site.state, () => false, CRATER_ACCESS_RECHECK_TICKS * 3);
    expect(constructionSpend()).toBe(ordered);
    expect(site.state.plannedRamps.length).toBeLessThanOrEqual(1);
  });

  it('orders nothing while a ramp is still pending', () => {
    const site = strandedSite();
    // A pending ramp already exists: the player ordered one that has not been dug yet.
    expect(site.run('build_ramp start:30,46 end:39,46 depth:4')).toMatchObject({ success: true });
    const planned = site.state.plannedRamps.length;
    expect(planned).toBe(1);
    // Keep the crew from finishing it before the scans run.
    for (const a of rampOrders(site)) a.status = 'queued';
    tickUntilFresh(site.run, site.state, () => site.state.plannedRamps.length > planned, CRATER_ACCESS_RECHECK_TICKS * 2);
    expect(site.state.plannedRamps).toHaveLength(planned);
  });

  it('holds back when cash would not cover the ramp plus the payroll reserve', () => {
    const site = strandedSite();
    site.state.cash = 10;
    tickUntilFresh(site.run, site.state, () => { site.state.cash = Math.min(site.state.cash, 10); return false; }, CRATER_ACCESS_RECHECK_TICKS * 2);
    expect(site.state.plannedRamps).toHaveLength(0);
  });

  it('does nothing on a site without the grade ladder', () => {
    const site = strandedSite();
    delete site.state.grade;
    tickUntilFresh(site.run, site.state, () => false, CRATER_ACCESS_RECHECK_TICKS * 2);
    expect(site.state.plannedRamps).toHaveLength(0);
  });

  it('does nothing while fewer than the minimum number of orders are stranded', () => {
    const site = strandedSite(CRATER_ACCESS_MIN_STRANDED_ORDERS - 1);
    tickUntilFresh(site.run, site.state, () => false, CRATER_ACCESS_RECHECK_TICKS * 2);
    const stuck = site.state.pendingActions.filter(a => a.blockedReason === 'debris_out_of_reach');
    expect(stuck.length).toBe(CRATER_ACCESS_MIN_STRANDED_ORDERS - 1);
    expect(site.state.plannedRamps).toHaveLength(0);
  });

  it('does nothing on a site with no crater at all', () => {
    const site = makeCraterSite([]);
    tickUntilFresh(site.run, site.state, () => false, CRATER_ACCESS_RECHECK_TICKS * 2);
    expect(site.state.plannedRamps).toHaveLength(0);
  });
});

describe('syncCraterAccess with blocked ramp segments (#2085)', () => {
  it('orders a new ramp within one recheck window although 12 blocked segments are pending', () => {
    const site = strandedSite();
    parkBlockedRamp(site, PIT);
    const before = site.state.plannedRamps.length;
    tickUntilFresh(site.run, site.state, () => site.state.plannedRamps.length > before, WINDOW);
    expect(site.state.plannedRamps.length).toBe(before + 1);
  });

  it('charges the new ramp as construction spending exactly once', () => {
    const site = strandedSite();
    parkBlockedRamp(site, PIT);
    const constructionSpend = () => site.state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction').length;
    const before = constructionSpend();
    tickUntilFresh(site.run, site.state, () => constructionSpend() > before, WINDOW);
    expect(constructionSpend()).toBe(before + 1);
    tickUntilFresh(site.run, site.state, () => false, CRATER_ACCESS_RECHECK_TICKS);
    expect(constructionSpend()).toBe(before + 1);
  });

  it('still orders nothing while one live ramp segment is pending beside the blocked ones', () => {
    const site = strandedSite();
    expect(site.run('build_ramp start:30,46 end:39,46 depth:4')).toMatchObject({ success: true });
    parkBlockedRamp(site, PIT);
    const constructionSpend = () => site.state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction').length;
    const ordered = constructionSpend();
    for (const a of rampOrders(site)) if (a.blockedReason !== 'target_unreachable') a.status = 'queued';
    // Tick only while the player's ramp is live: once the crew finishes it, just the blocked segments remain,
    // and those must not suppress an access ramp (the floor is still stranded), so a later order is correct.
    const start = site.state.tickCount;
    tickUntilFresh(site.run, site.state, () => !hasLiveRampWork(site.state.pendingActions), CRATER_ACCESS_RECHECK_TICKS * 2);
    expect(site.state.tickCount - start).toBeGreaterThanOrEqual(CRATER_ACCESS_RECHECK_TICKS + 1); // at least two scans saw it live
    expect(constructionSpend()).toBe(ordered);
  });
});

describe('syncCraterAccess with a held ramp segment carrying a stale stamp (#2085)', () => {
  it('counts a held segment as live work: no new ramp is ordered while it is held', () => {
    const site = strandedSite();
    parkBlockedRamp(site, PIT);
    // One segment was claimed after being stamped: held, still carrying the old blockedReason.
    const held = rampOrders(site)[0]!;
    held.status = 'assigned';
    held.holderId = site.state.employees.employees[0]!.id;
    expect(held.blockedReason).toBe('target_unreachable');
    expect(hasLiveRampWork([held])).toBe(true);
    const before = site.state.plannedRamps.length;
    // Keep the hold alive across scans.
    tickUntilFresh(site.run, site.state, () => {
      held.status = 'assigned';
      held.holderId = site.state.employees.employees[0]!.id;
      return site.state.plannedRamps.length > before;
    }, CRATER_ACCESS_RECHECK_TICKS * 2);
    expect(site.state.plannedRamps.length).toBe(before);
  });
});

describe('strandedDebrisTargets', () => {
  it('is empty with no orders', () => {
    expect(strandedDebrisTargets(makeCraterSite([PIT]).state)).toEqual([]);
  });

  it('lists the target of each stranded haul order and nothing else', () => {
    const site = strandedSite(4);
    tickUntilFresh(site.run, site.state, () => false, 1);
    const targets = strandedDebrisTargets(site.state);
    expect(targets).toHaveLength(4);
    for (const t of targets) {
      expect(t.x).toBeGreaterThanOrEqual(PIT.x0);
      expect(t.x).toBeLessThan(PIT.x0 + PIT.size);
      expect(t.z).toBeGreaterThanOrEqual(PIT.z0);
      expect(t.z).toBeLessThan(PIT.z0 + PIT.size);
    }
  });
});
