// BlastSimulator2026 — Blast calculation engine
// Pure math functions for energy, fragmentation, velocity, free face, vibration.
// Every formula from BLAST_SYSTEM.md is implemented here.

import type { Vec3 } from '../math/Vec3.js';
import { vec3, sub, normalize, scale, length as vecLength } from '../math/Vec3.js';
import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import type { VoxelData, VoxelGrid } from '../world/VoxelGrid.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { getRock } from '../world/RockCatalog.js';
import { BLAST_ENERGY_EPSILON, MAX_FRAGMENTS_PER_VOXEL, PROJECTION_SPEED_THRESHOLD, MAX_PROPAGATION_ITERATIONS, FRAGMENTATION_MULTIPLIER } from '../config/balance.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle } from '../entities/Vehicle.js';
import type { BuildingState } from '../entities/Building.js';
import { getBuildingDef } from '../entities/Building.js';
import { Random } from '../math/Random.js';

// --------------------------------------------------------
// § 1: Voxel Threshold
// --------------------------------------------------------

export function computeThreshold(voxel: VoxelData): number {
  const { rocks } = voxel.composition;
  if (rocks.length === 0) return 0;
  let sum = 0;
  for (const rock of rocks) {
    const rockDef = getRock(rock.rockId);
    if (rockDef) sum += rock.coefficient * rockDef.energyAbsorption;
  }
  return sum;
}

// --------------------------------------------------------
// § 2: Energy Calculation
// --------------------------------------------------------

const EPSILON = BLAST_ENERGY_EPSILON;

export function calculateHoleEnergy(charge: HoleCharge): number {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return 0;
  return explosive.energyPerKg * charge.amountKg;
}

export function computeInitialEnergy(charge: HoleCharge, holeDepth: number): number {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return 0;
  return explosive.energyPerKg * charge.amountKg * stemmingEfficiency(charge.stemmingM, holeDepth);
}

export function stemmingFactor(stemmingHeight: number, holeDepth: number): number {
  if (holeDepth <= 0) return 0;
  return Math.max(0, Math.min(1, stemmingHeight / (holeDepth * 0.3)));
}

export function stemmingEfficiency(stemmingHeight: number, holeDepth: number): number {
  return 0.5 + 0.5 * stemmingFactor(stemmingHeight, holeDepth);
}

export function waterEffect(isFlooded: boolean, waterSensitive: boolean, hasTubing: boolean): number {
  if (isFlooded && waterSensitive && !hasTubing) return 0.1;
  return 1.0;
}

export function effectiveHoleEnergy(
  charge: HoleCharge, holeDepth: number, isFlooded: boolean, hasTubing: boolean,
): { downward: number; upward: number; vibrationMod: number } {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return { downward: 0, upward: 0, vibrationMod: 1 };
  const rawE = explosive.energyPerKg * charge.amountKg;
  const sf = stemmingFactor(charge.stemmingM, holeDepth);
  const wf = waterEffect(isFlooded, explosive.waterSensitive, hasTubing);
  return {
    downward: rawE * (0.5 + 0.5 * sf) * wf,
    upward: rawE * (1 - sf) * 0.7 * wf * explosive.projectionRiskMod,
    vibrationMod: explosive.vibrationMod,
  };
}

export function calculateEnergyField(
  point: Vec3, holes: readonly DrillHole[], charges: Record<string, HoleCharge>,
  holeDepths: Record<string, number>, holeSurfaceYs?: Record<string, number>,
): number {
  let total = 0;
  for (const hole of holes) {
    const charge = charges[hole.id];
    if (!charge) continue;
    const energy = effectiveHoleEnergy(charge, holeDepths[hole.id] ?? hole.depth, false, false);
    const surfaceY = holeSurfaceYs?.[hole.id] ?? 0;
    const depth = holeDepths[hole.id] ?? hole.depth;
    const midPos = vec3(hole.x, surfaceY - depth / 2, hole.z);
    total += energy.downward / (distSquared(point, midPos) + EPSILON);
    if (energy.upward > 0) {
      total += energy.upward / (distSquared(point, vec3(hole.x, surfaceY, hole.z)) + EPSILON);
    }
  }
  return total;
}

// --------------------------------------------------------
// § 3: Fragmentation
// --------------------------------------------------------

export type FractureResult = 'fractured' | 'cracked' | 'unaffected';

