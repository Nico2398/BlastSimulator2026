// BlastSimulator2026 — Employee locomotion state
// An employee is the only mobile agent; a vehicle is a tool they ride and a
// building is a place they can be inside (#1202). Locomotion tracks which of
// the three an employee is: on foot, mounted in a vehicle, or inside a
// building. Mounted and inside are the two cases of one occupancy model —
// Mount.ts is their single writer.

export type Locomotion =
  | { kind: 'on_foot' }
  | { kind: 'mounted'; vehicleId: number }
  | { kind: 'inside'; buildingId: number };

/** True when the employee is mounted in a vehicle. Narrows to the mounted variant. */
export function isMounted(locomotion: Locomotion): locomotion is { kind: 'mounted'; vehicleId: number } {
  return locomotion.kind === 'mounted';
}

/** The vehicle id the employee is mounted in, or null when on foot. */
export function mountedVehicleId(locomotion: Locomotion): number | null {
  return isMounted(locomotion) ? locomotion.vehicleId : null;
}

/** True when the employee is inside a building. Narrows to the inside variant. */
export function isInsideBuilding(locomotion: Locomotion): locomotion is { kind: 'inside'; buildingId: number } {
  return locomotion.kind === 'inside';
}

/**
 * Whether the employee is off the ground — riding a vehicle or inside a
 * building. Such an employee has no body of their own in the world: the
 * renderer draws no character for them and the minimap no dot (#1202).
 */
export function isOccupyingHost(locomotion: Locomotion): boolean {
  return locomotion.kind !== 'on_foot';
}
