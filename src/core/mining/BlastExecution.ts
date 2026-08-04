// BlastSimulator2026 — Blast execution pipeline
// Orchestrates: validate → energy → fragmentation → terrain subtraction → results
// Pure function operating on GameState + VoxelGrid, no side effects.

import type { Vec3 } from '../math/Vec3.js';
import { length as vecLength } from '../math/Vec3.js';
import type { DrillHole } from './DrillPlan.js';
// HoleCharge used via plan.charges values
import type { BlastPlan } from './BlastPlan.js';
import { validateBlastPlan } from './BlastPlan.js';
import {
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
  seedEnergy,
  type BlastBox,
  type EnergyField,
  type EnergySeed,
} from './EnergyPropagation.js';
import { identifyFragmentedVoxels } from './VoxelFragmentation.js';
import { generateFragments } from './FragmentGeneration.js';
import { computeFragmentVelocity, throwFractionForBlowout } from './FragmentVelocity.js';
import { groupProjectiles } from './ProjectileGrouping.js';
import { resolveFragmentLanding, type FragmentFlight } from './BlastResolve.js';
import { Random } from '../math/Random.js';
import { getOre } from '../world/OreCatalog.js';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { getBuildingDef, destroyBuilding, type BuildingState, type Building, type BuildingType } from '../entities/Building.js';
import {
  BLAST_ZONE_RADIUS,
  OVERSIZED_FRAGMENT_THRESHOLD,
  EXPLOSIVE_ENERGY_SCALE,
  PROJECTION_SPEED_THRESHOLD,
  THROW_DISTANCE_BAD,
  THROW_DISTANCE_CATASTROPHIC,
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
  /** Half-extents of the fragment's bounding box — its rough shape and size. */
  halfExtents: Vec3;
  /** Stable per-fragment randomness for render shape variants and tumble. */
  shapeSeed: number;
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
  /** Furthest any fragment was thrown horizontally, in metres. */
  maxThrowDistance: number;
  /** How many bodies the thrown rock was flown as (see ProjectileGrouping). */
  projectileCount: number;
  /** Each fragment's journey from where it broke to where it settled. */
  flights: FragmentFlight[];
  /** "x,z" of every ground column the blast removed rock from. Anything standing
   *  on one of these was standing on the blast. */
  clearedColumns: string[];
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

  // 4. Carve the broken rock into fragments, then work out what throws each one.
  let flights: FragmentFlight[] = [];
  let projectileCount = 0;
  let maxThrowDistance = 0;

  if (field && fragmentation) {
    const rng = new Random(fragmentSeedFor(plan));
    const { fragments: generated } = generateFragments(fragmentation, field, grid, rng);

    for (const gen of generated) {
      const throwFraction = throwFractionAt(gen.origin, plan);
      const velocity = computeFragmentVelocity(gen.origin, gen.sources, gen.massKg, field, throwFraction);

      fragments.push({
        id: fragmentIdCounter++,
        position: gen.origin,
        volume: gen.volumeM3,
        mass: gen.massKg,
        rockId: gen.rockId,
        // generateFragments builds this record fresh per fragment — take
        // ownership instead of copying it again.
        oreDensities: gen.oreDensities,
        initialVelocity: velocity,
        isProjection: vecLength(velocity) > PROJECTION_SPEED_THRESHOLD,
        halfExtents: gen.halfExtents,
        shapeSeed: gen.shapeSeed,
      });

      if (gen.volumeM3 > OVERSIZED_FRAGMENT_THRESHOLD) oversizedFragments++;
    }

    // Ore value and rock volume come from the ground that was removed, not from
    // the fragments, so they stay right however the rock happened to break.
    for (const { x, y, z } of fragmentation.fragmented) {
      const ores = grid.oresAt(x, y, z);
      if (ores) totalOreValue += calculateOreValue(ores, VoxelGrid.CELL_SIZE);
      totalRockVolume += VoxelGrid.CELL_SIZE ** 3;
      toClear.push({ x, y, z });
      clearedVoxels++;
    }
  }

  // 4b. Clear the rock before working out where the fragments land — they fall
  //     into the hole the blast just made, not onto the ground it removed.
  for (const { x, y, z } of toClear) grid.clearVoxel(x, y, z);

  // 4c. Fly the thrown rock, drop the rest, and stack it all where it lands.
  //     Fragments that travel together are grouped into a capped number of
  //     projectiles, then split back into their own pieces on impact — motion
  //     cost is bounded without the blast's own fragmentation being touched.
  if (fragments.length > 0) {
    const thrown = fragments.filter(f => f.isProjection);
    const projectiles = groupProjectiles(thrown);
    projectileCount = projectiles.length;
    const resolved = resolveFragmentLanding(fragments, projectiles, grid);
    flights = resolved.flights;
    maxThrowDistance = resolved.maxThrowDistance;
  }

  // 4b. Compute cleared region AABB from toClear for navmesh dirty-region
  //     update. One pass with running bounds — a reduce allocating an object
  //     per voxel showed up in the blast's frame budget.
  let regMinX = Infinity, regMaxX = -Infinity, regMinY = Infinity, regMaxY = -Infinity, regMinZ = Infinity, regMaxZ = -Infinity;
  for (const { x, y, z } of toClear) {
    if (x < regMinX) regMinX = x;
    if (x > regMaxX) regMaxX = x;
    if (y < regMinY) regMinY = y;
    if (y > regMaxY) regMaxY = y;
    if (z < regMinZ) regMinZ = z;
    if (z > regMaxZ) regMaxZ = z;
  }
  const clearedRegion: BlastRegion = toClear.length === 0
    ? { minX: 0, maxX: -1, minZ: 0, maxZ: -1 }
    : { minX: regMinX, maxX: regMaxX, minZ: regMinZ, maxZ: regMaxZ };

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
    emitter?.emit('terrain:updated', {
      region: { minX: regMinX, maxX: regMaxX, minY: regMinY, maxY: regMaxY, minZ: regMinZ, maxZ: regMaxZ },
    });
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
  const rating = calculateRating(projectionCount, maxThrowDistance, clearedVoxels, maxVibration, fragments.length);

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
    clearedColumns: [...new Set(toClear.map(c => `${c.x},${c.z}`))],
    maxThrowDistance,
    projectileCount,
    flights,
  };
}

