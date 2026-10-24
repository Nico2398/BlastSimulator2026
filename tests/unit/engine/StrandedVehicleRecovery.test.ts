// BlastSimulator2026 — stranded recovery tests (#2085)
// Built on the crater fixture: a flat staffed progression site with a straight-walled pit nobody can leave.

import { describe, it, expect } from 'vitest';
import { makeCraterSite, type CraterSite, type Pit } from '../../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../../helpers/blastFixtures.js';
import { STRANDED_RECOVERY_TICKS, CRATER_ACCESS_RECHECK_TICKS } from '../../../src/core/config/balance.js';
import { employeeClimbReach } from '../../../src/core/engine/OrderReachability.js';
import { recoverStranded } from '../../../src/core/engine/StrandedVehicleRecovery.js';

const PIT: Pit = { x0: 40, z0: 40, size: 12, drop: 8 };
const CENTRE = { x: 46, z: 46 };
const WINDOW = STRANDED_RECOVERY_TICKS + CRATER_ACCESS_RECHECK_TICKS * 2;

const inPit = (p: { x: number; z: number }): boolean =>
  p.x >= PIT.x0 && p.x < PIT.x0 + PIT.size && p.z >= PIT.z0 && p.z < PIT.z0 + PIT.size;

function idleDriverlessVehicle(site: CraterSite) {
  return site.state.vehicles.vehicles.find(v => v.occupantIds.length === 0)!;
}

describe('recoverStranded', () => {
  it('tows a driverless vehicle left in a cut-off pit back to the licensed crew', () => {
    const site = makeCraterSite([PIT]);
    const vehicle = idleDriverlessVehicle(site);
    vehicle.x = CENTRE.x;
    vehicle.z = CENTRE.z;
    tickUntilFresh(site.run, site.state, () => !inPit(vehicle), WINDOW);
    expect(inPit(vehicle)).toBe(false);
  });

  it('leaves the vehicle alone before the grace period ends', () => {
    const site = makeCraterSite([PIT]);
    const vehicle = idleDriverlessVehicle(site);
    vehicle.x = CENTRE.x;
    vehicle.z = CENTRE.z;
    tickUntilFresh(site.run, site.state, () => false, STRANDED_RECOVERY_TICKS / 2);
    expect(inPit(vehicle)).toBe(true);
  });

  it('walks an on-foot employee left in a cut-off pit back to the crew', () => {
    const site = makeCraterSite([PIT]);
    const emp = site.state.employees.employees.find(e => e.locomotion.kind === 'on_foot')!;
    emp.x = CENTRE.x;
    emp.z = CENTRE.z;
    tickUntilFresh(site.run, site.state, () => !inPit(emp), WINDOW);
    expect(inPit(emp)).toBe(false);
  });

  it('does nothing on a site without the grade ladder', () => {
    const site = makeCraterSite([PIT]);
    delete site.state.grade;
    const vehicle = idleDriverlessVehicle(site);
    vehicle.x = CENTRE.x;
    vehicle.z = CENTRE.z;
    for (let i = 0; i < 3; i++) {
      site.state.tickCount += STRANDED_RECOVERY_TICKS;
      recoverStranded(site.state);
    }
    expect(inPit(vehicle)).toBe(true);
  });

  it('tows nothing when everyone is connected', () => {
    const site = makeCraterSite([PIT]);
    const before = site.state.vehicles.vehicles.map(v => `${v.x},${v.z}`);
    expect(employeeClimbReach(site.state)).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      site.state.tickCount += STRANDED_RECOVERY_TICKS;
      recoverStranded(site.state);
    }
    expect(site.state.vehicles.vehicles.map(v => `${v.x},${v.z}`)).toEqual(before);
  });
});
