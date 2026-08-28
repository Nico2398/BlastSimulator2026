// BlastSimulator2026 — Damage and casualty system
// Processes fragment impacts on buildings, vehicles, and employees.
// Kinetic energy = 0.5 * mass * velocity² (real physics).

import type { FragmentData } from '../mining/BlastExecution.js';
import { length } from '../math/Vec3.js';
import type { BuildingState, Building } from './Building.js';
import { getBuildingDef, getDefSize, destroyBuilding } from './Building.js';
import type { VehicleState, Vehicle } from './Vehicle.js';
import { destroyVehicle } from './Vehicle.js';
import type { EmployeeState, Employee } from './Employee.js';
import { injureEmployee, killEmployee } from './Employee.js';
import { BLAST_DANGER_MARGIN_M } from '../config/balance.js';
import { isInZone, type ZoneBounds } from './Zone.js';

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
  type: 'building_damage' | 'building_destroyed' | 'vehicle_damage' | 'vehicle_destroyed' | 'injury' | 'death' | 'seismic_damage' | 'seismic_destroyed';
  entityId: number;
  fragmentId: number;
  kineticEnergy: number;
  /**
   * Raw building/vehicle type id (e.g. 'living_quarters', 'dumpster'), snapshotted
   * at the moment of the hit. destroyBuilding/destroyVehicle splice the entity out
   * of its array, so a later live lookup by entityId can't recover a name for the
   * *_destroyed variants — mirrors DestroyedBuildingInfo's snapshot in BlastExecution.ts.
   * Unset for injury/death (employees stay in their array with alive:false, so a live
   * lookup always works) and for the original seismic_* records predating this field.
   */
  entityLabel?: string;
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
 *
 * `dangerZone`, when given, bounds who can be hit at all — a fragment's real
 * flyrock trajectory can land it well past computeDangerZone's padded box, and
 * an entity that is clearly outside that box must not take a hit just because
 * it happens to be near where a stray fragment came down (#557 audit). Passed
 * null by callers with no zone to check against (e.g. unit tests exercising
 * pure distance falloff), which disables the zone gate entirely.
 */
export function processProjections(
  projections: FragmentData[],
  buildings: BuildingState,
  vehicles: VehicleState,
  employees: EmployeeState,
  damage: DamageState,
  tick: number,
  dangerZone: ZoneBounds | null = null,
): AccidentRecord[] {
  const newAccidents: AccidentRecord[] = [];
  const inZone = (x: number, z: number): boolean => dangerZone === null || isInZone(x, z, dangerZone);

  for (const frag of projections) {
    if (!frag.isProjection) continue;

    const ke = kineticEnergy(frag.mass, length(frag.initialVelocity));
    const fx = frag.position.x;
    const fz = frag.position.z;

    // Check buildings — an exact hit (within HIT_RADIUS) uses the fragment's
    // full kinetic energy; a near miss out to BLAST_DANGER_MARGIN_M still
    // hits, at an inverse-square-attenuated energy, rather than being ignored
    // outright the instant it's a fraction of a metre past the exact radius
    // (#557 audit — debris was only ever hitting something dead-on). Either
    // way the entity itself must be inside the danger zone first.
    for (const b of [...buildings.buildings]) {
      const { cx, cz } = buildingCenter(b);
      if (!inZone(cx, cz)) continue;
      const dist = distanceBetween(fx, fz, cx, cz);
      const effectiveKe = keAtDistance(ke, dist);
      if (effectiveKe === null) continue;
      const acc = processBuildingHit(b, buildings, frag, effectiveKe, tick);
      if (acc) newAccidents.push(acc);
    }

    // Check vehicles
    for (const v of [...vehicles.vehicles]) {
      if (!inZone(v.x, v.z)) continue;
      const dist = distanceBetween(fx, fz, v.x, v.z);
      const effectiveKe = keAtDistance(ke, dist);
      if (effectiveKe === null) continue;
      const acc = processVehicleHit(v, vehicles, frag, effectiveKe, tick);
      if (acc) newAccidents.push(acc);
    }

    // Check employees
    for (const emp of employees.employees) {
      if (!emp.alive || emp.injured) continue;
      if (!inZone(emp.x, emp.z)) continue;
      const dist = distanceBetween(fx, fz, emp.x, emp.z);
      const effectiveKe = keAtDistance(ke, dist);
      if (effectiveKe === null) continue;
      const acc = processEmployeeHit(emp, employees, frag, effectiveKe, tick, damage);
      if (acc) newAccidents.push(acc);
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
  const entityLabel = b.type;
  b.hp -= dmg;

  if (b.hp <= 0) {
    destroyBuilding(state, b.id);
    return { tick, type: 'building_destroyed', entityId: b.id, fragmentId: frag.id, kineticEnergy: ke, entityLabel };
  }
  return { tick, type: 'building_damage', entityId: b.id, fragmentId: frag.id, kineticEnergy: ke, entityLabel };
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
  const entityLabel = v.type;
  v.hp -= dmg;

  if (v.hp <= 0) {
    destroyVehicle(state, v.id);
    return { tick, type: 'vehicle_destroyed', entityId: v.id, fragmentId: frag.id, kineticEnergy: ke, entityLabel };
  }
  return { tick, type: 'vehicle_damage', entityId: v.id, fragmentId: frag.id, kineticEnergy: ke, entityLabel };
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

function distanceBetween(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

function buildingCenter(b: Building): { cx: number; cz: number } {
  const def = getBuildingDef(b.type, b.tier);
  const { sizeX, sizeZ } = getDefSize(def);
  return { cx: b.x + sizeX / 2, cz: b.z + sizeZ / 2 };
}

/**
 * Kinetic energy a fragment landing `distance` away from an entity actually
 * delivers to it, or null when the entity is out of range entirely.
 * Within HIT_RADIUS: full `ke` (the pre-existing exact-hit behaviour,
 * unchanged). Beyond HIT_RADIUS but within BLAST_DANGER_MARGIN_M: inverse-
 * square falloff (`ke * (HIT_RADIUS / distance)²`), which saturates to full
 * `ke` exactly at distance === HIT_RADIUS so the two branches agree at the
 * boundary. Beyond BLAST_DANGER_MARGIN_M: null — no hit (#557 audit: closes
 * the gap where debris only ever hit something standing dead-on).
 */
function keAtDistance(ke: number, distance: number): number | null {
  if (distance <= HIT_RADIUS) return ke;
  if (distance > BLAST_DANGER_MARGIN_M) return null;
  return ke * (HIT_RADIUS / distance) ** 2;
}

export { BUILDING_DAMAGE_THRESHOLD, INJURY_THRESHOLD, DEATH_THRESHOLD, HIT_RADIUS };
