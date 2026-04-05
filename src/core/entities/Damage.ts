// BlastSimulator2026 — Damage and casualty system
// Processes fragment impacts on buildings, vehicles, and employees.
// Kinetic energy = 0.5 * mass * velocity² (real physics).

import type { FragmentData } from '../mining/BlastExecution.js';
import { length } from '../math/Vec3.js';
import type { BuildingState, Building } from './Building.js';
import { getBuildingDef, destroyBuilding } from './Building.js';
import type { VehicleState, Vehicle } from './Vehicle.js';
import { destroyVehicle } from './Vehicle.js';
import type { EmployeeState, Employee } from './Employee.js';
import { injureEmployee, killEmployee } from './Employee.js';

// ── Config ──

/** Kinetic energy (J) threshold for building damage. */
const BUILDING_DAMAGE_THRESHOLD = 500;
/** Kinetic energy (J) threshold for employee injury. */
const INJURY_THRESHOLD = 100;
/** Kinetic energy (J) threshold for employee death. */
const DEATH_THRESHOLD = 2000;
/** Hit radius: how close a fragment must be to an entity to affect it (grid cells). */
const HIT_RADIUS = 2.0;

// ── Accident record ──

export interface AccidentRecord {
  tick: number;
  type: 'building_damage' | 'building_destroyed' | 'vehicle_damage' | 'vehicle_destroyed' | 'injury' | 'death';
  entityId: number;
  fragmentId: number;
  kineticEnergy: number;
}

// ── Damage state ──

export interface DamageState {
  accidents: AccidentRecord[];
  lawsuitPending: boolean;
  deathCount: number;
  /** Total number of blasts detonated in this session. */
  blastCount: number;
}

export function createDamageState(): DamageState {
  return { accidents: [], lawsuitPending: false, deathCount: 0, blastCount: 0 };
}

// ── Processing ──

/**
 * Process projection fragments against all entities.
 * Returns list of accidents that occurred.
 */
export function processProjections(
  projections: FragmentData[],
  buildings: BuildingState,
  vehicles: VehicleState,
  employees: EmployeeState,
  damage: DamageState,
  tick: number,
): AccidentRecord[] {
  const newAccidents: AccidentRecord[] = [];

  for (const frag of projections) {
    if (!frag.isProjection) continue;

    const ke = kineticEnergy(frag.mass, length(frag.initialVelocity));
    const fx = frag.position.x;
    const fz = frag.position.z;

    // Check buildings
    for (const b of [...buildings.buildings]) {
      if (isNearBuilding(fx, fz, b)) {
        const acc = processBuildingHit(b, buildings, frag, ke, tick);
        if (acc) newAccidents.push(acc);
      }
    }

    // Check vehicles
    for (const v of [...vehicles.vehicles]) {
      if (isNear(fx, fz, v.x, v.z)) {
        const acc = processVehicleHit(v, vehicles, frag, ke, tick);
        if (acc) newAccidents.push(acc);
      }
    }

    // Check employees
    for (const emp of employees.employees) {
      if (!emp.alive || emp.injured) continue;
      if (isNear(fx, fz, emp.x, emp.z)) {
        const acc = processEmployeeHit(emp, employees, frag, ke, tick, damage);
        if (acc) newAccidents.push(acc);
      }
    }
  }

  damage.accidents.push(...newAccidents);
  return newAccidents;
}

// ── Hit processing ──

function processBuildingHit(
  b: Building,
  state: BuildingState,
  frag: FragmentData,
  ke: number,
  tick: number,
): AccidentRecord | null {
  if (ke < BUILDING_DAMAGE_THRESHOLD) return null;

  const dmg = Math.round(ke / 50); // Scale KE to HP damage
  b.hp -= dmg;

  if (b.hp <= 0) {
    destroyBuilding(state, b.id);
    return { tick, type: 'building_destroyed', entityId: b.id, fragmentId: frag.id, kineticEnergy: ke };
  }
  return { tick, type: 'building_damage', entityId: b.id, fragmentId: frag.id, kineticEnergy: ke };
}

function processVehicleHit(
  v: Vehicle,
  state: VehicleState,
  frag: FragmentData,
  ke: number,
  tick: number,
): AccidentRecord | null {
  if (ke < BUILDING_DAMAGE_THRESHOLD) return null;

  const dmg = Math.round(ke / 40);
  v.hp -= dmg;

  if (v.hp <= 0) {
    destroyVehicle(state, v.id);
    return { tick, type: 'vehicle_destroyed', entityId: v.id, fragmentId: frag.id, kineticEnergy: ke };
  }
  return { tick, type: 'vehicle_damage', entityId: v.id, fragmentId: frag.id, kineticEnergy: ke };
}

function processEmployeeHit(
  emp: Employee,
  state: EmployeeState,
  frag: FragmentData,
  ke: number,
  tick: number,
  damage: DamageState,
): AccidentRecord | null {
  if (ke >= DEATH_THRESHOLD) {
    killEmployee(state, emp.id);
    damage.lawsuitPending = true;
    damage.deathCount++;
    return { tick, type: 'death', entityId: emp.id, fragmentId: frag.id, kineticEnergy: ke };
  }
  if (ke >= INJURY_THRESHOLD) {
    injureEmployee(state, emp.id);
    return { tick, type: 'injury', entityId: emp.id, fragmentId: frag.id, kineticEnergy: ke };
  }
  return null;
}

// ── Helpers ──

function kineticEnergy(massKg: number, velocityMs: number): number {
  return 0.5 * massKg * velocityMs * velocityMs;
}

function isNear(x1: number, z1: number, x2: number, z2: number): boolean {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz) <= HIT_RADIUS;
}

function isNearBuilding(fx: number, fz: number, b: Building): boolean {
  const def = getBuildingDef(b.type, b.tier);
  // Check if fragment is within hit radius of building footprint centre
  const xs = def.footprint.map(([dx]) => dx);
  const zs = def.footprint.map(([, dz]) => dz);
  const sizeX = Math.max(...xs) + 1;
  const sizeZ = Math.max(...zs) + 1;
  const cx = b.x + sizeX / 2;
  const cz = b.z + sizeZ / 2;
  return isNear(fx, fz, cx, cz);
}

export { BUILDING_DAMAGE_THRESHOLD, INJURY_THRESHOLD, DEATH_THRESHOLD, HIT_RADIUS };
