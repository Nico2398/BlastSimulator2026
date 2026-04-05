// BlastSimulator2026 — Fragment collision handler
// Applies physics-simulated fragment impacts to game entities.
// After FragmentBody.simulate(), each FragmentSimResult has a finalPosition and
// impactSpeed. This module computes kinetic energy and applies damage to nearby
// buildings, vehicles, and employees using the same thresholds as Damage.ts.
//
// KE = 0.5 * mass * v²
// Real: a 50kg rock at 5 m/s has KE = 625 J — enough to injure, not kill.
// A 50kg rock at 10 m/s has KE = 2500 J — lethal.

import type { FragmentSimResult } from './FragmentBody.js';
import type { BuildingState, Building } from '../core/entities/Building.js';
import { getBuildingDef, destroyBuilding } from '../core/entities/Building.js';
import type { VehicleState, Vehicle } from '../core/entities/Vehicle.js';
import { destroyVehicle } from '../core/entities/Vehicle.js';
import type { EmployeeState, Employee } from '../core/entities/Employee.js';
import { injureEmployee, killEmployee } from '../core/entities/Employee.js';
import type { DamageState, AccidentRecord } from '../core/entities/Damage.js';
import {
  BUILDING_DAMAGE_THRESHOLD,
  INJURY_THRESHOLD,
  DEATH_THRESHOLD,
  HIT_RADIUS,
} from '../core/entities/Damage.js';

// ── Mass lookup ──

/**
 * Map from fragmentId to mass (kg).
 * Provided by caller from the original FragmentData array.
 */
export type FragmentMassMap = Map<number, number>;

// ── CollisionHandler ──

/**
 * Process physics simulation results: apply damage to nearby entities.
 * Call after FragmentBody.simulate() and getResults().
 *
 * @param results - Physics sim results with finalPosition and impactSpeed
 * @param massMap - Fragment mass by ID (from FragmentData[])
 * @param buildings - Building state
 * @param vehicles - Vehicle state
 * @param employees - Employee state
 * @param damage - Damage state (accidents appended here)
 * @param tick - Current game tick
 * @returns New accident records created during this call
 */
export function applyFragmentCollisions(
  results: FragmentSimResult[],
  massMap: FragmentMassMap,
  buildings: BuildingState,
  vehicles: VehicleState,
  employees: EmployeeState,
  damage: DamageState,
  tick: number,
): AccidentRecord[] {
  const newAccidents: AccidentRecord[] = [];

  for (const result of results) {
    const mass = massMap.get(result.fragmentId) ?? 0;
    if (mass === 0) continue;

    // KE = 0.5 * m * v²
    const ke = 0.5 * mass * result.impactSpeed * result.impactSpeed;
    if (ke === 0) continue;

    const fx = result.finalPosition.x;
    const fz = result.finalPosition.z;

    // Check buildings
    for (const b of [...buildings.buildings]) {
      if (isNearBuilding(fx, fz, b)) {
        const acc = processBuildingHit(b, buildings, result.fragmentId, ke, tick);
        if (acc) newAccidents.push(acc);
      }
    }

    // Check vehicles
    for (const v of [...vehicles.vehicles]) {
      if (isNear(fx, fz, v.x, v.z)) {
        const acc = processVehicleHit(v, vehicles, result.fragmentId, ke, tick);
        if (acc) newAccidents.push(acc);
      }
    }

    // Check employees
    for (const emp of employees.employees) {
      if (!emp.alive || emp.injured) continue;
      if (isNear(fx, fz, emp.x, emp.z)) {
        const acc = processEmployeeHit(emp, employees, result.fragmentId, ke, tick, damage);
        if (acc) newAccidents.push(acc);
      }
    }
  }

  damage.accidents.push(...newAccidents);
  return newAccidents;
}

/**
 * Build a FragmentMassMap from an array of fragment data objects.
 * Accepts any object with id and mass fields.
 */
export function buildMassMap(fragments: Array<{ id: number; mass: number }>): FragmentMassMap {
  return new Map(fragments.map(f => [f.id, f.mass]));
}

// ── Hit processing ──

function processBuildingHit(
  b: Building,
  state: BuildingState,
  fragmentId: number,
  ke: number,
  tick: number,
): AccidentRecord | null {
  if (ke < BUILDING_DAMAGE_THRESHOLD) return null;

  const dmg = Math.round(ke / 50); // Scale KE to HP damage (same as Damage.ts)
  b.hp -= dmg;

  if (b.hp <= 0) {
    destroyBuilding(state, b.id);
    return { tick, type: 'building_destroyed', entityId: b.id, fragmentId, kineticEnergy: ke };
  }
  return { tick, type: 'building_damage', entityId: b.id, fragmentId, kineticEnergy: ke };
}

function processVehicleHit(
  v: Vehicle,
  state: VehicleState,
  fragmentId: number,
  ke: number,
  tick: number,
): AccidentRecord | null {
  if (ke < BUILDING_DAMAGE_THRESHOLD) return null;

  const dmg = Math.round(ke / 40); // Vehicles slightly softer target
  v.hp -= dmg;

  if (v.hp <= 0) {
    destroyVehicle(state, v.id);
    return { tick, type: 'vehicle_destroyed', entityId: v.id, fragmentId, kineticEnergy: ke };
  }
  return { tick, type: 'vehicle_damage', entityId: v.id, fragmentId, kineticEnergy: ke };
}

function processEmployeeHit(
  emp: Employee,
  state: EmployeeState,
  fragmentId: number,
  ke: number,
  tick: number,
  damage: DamageState,
): AccidentRecord | null {
  if (ke >= DEATH_THRESHOLD) {
    killEmployee(state, emp.id);
    damage.lawsuitPending = true;
    damage.deathCount++;
    return { tick, type: 'death', entityId: emp.id, fragmentId, kineticEnergy: ke };
  }
  if (ke >= INJURY_THRESHOLD) {
    injureEmployee(state, emp.id);
    return { tick, type: 'injury', entityId: emp.id, fragmentId, kineticEnergy: ke };
  }
  return null;
}

// ── Helpers ──

function isNear(x1: number, z1: number, x2: number, z2: number): boolean {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz) <= HIT_RADIUS;
}

function isNearBuilding(fx: number, fz: number, b: Building): boolean {
  const def = getBuildingDef(b.type, b.tier);
  const xs = def.footprint.map(([dx]) => dx);
  const zs = def.footprint.map(([, dz]) => dz);
  const sizeX = Math.max(...xs) + 1;
  const sizeZ = Math.max(...zs) + 1;
  const cx = b.x + sizeX / 2;
  const cz = b.z + sizeZ / 2;
  return isNear(fx, fz, cx, cz);
}
