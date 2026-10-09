// Driving a tier-N vehicle needs licence level >= N (#1524). A licence level is
// a qualification property separate from proficiency: XP never raises it.

import { describe, it, expect } from 'vitest';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import type { VehicleTier } from '../../../src/core/entities/Vehicle.js';
import {
  canAssignDriver, canDriveTier, countLicenceHolders, licenceLevelOf,
} from '../../../src/core/entities/VehicleDriverAssignment.js';
import {
  createEmployeeState, hireEmployee, assignSkill, killEmployee,
} from '../../../src/core/entities/Employee.js';
import type { Employee, EmployeeState, LicenceLevel } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { XP_THRESHOLDS } from '../../../src/core/config/balance.js';

const LICENCE_ERROR = 'Employee lacks licence level for this vehicle tier';

/** Employee holding driving.drill_rig at `level` (undefined = field omitted, i.e. legacy level 1). */
function addRigDriver(es: EmployeeState, seed: number, level?: LicenceLevel): Employee {
  const { employee } = hireEmployee(es, 'driller', new Random(seed));
  employee.qualifications = employee.qualifications.filter(q => q.category !== 'driving.drill_rig');
  assignSkill(es, employee.id, 'driving.drill_rig', 1);
  const qual = employee.qualifications.find(q => q.category === 'driving.drill_rig')!;
  if (level !== undefined) qual.licenceLevel = level;
  return employee;
}

function rigOfTier(tier: VehicleTier) {
  const vs = createVehicleState();
  const { vehicle } = purchaseVehicle(vs, 'drill_rig', 5, 5, tier);
  return { vs, vehicle };
}

describe('licenceLevelOf', () => {
  it('returns 0 when the licence is not held', () => {
    const es = createEmployeeState();
    const { employee } = hireEmployee(es, 'surveyor', new Random(1));
    expect(licenceLevelOf(employee, 'drill_rig')).toBe(0);
  });

  it('treats a missing licenceLevel as 1', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 2);
    expect(e.qualifications.find(q => q.category === 'driving.drill_rig')!.licenceLevel).toBeUndefined();
    expect(licenceLevelOf(e, 'drill_rig')).toBe(1);
  });

  it.each([1, 2, 3] as LicenceLevel[])('returns the stored level %i', (level) => {
    const es = createEmployeeState();
    expect(licenceLevelOf(addRigDriver(es, 3, level), 'drill_rig')).toBe(level);
  });

  it('reads the licence of the vehicle role asked for (trucks share driving.truck)', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 4, 3);
    expect(licenceLevelOf(e, 'debris_hauler')).toBe(0);
    assignSkill(es, e.id, 'driving.truck', 1);
    expect(licenceLevelOf(e, 'debris_hauler')).toBe(1);
    expect(licenceLevelOf(e, 'building_destroyer')).toBe(1);
  });
});

describe('canDriveTier', () => {
  it('level 1 drives tier 1 only', () => {
    const e = addRigDriver(createEmployeeState(), 5, 1);
    expect(canDriveTier(e, 'drill_rig', 1)).toBe(true);
    expect(canDriveTier(e, 'drill_rig', 2)).toBe(false);
    expect(canDriveTier(e, 'drill_rig', 3)).toBe(false);
  });

  it('level 3 drives every tier (boundary)', () => {
    const e = addRigDriver(createEmployeeState(), 6, 3);
    for (const tier of [1, 2, 3] as VehicleTier[]) expect(canDriveTier(e, 'drill_rig', tier)).toBe(true);
  });

  it('an unlicensed employee drives nothing', () => {
    const { employee } = hireEmployee(createEmployeeState(), 'surveyor', new Random(7));
    expect(canDriveTier(employee, 'drill_rig', 1)).toBe(false);
  });
});

describe('countLicenceHolders', () => {
  it('counts alive employees whose level covers the tier', () => {
    const es = createEmployeeState();
    addRigDriver(es, 10, 1);
    addRigDriver(es, 11, 2);
    addRigDriver(es, 12, 3);
    expect(countLicenceHolders(es.employees, 'drill_rig', 1)).toBe(3);
    expect(countLicenceHolders(es.employees, 'drill_rig', 2)).toBe(2);
    expect(countLicenceHolders(es.employees, 'drill_rig', 3)).toBe(1);
  });

  it('ignores dead employees', () => {
    const es = createEmployeeState();
    const dead = addRigDriver(es, 13, 2);
    addRigDriver(es, 14, 2);
    killEmployee(es, dead.id);
    expect(countLicenceHolders(es.employees, 'drill_rig', 2)).toBe(1);
  });

  it('returns 0 for an empty roster', () => {
    expect(countLicenceHolders([], 'drill_rig', 1)).toBe(0);
  });
});

describe('canAssignDriver — licence tier', () => {
  it('refuses a level-1 holder on a tier-2 vehicle', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 20, 1);
    const { vs, vehicle } = rigOfTier(2);
    const r = canAssignDriver(vs, es, vehicle.id, e.id);
    expect(r).toEqual({ success: false, error: LICENCE_ERROR });
  });

  it('refuses a legacy qualification (no licenceLevel) on a tier-2 vehicle', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 21);
    const { vs, vehicle } = rigOfTier(2);
    expect(canAssignDriver(vs, es, vehicle.id, e.id)).toMatchObject({ success: false, error: LICENCE_ERROR });
  });

  it('accepts a level-2 holder on a tier-2 vehicle', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 22, 2);
    const { vs, vehicle } = rigOfTier(2);
    expect(canAssignDriver(vs, es, vehicle.id, e.id).success).toBe(true);
  });

  it('refuses a level-2 holder on a tier-3 vehicle', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 23, 2);
    const { vs, vehicle } = rigOfTier(3);
    expect(canAssignDriver(vs, es, vehicle.id, e.id)).toMatchObject({ success: false, error: LICENCE_ERROR });
  });

  it('proficiency 5 / max XP never substitutes for licence level', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 24, 1);
    const q = e.qualifications.find(x => x.category === 'driving.drill_rig')!;
    q.proficiencyLevel = 5;
    q.xp = XP_THRESHOLDS[5] + 1000;
    const { vs, vehicle } = rigOfTier(2);
    expect(canAssignDriver(vs, es, vehicle.id, e.id)).toMatchObject({ success: false, error: LICENCE_ERROR });
    expect(q.licenceLevel).toBe(1);
  });

  it('tier-1 vehicles stay drivable by a level-1 holder (unchanged)', () => {
    const es = createEmployeeState();
    const e = addRigDriver(es, 25, 1);
    const { vs, vehicle } = rigOfTier(1);
    expect(canAssignDriver(vs, es, vehicle.id, e.id).success).toBe(true);
  });

  it('no licence at all keeps the existing error', () => {
    const es = createEmployeeState();
    const { employee } = hireEmployee(es, 'surveyor', new Random(26));
    const { vs, vehicle } = rigOfTier(2);
    expect(canAssignDriver(vs, es, vehicle.id, employee.id)).toEqual({ success: false, error: 'Employee lacks licence for this role' });
  });
});
