// BlastSimulator2026 — Blast execution pipeline
// Orchestrates: validate → energy → fragmentation → terrain subtraction → results
// Pure function operating on GameState + VoxelGrid, no side effects.

import type { Vec3 } from '../math/Vec3.js';
import { vec3, scale, length as vecLength } from '../math/Vec3.js';
import type { DrillHole } from './DrillPlan.js';
// HoleCharge used via plan.charges values
import type { BlastPlan } from './BlastPlan.js';
import { validateBlastPlan } from './BlastPlan.js';
import {
  calculateInitialVelocity,
  calculateVibrations,
  groupChargesByDelay,
  effectiveHoleEnergy,
  computeInitialEnergy,
  stemmingFactor,
} from './BlastCalc.js';
import {
  buildHoleSeeds,
  clampBoxToGrid,
  createEnergyField,
  computeDistanceToAir,
  indexOf,
  intensityAt,
  overflowAt,
  seedEnergy,
  type BlastBox,
  type EnergyField,
  type EnergySeed,
} from './EnergyPropagation.js';
import { identifyFragmentedVoxels } from './VoxelFragmentation.js';
import { getRock } from '../world/RockCatalog.js';
import { getOre } from '../world/OreCatalog.js';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { getBuildingDef, destroyBuilding, type BuildingState, type Building, type BuildingType } from '../entities/Building.js';
import {
  BLAST_ZONE_RADIUS,
  MAX_FRAGMENTS_PER_VOXEL,
  FRAGMENTS_PER_ENERGY_RATIO,
  OVERSIZED_FRAGMENT_THRESHOLD,
  EXPLOSIVE_ENERGY_SCALE,
  PROJECTION_ENERGY_TO_KINETIC,
  PROJECTION_SPEED_THRESHOLD,
  MAX_PROJECTION_VELOCITY,
  SURFACE_PROXIMITY_DECAY,
  MIN_THROW_FRACTION,
} from '../config/balance.js';

// ── Config ──

/** Default ground factor for vibration. */
const DEFAULT_GROUND_FACTOR = 1.0;

// ── Fragment Data ──

export interface FragmentData {
  id: number;
  position: Vec3;
  volume: number;
  mass: number;
  rockId: string;
  oreDensities: Record<string, number>;
  initialVelocity: Vec3;
  isProjection: boolean;
}

// ── Blast Report ──

export type BlastRating = 'perfect' | 'good' | 'mediocre' | 'bad' | 'catastrophic';

export interface VillageVibration {
  villageId: string;
  position: Vec3;
  vibration: number;
}

/** Information about a building removed by a blast. */
export interface DestroyedBuildingInfo {
  buildingId: number;
  type: BuildingType;
  x: number;
  z: number;
}

/**
 * Emitted when an `explosive_warehouse` with stored explosives is destroyed,
 * indicating a secondary detonation chain should be simulated.
 */
export interface SecondaryBlastEvent {
  buildingId: number;
  x: number;
  z: number;
  explosivesKg: number;
}

export interface BlastRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BlastResult {
  fragments: FragmentData[];
  fragmentCount: number;
  averageFragmentSize: number;
  oversizedFragments: number;
  projectionCount: number;
  maxProjectionSpeed: number;
  vibrationAtVillages: VillageVibration[];
  totalRockVolume: number;
  totalOreValue: number;
  rating: BlastRating;
  crackedVoxels: number;
  clearedVoxels: number;
  clearedRegion: BlastRegion;
  destroyedBuildings: DestroyedBuildingInfo[];
  secondaryBlastEvents: SecondaryBlastEvent[];
}

// ── Village (for vibration targets) ──

export interface VillagePosition {
  id: string;
  position: Vec3;
}

// ── Pipeline ──

/**
 * Execute a blast on the voxel grid.
 * This is the central blast pipeline:
 *   1. Validate plan
 *   2. Calculate blast zone bounding box
 *   3. For each voxel in zone: calculate energy, fragmentation
 *   4. Generate fragments from fractured voxels
 *   5. Subtract fractured voxels from terrain
 *   6. Calculate vibrations at villages
 *   7. Produce BlastResult with rating
 *
 * Mutates the VoxelGrid (clears fractured voxels).
 * Returns null if the plan is invalid.
 */