export interface FragmentationResult {
  result: FractureResult;
  fragmentSizeFraction: number;
  isProjection: boolean;
  energyRatio: number;
}

export function calculateFragmentation(energy: number, fractureThreshold: number): FragmentationResult {
  if (fractureThreshold <= 0) return { result: 'unaffected', fragmentSizeFraction: 1, isProjection: false, energyRatio: 0 };
  const ratio = energy / fractureThreshold;
  if (ratio < 0.5) return { result: 'unaffected', fragmentSizeFraction: 1, isProjection: false, energyRatio: ratio };
  if (ratio < 1.0) return { result: 'cracked', fragmentSizeFraction: 1, isProjection: false, energyRatio: ratio };
  if (ratio < 2.0) return { result: 'fractured', fragmentSizeFraction: 1.0 - 0.7 * (ratio - 1.0), isProjection: false, energyRatio: ratio };
  if (ratio < 4.0) return { result: 'fractured', fragmentSizeFraction: 0.3 - 0.2 * (ratio - 2.0) / 2.0, isProjection: false, energyRatio: ratio };
  return { result: 'fractured', fragmentSizeFraction: 0.05, isProjection: true, energyRatio: ratio };
}

export function calculateFragmentCount(voxelVolume: number, fragmentSize: number): number {
  if (fragmentSize <= 0) return 1;
  return Math.min(MAX_FRAGMENTS_PER_VOXEL, Math.max(1, Math.ceil(voxelVolume / (fragmentSize * fragmentSize * fragmentSize))));
}

// --------------------------------------------------------
// § 5.1: Initial Velocity
// --------------------------------------------------------

export function calculateInitialVelocity(fragmentPos: Vec3, nearestHolePos: Vec3, energy: number, mass: number): Vec3 {
  const dir = sub(fragmentPos, nearestHolePos);
  const len = vecLength(dir);
  const normalized = len > 0 ? normalize(dir) : vec3(0, 1, 0);
  return scale(normalized, Math.sqrt(Math.max(0, 2 * energy / Math.max(mass, 0.01))));
}

export function classifyProjection(speed: number, energyRatio: number): boolean {
  return speed > PROJECTION_SPEED_THRESHOLD || energyRatio >= 4.0;
}

// --------------------------------------------------------
// § 6.2: Free Face
// --------------------------------------------------------

export function calculateFreeFace(
  holeX: number, holeZ: number, holeDepth: number,
  isVoxelEmpty: (x: number, y: number, z: number) => boolean,
): number {
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  let openCount = 0, totalChecked = 0;
  for (let y = 0; y < holeDepth; y++) {
    for (const [dx, dz] of directions) {
      totalChecked++;
      if (isVoxelEmpty(holeX + dx, y, holeZ + dz)) openCount++;
    }
  }
  return totalChecked > 0 ? openCount / totalChecked : 0;
}

// --------------------------------------------------------
// § 7: Vibration
// --------------------------------------------------------

export function calculateVibrations(chargePerDelay: number[], distance: number, groundFactor: number): number {
  if (distance <= 0) return Infinity;
  if (chargePerDelay.length === 0) return 0;
  return Math.pow(Math.max(...chargePerDelay), 0.7) / Math.pow(distance, 1.5) * groundFactor;
}

export function groupChargesByDelay(
  holes: readonly DrillHole[], charges: Record<string, HoleCharge>, delays: Record<string, number>,
): number[] {
  const delayGroups = new Map<number, number>();
  for (const hole of holes) {
    const charge = charges[hole.id];
    const delay = delays[hole.id];
    if (charge !== undefined && delay !== undefined) {
      delayGroups.set(delay, (delayGroups.get(delay) ?? 0) + charge.amountKg);
    }
  }
  return [...delayGroups.values()];
}

// --------------------------------------------------------
// § 5.5: Energy Propagation
// --------------------------------------------------------

export interface PropagationResult {
  effectiveEnergy: Map<string, number>;
  generatedOverflow: Map<string, number>;
}

const PROPAGATION_EPSILON = 1e-12;
const NEIGHBOR_OFFSETS: readonly [number, number, number][] = [
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
];

function isAirVoxel(voxel: VoxelData): boolean {
  return voxel.density <= 0 || voxel.composition.rocks.length === 0;
}

