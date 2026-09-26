import { describe, it, expect } from 'vitest';
import {
  isMounted, mountedVehicleId, isInsideBuilding, isOccupyingHost, type Locomotion,
} from '../../../src/core/entities/EmployeeLocomotion';

describe('EmployeeLocomotion', () => {
  describe('isMounted', () => {
    it('returns true for a mounted locomotion', () => {
      const locomotion: Locomotion = { kind: 'mounted', vehicleId: 7 };
      expect(isMounted(locomotion)).toBe(true);
    });

    it('returns false for an on-foot locomotion', () => {
      const locomotion: Locomotion = { kind: 'on_foot' };
      expect(isMounted(locomotion)).toBe(false);
    });
  });

  describe('mountedVehicleId', () => {
    it('returns the vehicle id for a mounted locomotion', () => {
      const locomotion: Locomotion = { kind: 'mounted', vehicleId: 42 };
      expect(mountedVehicleId(locomotion)).toBe(42);
    });

    it('returns null for an on-foot locomotion', () => {
      const locomotion: Locomotion = { kind: 'on_foot' };
      expect(mountedVehicleId(locomotion)).toBeNull();
    });
  });

  describe('isInsideBuilding (#1202)', () => {
    it('is true only for the inside variant', () => {
      expect(isInsideBuilding({ kind: 'inside', buildingId: 3 })).toBe(true);
      expect(isInsideBuilding({ kind: 'mounted', vehicleId: 3 })).toBe(false);
      expect(isInsideBuilding({ kind: 'on_foot' })).toBe(false);
    });

    it('a mounted employee is not inside a building, and an inside one is not mounted', () => {
      expect(mountedVehicleId({ kind: 'inside', buildingId: 3 })).toBeNull();
    });
  });

  describe('isOccupyingHost (#1202)', () => {
    it('is true for mounted and inside, false on foot', () => {
      expect(isOccupyingHost({ kind: 'mounted', vehicleId: 1 })).toBe(true);
      expect(isOccupyingHost({ kind: 'inside', buildingId: 1 })).toBe(true);
      expect(isOccupyingHost({ kind: 'on_foot' })).toBe(false);
    });
  });
});