export function executeBlast(
  plan: BlastPlan,
  grid: VoxelGrid,
  villages: readonly VillagePosition[],
  groundFactor: number = DEFAULT_GROUND_FACTOR,
  buildingState?: BuildingState,
  emitter?: EventEmitter,
): BlastResult | null {
  // 1. Validate
  const errors = validateBlastPlan(plan);
  if (errors.length > 0) return null;

  // 2a. Compute terrain surface Y for each hole so the blast zone and energy
  //     are anchored at the actual surface, not hardcoded y=0.
  const holeSurfaceYs: Record<string, number> = {};
  for (const hole of plan.holes) {
    holeSurfaceYs[hole.id] = computeVoxelColumnSurfaceY(grid, hole.x, hole.z) + 1;
  }

  // 2b. Calculate blast zone bounding box anchored at the surface
  const bbox = calculateBlastZone(plan.holes, holeSurfaceYs);

  const blastCenter = calculateBlastCenter(plan.holes);
  const originY = Math.max(0, ...Object.values(holeSurfaceYs));
  emitter?.emit('blast:started', { originX: blastCenter.x, originY, originZ: blastCenter.z });

  // 3. Propagate the charge energy through the rock, then read off what broke.
  const field = buildBlastEnergyField(plan, grid, bbox, holeSurfaceYs);
  const fragmentation = field ? identifyFragmentedVoxels(field, grid) : null;

  const fragments: FragmentData[] = [];
  let fragmentIdCounter = 0;
  let totalRockVolume = 0;
  let totalOreValue = 0;
  let oversizedFragments = 0;
  const crackedVoxels = fragmentation?.cracked.length ?? 0;
  let clearedVoxels = 0;

  // Track which voxels to clear (defer clearing so the whole pass sees the
  // pre-blast rock, and so the cleared region can be computed in one go).
  const toClear: Array<{ x: number; y: number; z: number }> = [];

  // 4. Turn each broken voxel into fragments.
  //    Fragment shapes and grouped projectiles arrive in later phases of
  //    docs/plans/rock-fragmentation-refactor.md; for now each voxel yields
  //    point fragments whose count follows how hard it was hit.
  if (field && fragmentation) {
    const distToAir = computeDistanceToAir(field);

    for (const { x, y, z } of fragmentation.fragmented) {
      const dominantRockId = grid.dominantRockAt(x, y, z);
      const rock = getRock(dominantRockId);
      if (!rock) continue;

      const point = vec3(x, y, z);
      // How hard this voxel was hit relative to its rock: 1.0 is a clean break,
      // higher means it was pulverised.
      const intensity = intensityAt(field, x, y, z);

      const voxelVolume = VoxelGrid.CELL_SIZE * VoxelGrid.CELL_SIZE * VoxelGrid.CELL_SIZE;
      const fragCount = Math.min(
        MAX_FRAGMENTS_PER_VOXEL,
        Math.max(1, Math.round(FRAGMENTS_PER_ENERGY_RATIO * intensity)),
      );
      const mass = (rock.density * voxelVolume) / fragCount;
      const ores = grid.oresAt(x, y, z) ?? {};

      const nearestHole = findNearestHole(point, plan.holes);
      const nearestSurfaceY = holeSurfaceYs[nearestHole.id] ?? 0;
      const holePos = vec3(nearestHole.x, nearestSurfaceY - nearestHole.depth / 2, nearestHole.z);

      // Three things decide whether rock is thrown rather than merely broken.
      //
      // Only energy that left the voxel can move it — what it absorbed went into
      // breaking the rock. Only rock near a free face has anywhere to go; rock
      // confined by its neighbours can do nothing but settle. And stemming is
      // what keeps the gases working on the rock instead of venting up the hole,
      // so an under-stemmed hole is what turns a blast into flyrock.
      const nearestCharge = plan.charges[nearestHole.id];
      const blowout = nearestCharge
        ? 1 - stemmingFactor(nearestCharge.stemmingM, nearestHole.depth)
        : 1;
      // Squared: the penalty for poor stemming should bite sharply, so the gap
      // between a properly stemmed shot and a careless one is a real decision.
      const throwFraction = MIN_THROW_FRACTION + (1 - MIN_THROW_FRACTION) * blowout * blowout;

      const throwEnergy = (overflowAt(field, x, y, z) / fragCount) * throwFraction;
      const confinement = Math.exp(-(distToAir[indexOf(field, x, y, z)] ?? 0) * SURFACE_PROXIMITY_DECAY);
      const speedScale = Math.sqrt(PROJECTION_ENERGY_TO_KINETIC) * confinement;

      for (let i = 0; i < fragCount; i++) {
        const raw = calculateInitialVelocity(point, holePos, throwEnergy, mass);
        const vel = clampSpeed(scale(raw, speedScale), MAX_PROJECTION_VELOCITY);
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

        fragments.push({
          id: fragmentIdCounter++,
          position: point,
          volume: voxelVolume / fragCount,
          mass,
          rockId: dominantRockId,
          oreDensities: { ...ores },
          initialVelocity: vel,
          isProjection: speed > PROJECTION_SPEED_THRESHOLD,
        });
      }

      if (voxelVolume / fragCount > OVERSIZED_FRAGMENT_THRESHOLD) {
        oversizedFragments += fragCount;
      }

      totalOreValue += calculateOreValue(ores, VoxelGrid.CELL_SIZE);
      totalRockVolume += voxelVolume;

      toClear.push({ x, y, z });
      clearedVoxels++;
    }
  }

  // 4b. Compute cleared region AABB from toClear for navmesh dirty-region update
  const clearedRegion: BlastRegion = toClear.length === 0
    ? { minX: 0, maxX: -1, minZ: 0, maxZ: -1 }
    : toClear.reduce(
        (acc, { x, z }) => ({
          minX: Math.min(acc.minX, x),
          maxX: Math.max(acc.maxX, x),
          minZ: Math.min(acc.minZ, z),
          maxZ: Math.max(acc.maxZ, z),
        }),
        { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
      );

  // 5. Subtract fractured voxels from terrain
  for (const { x, y, z } of toClear) {
    grid.clearVoxel(x, y, z);
  }

  // 5a. The crater is whatever the energy actually broke. There used to be a
  //     forced excavation pass here that carved a fixed-radius pit around the
  //     blast centre so *something* visible happened; propagation now fractures
  //     the surface on its own, and faking it would hide undercharged plans
  //     from the player instead of letting them read the result.

  // 5c. Terrain changed — tell subscribers (renderer remesh, navgrid patch
  //     callers already use clearedRegion directly) the exact voxel AABB that
  //     changed, covering both the fracture-pass clears and anything the
  //     crater pass added afterward.
  if (toClear.length > 0) {
    const updatedRegion = toClear.reduce(
      (acc, { x, y, z }) => ({
        minX: Math.min(acc.minX, x), maxX: Math.max(acc.maxX, x),
        minY: Math.min(acc.minY, y), maxY: Math.max(acc.maxY, y),
        minZ: Math.min(acc.minZ, z), maxZ: Math.max(acc.maxZ, z),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
    );
    emitter?.emit('terrain:updated', { region: updatedRegion });
  }

  // 5b. Check for building destruction: if any cleared voxel's (x, z) falls
  //     within a building's footprint, the building is destroyed.
  const destroyedBuildings: DestroyedBuildingInfo[] = [];
  const secondaryBlastEvents: SecondaryBlastEvent[] = [];
  if (buildingState && toClear.length > 0) {
    // Build a set of unique (x, z) pairs from cleared voxels for fast lookup.
    const clearedXZSet = new Set<string>();
    for (const { x, z } of toClear) {
      clearedXZSet.add(`${x},${z}`);
    }

    // Check each building; collect those hit by the blast.
    const toDestroy: Building[] = [];
    for (const building of buildingState.buildings) {
      const def = getBuildingDef(building.type, building.tier);
      let hit = false;
      for (const [dx, dz] of def.footprint) {
        if (clearedXZSet.has(`${building.x + dx},${building.z + dz}`)) {
          hit = true;
          break;
        }
      }
      if (hit) toDestroy.push(building);
    }

    for (const building of toDestroy) {
      destroyedBuildings.push({
        buildingId: building.id,
        type: building.type,
        x: building.x,
        z: building.z,
      });
      // Secondary blast for explosive_warehouse with stored explosives.
      if (building.type === 'explosive_warehouse' && (building.storedExplosivesKg ?? 0) > 0) {
        secondaryBlastEvents.push({
          buildingId: building.id,
          x: building.x,
          z: building.z,
          explosivesKg: building.storedExplosivesKg!,
        });
      }
      destroyBuilding(buildingState, building.id);
    }
  }

  // 6. Calculate vibrations at villages
  // Apply per-explosive vibrationMod: average across all charged holes weighted equally.
  let vibModSum = 0;
  let vibModCount = 0;
  for (const hole of plan.holes) {
    const charge = plan.charges[hole.id];
    if (!charge) continue;
    const energy = effectiveHoleEnergy(charge, hole.depth, false, false);
    vibModSum += energy.vibrationMod;
    vibModCount++;
  }
  const effectiveGroundFactor = groundFactor * (vibModCount > 0 ? vibModSum / vibModCount : 1);

  const chargePerDelay = groupChargesByDelay(plan.holes, plan.charges, plan.delays);
  const vibrationAtVillages: VillageVibration[] = villages.map(v => {
    const dx = v.position.x - blastCenter.x;
    const dz = v.position.z - blastCenter.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    return {
      villageId: v.id,
      position: v.position,
      vibration: calculateVibrations(chargePerDelay, Math.max(distance, 1), effectiveGroundFactor),
    };
  });

  // 7. Compute stats and rating
  const projectionCount = fragments.filter(f => f.isProjection).length;
  const maxProjectionSpeed = fragments.reduce((max, f) => {
    const speed = Math.sqrt(
      f.initialVelocity.x ** 2 + f.initialVelocity.y ** 2 + f.initialVelocity.z ** 2,
    );
    return f.isProjection ? Math.max(max, speed) : max;
  }, 0);

  const totalVolume = fragments.reduce((s, f) => s + f.volume, 0);
  const avgSize = fragments.length > 0 ? totalVolume / fragments.length : 0;

  const maxVibration = vibrationAtVillages.reduce((m, v) => Math.max(m, v.vibration), 0);
  const rating = calculateRating(projectionCount, oversizedFragments, clearedVoxels, maxVibration, fragments.length);

  emitter?.emit('blast:ended', undefined);

  return {
    fragments,
    fragmentCount: fragments.length,
    averageFragmentSize: avgSize,
    oversizedFragments,
    projectionCount,
    maxProjectionSpeed,
    vibrationAtVillages,
    totalRockVolume,
    totalOreValue,
    rating,
    crackedVoxels,
    clearedVoxels,
    clearedRegion,
    destroyedBuildings,
    secondaryBlastEvents,
  };
}

// ── Helpers ──

/** Shorten a velocity to `maxSpeed` without changing its direction. */
function clampSpeed(v: Vec3, maxSpeed: number): Vec3 {
  const speed = vecLength(v);
  return speed > maxSpeed ? scale(v, maxSpeed / speed) : v;
}

/**
 * Build the energy field for a plan and run propagation over it.
 *
 * Returns null when the blast zone falls entirely outside the ground the site
 * owns — nothing to propagate through.
 */
function buildBlastEnergyField(
  plan: BlastPlan,
  grid: VoxelGrid,
  bbox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  holeSurfaceYs: Record<string, number>,
): EnergyField | null {
  // calculateBlastZone reports an inclusive box; the field's is half-open.
  const requested: BlastBox = {
    minX: bbox.minX, minY: bbox.minY, minZ: bbox.minZ,
    maxX: bbox.maxX + 1, maxY: bbox.maxY + 1, maxZ: bbox.maxZ + 1,
  };
  const box = clampBoxToGrid(requested, grid);
  if (!box) return null;

  const seeds: EnergySeed[] = [];
  for (const hole of plan.holes) {
    const charge = plan.charges[hole.id];
    if (!charge) continue;
    const energy = computeInitialEnergy(charge, hole.depth) * EXPLOSIVE_ENERGY_SCALE;
    if (energy <= 0) continue;
    seeds.push(...buildHoleSeeds(
      holeSurfaceYs[hole.id] ?? 0,
      hole.depth,
      charge.amountKg,
      energy,
      Math.floor(hole.x),
      Math.floor(hole.z),
      box.minY,
    ));
  }

  const field = createEnergyField(grid, box);
  seedEnergy(field, seeds);
  return field;
}

function calculateBlastZone(
  holes: readonly DrillHole[],
  holeSurfaceYs: Record<string, number>,
): {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
} {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let maxSurfaceY = 0;
  let maxDepth = 0;

  for (const hole of holes) {
    minX = Math.min(minX, hole.x);
    maxX = Math.max(maxX, hole.x);
    minZ = Math.min(minZ, hole.z);
    maxZ = Math.max(maxZ, hole.z);
    maxSurfaceY = Math.max(maxSurfaceY, holeSurfaceYs[hole.id] ?? 0);
    maxDepth = Math.max(maxDepth, hole.depth);
  }

  return {
    minX: Math.floor(minX - BLAST_ZONE_RADIUS),
    maxX: Math.ceil(maxX + BLAST_ZONE_RADIUS),
    // Y range: from (surface - depth - radius) up to (surface + radius)
    minY: Math.max(0, Math.floor(maxSurfaceY - maxDepth - BLAST_ZONE_RADIUS)),
    maxY: Math.ceil(maxSurfaceY + BLAST_ZONE_RADIUS),
    minZ: Math.floor(minZ - BLAST_ZONE_RADIUS),
    maxZ: Math.ceil(maxZ + BLAST_ZONE_RADIUS),
  };
}

function findNearestHole(point: Vec3, holes: readonly DrillHole[]): DrillHole {
  let nearest = holes[0]!;
  let minDist = Infinity;
  for (const hole of holes) {
    const dx = point.x - hole.x;
    const dz = point.z - hole.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < minDist) {
      minDist = d2;
      nearest = hole;
    }
  }
  return nearest;
}

function calculateBlastCenter(holes: readonly DrillHole[]): { x: number; z: number } {
  let sx = 0, sz = 0;
  for (const hole of holes) {
    sx += hole.x;
    sz += hole.z;
  }
  return { x: sx / holes.length, z: sz / holes.length };
}

function calculateOreValue(oreDensities: Record<string, number>, voxelSize: number): number {
  const volume = voxelSize * voxelSize * voxelSize;
  let value = 0;
  for (const [oreId, density] of Object.entries(oreDensities)) {
    const ore = getOre(oreId);
    if (ore && density > 0) {
      // Ore mass = volume × density_fraction × arbitrary ore_density (assume 2500 kg/m³ for ore)
      // Real ore density: 2500–4000 kg/m³ (iron ore ~3500)
      const oreMass = volume * density * 2500;
      value += oreMass * ore.valuePerKg;
    }
  }
  return value;
}

/**
 * Determine blast rating. Per BLAST_SYSTEM.md §8.1:
 * Rating is primarily safety-driven (projections, vibrations).
 * Fragmentation quality is secondary — real blasts always produce a size distribution.
 */
function calculateRating(
  projections: number,
  _oversized: number,
  cleared: number,
  maxVibration: number,
  totalFragments: number,
): BlastRating {
  if (cleared === 0) return 'bad'; // Nothing blasted = bad plan

  const projRatio = totalFragments > 0 ? projections / totalFragments : 0;

  // Catastrophic: mass projections or extreme vibration
  if (projRatio > 0.10 || maxVibration > 50) return 'catastrophic';
  // Bad: significant projections or moderate vibration
  if (projRatio > 0.03 || maxVibration > 20) return 'bad';
  // Mediocre: some projections
  if (projections > 3) return 'mediocre';
  // Good: 1-3 projections, some fragmentation happened
  if (projections > 0) return 'good';
  // Perfect: no projections, no vibration issues, rock was cleared
  return 'perfect';
}
