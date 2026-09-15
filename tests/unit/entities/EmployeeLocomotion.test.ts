import { describe, it, expect } from 'vitest';
import { isMounted, mountedVehicleId, type Locomotion } from '../../../src/core/entities/EmployeeLocomotion';

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
});