// ── Helpers ──

/**
 * Seed for a blast's fragment randomness, derived from the plan itself so the
 * same plan on the same terrain always breaks the same way.
 */
function fragmentSeedFor(plan: BlastPlan): number {
  let seed = 2166136261;
  for (const hole of plan.holes) {
    const charge = plan.charges[hole.id];
    seed = Math.imul(seed ^ (hole.x | 0), 16777619);
    seed = Math.imul(seed ^ (hole.z | 0), 16777619);
    seed = Math.imul(seed ^ (hole.depth | 0), 16777619);
    seed = Math.imul(seed ^ Math.round((charge?.amountKg ?? 0) * 10), 16777619);
  }
  return Math.abs(seed) % 2147483647;
}

/**
 * How much of a fragment's leftover energy still throws it, from the stemming of
 * the hole nearest to where it broke.
 *
 * Per-hole rather than per-blast, so one carelessly stemmed hole in an otherwise
 * good pattern throws rock from its own corner instead of spoiling the average.
 */
function throwFractionAt(origin: Vec3, plan: BlastPlan): number {
  const hole = findNearestHole(origin, plan.holes);
  const charge = plan.charges[hole.id];
  const blowout = charge ? 1 - stemmingFactor(charge.stemmingM, hole.depth) : 1;
  return throwFractionForBlowout(blowout);
}

/**
 * Build the energy field for a plan and run propagation over it.
 *
 * Exported so the player's prediction tools run this exact code rather than
 * their own approximation: a preview that disagrees with what the blast then
 * does is worse than no preview at all.
 *
 * Returns null when the blast zone falls entirely outside the ground the site
 * owns — nothing to propagate through.
 */
export function buildPlanEnergyField(plan: BlastPlan, grid: VoxelGrid): EnergyField | null {
  const holeSurfaceYs: Record<string, number> = {};
  for (const hole of plan.holes) {
    holeSurfaceYs[hole.id] = computeVoxelColumnSurfaceY(grid, hole.x, hole.z) + 1;
  }
  return buildBlastEnergyField(plan, grid, calculateBlastZone(plan.holes, holeSurfaceYs), holeSurfaceYs);
}

export function buildBlastEnergyField(
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
  maxThrowDistance: number,
  cleared: number,
  maxVibration: number,
  totalFragments: number,
): BlastRating {
  if (cleared === 0) return 'bad'; // Nothing blasted = bad plan

  const projRatio = totalFragments > 0 ? projections / totalFragments : 0;

  // How far rock was actually thrown, not just how fast it left: a fragment that
  // lands back in the muck pile is a good blast, one that clears the pit is not.
  if (projRatio > 0.10 || maxVibration > 50 || maxThrowDistance > THROW_DISTANCE_CATASTROPHIC) return 'catastrophic';
  if (projRatio > 0.03 || maxVibration > 20 || maxThrowDistance > THROW_DISTANCE_BAD) return 'bad';
  if (projections > 3) return 'mediocre';
  if (projections > 0) return 'good';
  return 'perfect';
}
