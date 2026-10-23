// BlastSimulator2026 — CraterAccessSync tests (#2082)
// The stranded crater is built by tests/helpers/craterAccessFixture.ts: a flat staffed progression
// site with a straight-walled pit and rubble on its floor, so haul orders classify as
// debris_out_of_reach. Everything runs through the real tick pipeline; nothing is mocked.

import { describe, it, expect } from 'vitest';
import { makeCraterSite, dropRubble, type CraterSite, type Pit } from '../../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../../helpers/blastFixtures.js';
import { CRATER_ACCESS_MIN_STRANDED_ORDERS, CRATER_ACCESS_RECHECK_TICKS } from '../../../src/core/config/balance.js';
import { strandedDebrisTargets } from '../../../src/core/engine/OrderReachability.js';

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

  it('charges the ramp as construction spending', () => {
    const site = strandedSite();
    const before = site.state.finances.expenses?.length ?? 0;
    tickUntilRamp(site, WINDOW);
    const spent = (site.state.finances.expenses ?? []).slice(before).filter(e => e.category === 'construction');
    expect(spent.length).toBeGreaterThan(0);
  });

  it('is idempotent: scanning again later does not order a second ramp for the same crater', () => {
    const site = strandedSite();
    tickUntilRamp(site, WINDOW);
    tickUntilFresh(site.run, site.state, () => false, CRATER_ACCESS_RECHECK_TICKS * 3);
    expect(site.state.plannedRamps).toHaveLength(1);
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
