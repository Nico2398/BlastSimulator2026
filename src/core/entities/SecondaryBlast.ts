// BlastSimulator2026 — Secondary blasts
// A destroyed explosive warehouse holding stock detonates, hurting what is near it.

import { recordEmployeeDeath, type AccidentRecord, type DamageState } from './Damage.js';
import { buildingCenter, destroyBuilding, getBuildingDef, type Building, type BuildingState } from './Building.js';
import { destroyVehicle, getVehicleDefByTier, type VehicleState } from './Vehicle.js';
import { injureEmployee, type EmployeeState } from './Employee.js';
import {
  SECONDARY_BLAST_RADIUS_BASE_M,
  SECONDARY_BLAST_RADIUS_PER_SQRT_KG_M,
  SECONDARY_BLAST_RADIUS_MAX_M,
  SECONDARY_BLAST_STRUCTURE_DAMAGE_FRACTION,
  SECONDARY_BLAST_DEATH_RADIUS_FRACTION,
} from '../config/balance.js';

/** Emitted when an `explosive_warehouse` with stored explosives is destroyed. */
export interface SecondaryBlastEvent {
  buildingId: number;
  x: number;
  z: number;
  explosivesKg: number;
}

/** Event for a building whose destruction detonates stored explosives, else null. Centred on its footprint. */
export function secondaryBlastEventFor(b: Building): SecondaryBlastEvent | null {
  if (b.type !== 'explosive_warehouse' || (b.storedExplosivesKg ?? 0) <= 0) return null;
  const { cx, cz } = buildingCenter(b);
  return { buildingId: b.id, x: cx, z: cz, explosivesKg: b.storedExplosivesKg! };
}

function distanceBetween(x1: number, z1: number, x2: number, z2: number): number {
  return Math.hypot(x1 - x2, z1 - z2);
}

interface SecondaryBlastOutcome {
  event: SecondaryBlastEvent;
  radiusM: number;
  accidents: AccidentRecord[];
  /** Further warehouses the detonation destroyed, to be resolved in turn. */
  chained: SecondaryBlastEvent[];
}

/** Detonation radius in metres for a stored explosive mass. */
export function secondaryBlastRadiusM(kg: number): number {
  const radius = SECONDARY_BLAST_RADIUS_BASE_M + SECONDARY_BLAST_RADIUS_PER_SQRT_KG_M * Math.sqrt(Math.max(0, kg));
  return Math.min(SECONDARY_BLAST_RADIUS_MAX_M, radius);
}

/**
 * Resolve each event (and its chain) against buildings, vehicles and employees.
 * A worklist with a visited set: a stocked warehouse destroyed by one detonation
 * is resolved in turn, once. Deterministic — no randomness.
 */
export function resolveSecondaryBlasts(
  events: SecondaryBlastEvent[],
  buildings: BuildingState,
  vehicles: VehicleState,
  employees: EmployeeState,
  damage: DamageState,
  tick: number,
): SecondaryBlastOutcome[] {
  const outcomes: SecondaryBlastOutcome[] = [];
  const visited = new Set<number>();
  const worklist = [...events];

  for (let next = worklist.shift(); next !== undefined; next = worklist.shift()) {
    const event = next;
    if (visited.has(event.buildingId)) continue;
    visited.add(event.buildingId);

    const radiusM = secondaryBlastRadiusM(event.explosivesKg);
    const accidents: AccidentRecord[] = [];
    const chained: SecondaryBlastEvent[] = [];
    const record = (type: AccidentRecord['type'], entityId: number, entityLabel?: string): void => {
      accidents.push({ tick, type, entityId, fragmentId: -1, kineticEnergy: 0, ...(entityLabel ? { entityLabel } : {}) });
    };
    const injureOnce = (employeeId: number): void => {
      const emp = employees.employees.find(e => e.id === employeeId);
      if (emp && emp.alive && !emp.injured) {
        injureEmployee(employees, employeeId);
        record('injury', employeeId);
      }
    };

    for (const b of [...buildings.buildings]) {
      if (visited.has(b.id)) continue;
      const { cx, cz } = buildingCenter(b);
      const dist = distanceBetween(event.x, event.z, cx, cz);
      if (dist > radiusM) continue;
      const maxHp = getBuildingDef(b.type, b.tier).maxHp;
      b.hp -= maxHp * SECONDARY_BLAST_STRUCTURE_DAMAGE_FRACTION * (1 - dist / radiusM);
      if (b.hp > 0) {
        record('building_damage', b.id, b.type);
        continue;
      }
      for (const employeeId of b.occupantIds) injureOnce(employeeId);
      const follow = secondaryBlastEventFor(b);
      destroyBuilding(buildings, b.id);
      record('building_destroyed', b.id, b.type);
      if (follow) {
        chained.push(follow);
        worklist.push(follow);
      }
    }

    for (const v of [...vehicles.vehicles]) {
      const dist = distanceBetween(event.x, event.z, v.x, v.z);
      if (dist > radiusM) continue;
      const maxHp = getVehicleDefByTier(v.type, v.tier).maxHp;
      v.hp -= maxHp * SECONDARY_BLAST_STRUCTURE_DAMAGE_FRACTION * (1 - dist / radiusM);
      if (v.hp > 0) {
        record('vehicle_damage', v.id, v.type);
        continue;
      }
      for (const employeeId of v.occupantIds) injureOnce(employeeId);
      destroyVehicle(vehicles, v.id);
      record('vehicle_destroyed', v.id, v.type);
    }

    for (const emp of employees.employees) {
      if (!emp.alive) continue;
      const dist = distanceBetween(event.x, event.z, emp.x, emp.z);
      if (dist > radiusM) continue;
      if (dist <= radiusM * SECONDARY_BLAST_DEATH_RADIUS_FRACTION) {
        recordEmployeeDeath(employees, damage, emp.id);
        record('death', emp.id);
      } else {
        injureOnce(emp.id);
      }
    }

    damage.accidents.push(...accidents);
    outcomes.push({ event, radiusM, accidents, chained });
  }
  return outcomes;
}