export function propagateEnergy(grid: VoxelGrid, initial: Map<string, number>): PropagationResult {
  const effectiveEnergy = new Map<string, number>();
  const generatedOverflow = new Map<string, number>();
  const overflow = new Map<string, number>();

  for (const [key, rawEnergy] of initial) {
    let energy = typeof rawEnergy === 'number' && Number.isFinite(rawEnergy) ? rawEnergy : 0;
    if (energy < 0) energy = 0;
    if (energy <= PROPAGATION_EPSILON) continue;
    const coords = parseKey(key);
    if (!coords || !grid.isInBounds(coords[0], coords[1], coords[2])) continue;
    overflow.set(key, energy);
  }

  if (overflow.size === 0) return { effectiveEnergy, generatedOverflow };

  let currentOverflow = overflow;
  for (let iter = 0; iter < MAX_PROPAGATION_ITERATIONS && currentOverflow.size > 0; iter++) {
    const nextOverflow = new Map<string, number>();
    let anyChange = false;
    for (const [key, incoming] of currentOverflow) {
      if (incoming <= PROPAGATION_EPSILON) continue;
      const coords = parseKey(key);
      if (!coords) continue;
      const [x, y, z] = coords;
      const voxel = grid.getVoxel(x, y, z);
      if (!voxel) continue;
      const threshold = computeThreshold(voxel);
      const curEff = effectiveEnergy.get(key) ?? 0;
      const absorbed = Math.min(incoming, Math.max(0, threshold - curEff));
      if (absorbed > 0) effectiveEnergy.set(key, curEff + absorbed);
      const leftover = incoming - absorbed;
      if (leftover > PROPAGATION_EPSILON) {
        generatedOverflow.set(key, (generatedOverflow.get(key) ?? 0) + leftover);
        const valid: string[] = [];
        for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
          const nk = `${x+dx},${y+dy},${z+dz}`;
          if (!grid.isInBounds(x+dx, y+dy, z+dz)) continue;
          const nv = grid.getVoxel(x+dx, y+dy, z+dz);
          if (!nv || isAirVoxel(nv)) continue;
          if ((effectiveEnergy.get(nk) ?? 0) < computeThreshold(nv)) valid.push(nk);
        }
        if (valid.length > 0) {
          const share = leftover / valid.length;
          for (const nk of valid) nextOverflow.set(nk, (nextOverflow.get(nk) ?? 0) + share);
          anyChange = true;
        }
      }
    }
    currentOverflow = nextOverflow;
    if (!anyChange) break;
  }
  return { effectiveEnergy, generatedOverflow };
}

// --------------------------------------------------------
// § 5.6: Identify Fragmented Voxels
// --------------------------------------------------------

export function identifyFragmentedVoxels(grid: VoxelGrid, result: PropagationResult): Set<string> {
  const fragmented = new Set<string>();
  for (const [key, energy] of result.effectiveEnergy) {
    const coords = parseKey(key);
    if (!coords || !grid.isInBounds(...coords)) continue;
    const voxel = grid.getVoxel(coords[0], coords[1], coords[2]);
    if (!voxel || isAirVoxel(voxel)) continue;
    if (energy >= FRAGMENTATION_MULTIPLIER * computeThreshold(voxel)) fragmented.add(key);
  }

  const visited = new Set<string>();
  const queue: [number, number, number][] = [];
  const isSNF = (x: number, y: number, z: number): boolean => {
    if (!grid.isInBounds(x, y, z)) return false;
    if (fragmented.has(`${x},${y},${z}`)) return false;
    const v = grid.getVoxel(x, y, z);
    return v !== undefined && !isAirVoxel(v);
  };
  const seed = (x: number, y: number, z: number): void => {
    const k = `${x},${y},${z}`;
    if (isSNF(x, y, z) && !visited.has(k)) { visited.add(k); queue.push([x, y, z]); }
  };

  for (let y = 0; y < grid.sizeY; y++) for (let z = 0; z < grid.sizeZ; z++) { seed(0, y, z); seed(grid.sizeX - 1, y, z); }
  for (let x = 0; x < grid.sizeX; x++) for (let z = 0; z < grid.sizeZ; z++) { seed(x, 0, z); seed(x, grid.sizeY - 1, z); }
  for (let x = 0; x < grid.sizeX; x++) for (let y = 0; y < grid.sizeY; y++) { seed(x, y, 0); seed(x, y, grid.sizeZ - 1); }

  let head = 0;
  while (head < queue.length) {
    const [cx, cy, cz] = queue[head++]!;
    for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
      const nk = `${cx+dx},${cy+dy},${cz+dz}`;
      if (!visited.has(nk) && isSNF(cx+dx, cy+dy, cz+dz)) { visited.add(nk); queue.push([cx+dx, cy+dy, cz+dz]); }
    }
  }

  for (let z = 0; z < grid.sizeZ; z++)
    for (let y = 0; y < grid.sizeY; y++)
      for (let x = 0; x < grid.sizeX; x++) {
        const k = `${x},${y},${z}`;
        if (!fragmented.has(k) && !visited.has(k)) {
          const v = grid.getVoxel(x, y, z);
          if (v && !isAirVoxel(v)) fragmented.add(k);
        }
      }
  return fragmented;
}

