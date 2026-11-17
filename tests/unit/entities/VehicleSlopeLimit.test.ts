// BlastSimulator2026 — Unit tests: the one vehicle climb limit (#2045)

import { describe, it, expect } from 'vitest';
import { vehicleMaxSlopeRatio, roleMaxSlopeRatio, getAllVehicleRoles, type VehicleRole } from '../../../src/core/entities/Vehicle.js';
import { NAV_MAX_SLOPE_RATIO, VEHICLE_MAX_SLOPE_DEGREES, VEHICLE_MAX_SLOPE_RATIO, TRAVEL_VEHICLE_MAX_SLOPE_DEGREES, TRAVEL_VEHICLE_MAX_SLOPE_RATIO } from '../../../src/core/config/balance.js';
import { createGame, isProgressionSite } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';

const deg = (d: number): number => Math.tan(d * Math.PI / 180);

describe('vehicleMaxSlopeRatio (#2045)', () => {
  it('on a progression site: one 20 degree limit, no tier argument', () => {
    expect(vehicleMaxSlopeRatio(true)).toBeCloseTo(deg(20), 12);
    expect(vehicleMaxSlopeRatio(true)).toBeCloseTo(VEHICLE_MAX_SLOPE_RATIO, 12);
  });

  it('the limit constant is 20 degrees', () => {
    expect(VEHICLE_MAX_SLOPE_DEGREES).toBe(20);
  });

  it('off a progression site: the global 30 degree limit', () => {
    expect(vehicleMaxSlopeRatio(false)).toBeCloseTo(NAV_MAX_SLOPE_RATIO, 12);
  });

  it('the progression limit is strictly below the walking limit', () => {
    expect(vehicleMaxSlopeRatio(true)).toBeLessThan(vehicleMaxSlopeRatio(false));
  });
});

describe('isProgressionSite', () => {
  it('is false for a campaign state with no grade', () => {
    expect(isProgressionSite(createGame({ seed: 42 }))).toBe(false);
  });

  it('is true once the state carries a grade, even grade 0', () => {
    const state = createGame({ seed: 42 });
    state.grade = createGradeState();
    expect(isProgressionSite(state)).toBe(true);
  });
});

const WORK_ROLES = (): VehicleRole[] => getAllVehicleRoles().filter(r => r !== 'travel_vehicle');

describe('roleMaxSlopeRatio: one climb limit per vehicle role (#2288 C1)', () => {
  it('the travel limit is 8 degrees', () => {
    expect(TRAVEL_VEHICLE_MAX_SLOPE_DEGREES).toBe(8);
    expect(TRAVEL_VEHICLE_MAX_SLOPE_RATIO).toBeCloseTo(deg(8), 12);
  });

  it('there are six work roles and the travel role', () => {
    expect(WORK_ROLES()).toHaveLength(6);
    expect(getAllVehicleRoles()).toContain('travel_vehicle');
  });

  it.each(['drill_rig', 'rock_digger', 'rock_fragmenter', 'charging_truck', 'debris_hauler', 'building_destroyer'] as const)(
    'a %s keeps the work limit on a progression site (20 degrees)',
    (role) => {
      expect(roleMaxSlopeRatio(role, true)).toBeCloseTo(vehicleMaxSlopeRatio(true), 12);
      expect(roleMaxSlopeRatio(role, true)).toBeCloseTo(VEHICLE_MAX_SLOPE_RATIO, 12);
    },
  );

  it('every work role keeps the shared nav limit off a progression site', () => {
    for (const role of WORK_ROLES()) expect(roleMaxSlopeRatio(role, false)).toBeCloseTo(NAV_MAX_SLOPE_RATIO, 12);
  });

  it('the travel role is limited to 8 degrees on a progression site', () => {
    expect(roleMaxSlopeRatio('travel_vehicle', true)).toBeCloseTo(TRAVEL_VEHICLE_MAX_SLOPE_RATIO, 12);
    expect(roleMaxSlopeRatio('travel_vehicle', true)).toBeCloseTo(deg(8), 12);
  });

  it('the travel limit is markedly below the work limit on a progression site', () => {
    expect(roleMaxSlopeRatio('travel_vehicle', true)).toBeLessThan(roleMaxSlopeRatio('drill_rig', true) * 0.6);
  });

  it('off a progression site the travel role shares the nav limit', () => {
    expect(roleMaxSlopeRatio('travel_vehicle', false)).toBeCloseTo(NAV_MAX_SLOPE_RATIO, 12);
    expect(roleMaxSlopeRatio('travel_vehicle', false)).toBeCloseTo(vehicleMaxSlopeRatio(false), 12);
  });

  it('vehicleMaxSlopeRatio stays the work-role limit', () => {
    expect(vehicleMaxSlopeRatio(true)).toBeCloseTo(roleMaxSlopeRatio('debris_hauler', true), 12);
    expect(vehicleMaxSlopeRatio(false)).toBeCloseTo(roleMaxSlopeRatio('debris_hauler', false), 12);
  });
});
