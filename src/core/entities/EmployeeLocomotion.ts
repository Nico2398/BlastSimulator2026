// BlastSimulator2026 — Employee locomotion state
// An employee is the only mobile agent; a vehicle is a tool they ride.
// Locomotion tracks whether an employee is on foot or mounted in a vehicle.

export type Locomotion =
  | { kind: 'on_foot' }
  | { kind: 'mounted'; vehicleId: number };

/** True when the employee is mounted in a vehicle. Narrows to the mounted variant. */
export function isMounted(_locomotion: Locomotion): _locomotion is { kind: 'mounted'; vehicleId: number } {
  throw new Error('not implemented');
}

/** True when the employee is on foot. */
export function isOnFoot(_locomotion: Locomotion): boolean {
  throw new Error('not implemented');
}

/** The vehicle id the employee is mounted in, or null when on foot. */
export function mountedVehicleId(_locomotion: Locomotion): number | null {
  throw new Error('not implemented');
}