// --------------------------------------------------------
// § 5.7: Entity Damage from Blast
// --------------------------------------------------------

export interface BlastEntityDamageResult {
  killedEmployeeIds: number[];
  destroyedVehicleIds: number[];
  destroyedBuildingIds: number[];
  occupantCasualties: number;
  totalDeaths: number;
}

export function computeBlastEntityDamage(
  fragmentedVoxels: Set<string>,
  effectiveEnergy: Map<string, number>,
  grid: VoxelGrid,
  employees: readonly Employee[],
  vehicles: readonly Vehicle[],
  buildings: BuildingState,
  rng: Random,
): BlastEntityDamageResult {
  const killedSet = new Set<number>();
  const destroyedVehicleIds: number[] = [];
  const destroyedBuildingIds: number[] = [];
  let occupantCasualties = 0;

  const hasFrag = (x: number, z: number): boolean => {
    const ix = Math.floor(x), iz = Math.floor(z);
    for (let y = 0; y < grid.sizeY; y++) {
      if (fragmentedVoxels.has(`${ix},${y},${iz}`)) return true;
    }
    return false;
  };
  const isSolid = (x: number, y: number, z: number): boolean => {
    const v = grid.getVoxel(x, y, z);
    return v !== undefined && v.density > 0 && v.composition.rocks.length > 0;
  };

  for (const emp of employees) {
    if (emp.alive && hasFrag(emp.x, emp.z)) killedSet.add(emp.id);
  }
  for (const veh of vehicles) {
    if (hasFrag(veh.x, veh.z)) destroyedVehicleIds.push(veh.id);
  }

  for (const building of buildings.buildings) {
    const def = getBuildingDef(building.type, building.tier);
    let totalE = 0;
    for (const [dx, dz] of def.footprint) {
      const bx = building.x + dx, bz = building.z + dz;
      if (!grid.isInBounds(bx, 0, bz)) continue;
      for (let y = grid.sizeY - 1; y >= 0; y--) {
        if (isSolid(bx, y, bz)) {
          const e = effectiveEnergy.get(`${bx},${y},${bz}`);
          if (e !== undefined) totalE += e;
          break;
        }
      }
    }
    if (def.structuralResistance <= 0 || totalE > def.structuralResistance) {
      destroyedBuildingIds.push(building.id);
      if (def.structuralResistance > 0) {
        const dp = Math.max(0.30, Math.min(1.00, (totalE / def.structuralResistance - 1.0) * 0.5));
        for (const emp of employees) {
          if (!emp.alive || killedSet.has(emp.id)) continue;
          if (def.footprint.some(([dx, dz]) => Math.floor(emp.x) === building.x + dx && Math.floor(emp.z) === building.z + dz)) {
            if (rng.chance(dp)) { killedSet.add(emp.id); occupantCasualties++; }
          }
        }
      }
    }
  }

  const killedEmployeeIds = [...killedSet];
  return { killedEmployeeIds, destroyedVehicleIds, destroyedBuildingIds, occupantCasualties, totalDeaths: killedEmployeeIds.length + occupantCasualties };
}

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------

function parseKey(key: string): [number, number, number] | null {
  const parts = key.split(',');
  if (parts.length !== 3) return null;
  const x = parseInt(parts[0]!, 10), y = parseInt(parts[1]!, 10), z = parseInt(parts[2]!, 10);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
  return [x, y, z];
}

function distSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export { PROJECTION_SPEED_THRESHOLD };
export { isOversized, fragmentBoulder, resetBoulderFragIds, OVERSIZED_FRAGMENT_THRESHOLD, type Boulder, type FragmentBoulderResult } from './BoulderFragmentation.js';
