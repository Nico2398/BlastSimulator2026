// BlastSimulator2026 — Zone clearing and evacuation
// Players define safety zones before blasting and evacuate entities.

import type { VehicleState } from './Vehicle.js';
import type { EmployeeState } from './Employee.js';

// ── Zone bounds ──

export interface ZoneBounds {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

// ── Zone state ──

export interface ZoneState {
  activeZone: ZoneBounds | null;
}

export function createZoneState(): ZoneState {
  return { activeZone: null };
}

// ── Operations ──

/** Define a safety zone. */
export function defineZone(state: ZoneState, bounds: ZoneBounds): void {
  state.activeZone = {
    x1: Math.min(bounds.x1, bounds.x2),
    z1: Math.min(bounds.z1, bounds.z2),
    x2: Math.max(bounds.x1, bounds.x2),
    z2: Math.max(bounds.z1, bounds.z2),
  };
}

/** Clear the zone: move all employees and vehicles out. */
export function clearZone(
  zone: ZoneBounds,
  vehicles: VehicleState,
  employees: EmployeeState,
): { movedVehicles: number; movedEmployees: number } {
  let movedVehicles = 0;
  let movedEmployees = 0;

  // Move vehicles outside zone (to just beyond x2, z2)
  const safeX = zone.x2 + 5;
  const safeZ = zone.z2 + 5;

  for (const v of vehicles.vehicles) {
    if (isInZone(v.x, v.z, zone)) {
      v.x = safeX;
      v.z = safeZ;
      v.task = 'idle';
      movedVehicles++;
    }
  }

  for (const emp of employees.employees) {
    if (!emp.alive) continue;
    if (isInZone(emp.x, emp.z, zone)) {
      emp.x = safeX;
      emp.z = safeZ;
      movedEmployees++;
    }
  }

  return { movedVehicles, movedEmployees };
}

/** Check if the zone is clear of all entities. */
export function isZoneClear(
  zone: ZoneBounds,
  vehicles: VehicleState,
  employees: EmployeeState,
): boolean {
  for (const v of vehicles.vehicles) {
    if (isInZone(v.x, v.z, zone)) return false;
  }
  for (const emp of employees.employees) {
    if (!emp.alive) continue;
    if (isInZone(emp.x, emp.z, zone)) return false;
  }
  return true;
}

/** Check if a point is inside the zone. */
export function isInZone(x: number, z: number, zone: ZoneBounds): boolean {
  return x >= zone.x1 && x <= zone.x2 && z >= zone.z1 && z <= zone.z2;
}

/**
 * Default danger zone for a drill plan: the holes' bounding box, padded by
 * `marginM` on every side. Null for an empty plan — there is nothing to
 * define a box from. See BLAST_DANGER_MARGIN_M for why this is a heuristic,
 * not a physics-derived exclusion radius.
 */
export function computeDangerZone(holes: readonly { x: number; z: number }[], marginM: number): ZoneBounds | null {
  if (holes.length === 0) return null;
  let x1 = Infinity, z1 = Infinity, x2 = -Infinity, z2 = -Infinity;
  for (const h of holes) {
    x1 = Math.min(x1, h.x); z1 = Math.min(z1, h.z);
    x2 = Math.max(x2, h.x); z2 = Math.max(z2, h.z);
  }
  return { x1: x1 - marginM, z1: z1 - marginM, x2: x2 + marginM, z2: z2 + marginM };
}
