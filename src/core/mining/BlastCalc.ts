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
import { BLAST_ENERGY_EPSILON, MAX_FRAGMENTS_PER_VOXEL, PROJECTION_SPEED_THRESHOLD, MAX_PROPAGATION_ITERATIONS } from '../config/balance.js';

// ────────────────────────────────────────────────────────
// § 1: Voxel Threshold
// ────────────────────────────────────────────────────────

/**
 * Compute the energy threshold for a voxel based on its rock composition.
 * T(v) = Σ_r [ coefficient[r] * rockDef[r].energyAbsorption ]
 *
 * Returns 0 for air voxels (empty composition).
 * Unknown rock IDs are silently treated as zero contribution.
 */
export function computeThreshold(voxel: VoxelData): number {
  const { rocks } = voxel.composition;
  if (rocks.length === 0) return 0;

  let sum = 0;
  for (const rock of rocks) {
    const rockDef = getRock(rock.rockId);
    if (rockDef) {
      sum += rock.coefficient * rockDef.energyAbsorption;
    }
    // Unknown rock ID → treat contribution as 0
  }
  return sum;
}

// ────────────────────────────────────────────────────────
// § 2: Energy Calculation
// ────────────────────────────────────────────────────────

// Minimum effective distance² for energy field (imported from balance config).
// Real blasting: near field is uniform within ~2x borehole radius (~2m).
const EPSILON = BLAST_ENERGY_EPSILON;

/** Raw energy of a charged hole (before stemming/water effects). */
export function calculateHoleEnergy(charge: HoleCharge): number {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return 0;
  return explosive.energyPerKg * charge.amountKg;
}

/**
 * Stemming factor: 0–1 indicating how well energy is directed downward.
 * Per BLAST_SYSTEM.md §2.1:
 *   stemming_factor = clamp(stemmingHeight / (holeDepth * 0.3), 0, 1)
 */
export function stemmingFactor(stemmingHeight: number, holeDepth: number): number {
  if (holeDepth <= 0) return 0;
  return Math.max(0, Math.min(1, stemmingHeight / (holeDepth * 0.3)));
}

/**
 * Water effect on energy.
 * Per BLAST_SYSTEM.md §2.2:
 *   Water-sensitive explosive in flooded hole without tubing → 10% energy.
 */
export function waterEffect(
  isFlooded: boolean,
  waterSensitive: boolean,
  hasTubing: boolean,
): number {
  if (isFlooded && waterSensitive && !hasTubing) return 0.1;
  return 1.0;
}

/** Effective energy at depth for a hole (after stemming + water + explosive modifiers). */
export function effectiveHoleEnergy(
  charge: HoleCharge,
  holeDepth: number,
  isFlooded: boolean,
  hasTubing: boolean,
): { downward: number; upward: number; vibrationMod: number } {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return { downward: 0, upward: 0, vibrationMod: 1 };

  const rawE = explosive.energyPerKg * charge.amountKg;
  const sf = stemmingFactor(charge.stemmingM, holeDepth);
  const wf = waterEffect(isFlooded, explosive.waterSensitive, hasTubing);

  const downward = rawE * (0.5 + 0.5 * sf) * wf;
  // projectionRiskMod scales how much energy escapes upward (fly-rock hazard)
  const upward = rawE * (1 - sf) * 0.7 * wf * explosive.projectionRiskMod;
  return { downward, upward, vibrationMod: explosive.vibrationMod };
}

/**
 * Total energy field at a point from all holes.
 * Downward energy radiates from the mid-column source downward into the rock.
 * Upward energy (from insufficient stemming) radiates from the collar (hole top)
 * and adds energy to surface voxels above — creating fly-rock projections.
 * E(P) = Σ [ E_downward_i / (dist_from_midcolumn² + ε) + E_upward_i / (dist_from_collar² + ε) ]
 */
export function calculateEnergyField(
  point: Vec3,
  holes: readonly DrillHole[],
  charges: Record<string, HoleCharge>,
  holeDepths: Record<string, number>,
  holeSurfaceYs?: Record<string, number>,
): number {
  let total = 0;
  for (const hole of holes) {
    const charge = charges[hole.id];
    if (!charge) continue;
    const energy = effectiveHoleEnergy(charge, holeDepths[hole.id] ?? hole.depth, false, false);
    const surfaceY = holeSurfaceYs?.[hole.id] ?? 0;
    const depth = holeDepths[hole.id] ?? hole.depth;
    // Downward energy: radiated from mid-column source
    const midPos = vec3(hole.x, surfaceY - depth / 2, hole.z);
    const d2mid = distSquared(point, midPos);
    total += energy.downward / (d2mid + EPSILON);
    // Upward energy: radiated from collar (hole top) and affects near-surface voxels
    if (energy.upward > 0) {
      const collarPos = vec3(hole.x, surfaceY, hole.z);
      const d2collar = distSquared(point, collarPos);
      total += energy.upward / (d2collar + EPSILON);
    }
  }
  return total;
}

// ────────────────────────────────────────────────────────
// § 3: Fragmentation
// ────────────────────────────────────────────────────────

export type FractureResult = 'fractured' | 'cracked' | 'unaffected';

export interface FragmentationResult {
  result: FractureResult;
  /** Fragment size as fraction of voxel size. */
  fragmentSizeFraction: number;
  /** Whether this is a dangerous projection. */
  isProjection: boolean;
  energyRatio: number;
}

/**
 * Determine fragmentation result for a voxel.
 * Per BLAST_SYSTEM.md §3.1–3.2.
 */
export function calculateFragmentation(
  energy: number,
  fractureThreshold: number,
): FragmentationResult {
  if (fractureThreshold <= 0) {
    return { result: 'unaffected', fragmentSizeFraction: 1, isProjection: false, energyRatio: 0 };
  }
  const ratio = energy / fractureThreshold;

  if (ratio < 0.5) {
    return { result: 'unaffected', fragmentSizeFraction: 1, isProjection: false, energyRatio: ratio };
  }
  if (ratio < 1.0) {
    // Cracked — threshold reduced by 30% for future blasts
    return { result: 'cracked', fragmentSizeFraction: 1, isProjection: false, energyRatio: ratio };
  }
  if (ratio < 2.0) {
    // Good fragmentation
    const size = 1.0 - 0.7 * (ratio - 1.0); // lerp(1.0, 0.3, ratio-1)
    return { result: 'fractured', fragmentSizeFraction: size, isProjection: false, energyRatio: ratio };
  }
  if (ratio < 4.0) {
    // Fine fragmentation
    const t = (ratio - 2.0) / 2.0;
    const size = 0.3 - 0.2 * t; // lerp(0.3, 0.1, t)
    return { result: 'fractured', fragmentSizeFraction: size, isProjection: false, energyRatio: ratio };
  }
  // Over-blasted — dust + projection
  return { result: 'fractured', fragmentSizeFraction: 0.05, isProjection: true, energyRatio: ratio };
}

/**
 * Fragment count from conservation of mass.
 * Capped at MAX_FRAGMENTS_PER_VOXEL to prevent memory issues.
 * Over-blasted dust is represented as a few "dust pile" fragments, not individual particles.
 */
// MAX_FRAGMENTS_PER_VOXEL imported from balance config above

export function calculateFragmentCount(
  voxelVolume: number,
  fragmentSize: number,
): number {
  if (fragmentSize <= 0) return 1;
  const fragmentVolume = fragmentSize * fragmentSize * fragmentSize;
  return Math.min(MAX_FRAGMENTS_PER_VOXEL, Math.max(1, Math.ceil(voxelVolume / fragmentVolume)));
}

// ────────────────────────────────────────────────────────
// § 5.1: Initial Velocity
// ────────────────────────────────────────────────────────

// PROJECTION_SPEED_THRESHOLD imported from balance config above

/**
 * Calculate initial velocity of a fragment.
 * Direction = away from nearest hole.
 * Speed = sqrt(2 * E / mass) * modifier.
 */
export function calculateInitialVelocity(
  fragmentPos: Vec3,
  nearestHolePos: Vec3,
  energy: number,
  mass: number,
): Vec3 {
  const dir = sub(fragmentPos, nearestHolePos);
  const len = vecLength(dir);
  const normalized = len > 0 ? normalize(dir) : vec3(0, 1, 0);
  const speed = Math.sqrt(Math.max(0, 2 * energy / Math.max(mass, 0.01)));
  return scale(normalized, speed);
}

/** Classify whether a fragment is a projection based on speed. */
export function classifyProjection(speed: number, energyRatio: number): boolean {
  return speed > PROJECTION_SPEED_THRESHOLD || energyRatio >= 4.0;
}

// ────────────────────────────────────────────────────────
// § 6.2: Free Face
// ────────────────────────────────────────────────────────

/**
 * Calculate free face factor for a hole.
 * Checks 6 cardinal neighbors of the hole column in the voxel grid.
 * Returns 0.0 (fully confined) to 1.0 (fully open).
 */
export function calculateFreeFace(
  holeX: number,
  holeZ: number,
  holeDepth: number,
  isVoxelEmpty: (x: number, y: number, z: number) => boolean,
): number {
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  let openCount = 0;
  let totalChecked = 0;

  for (let y = 0; y < holeDepth; y++) {
    for (const [dx, dz] of directions) {
      totalChecked++;
      if (isVoxelEmpty(holeX + dx, y, holeZ + dz)) {
        openCount++;
      }
    }
  }

  return totalChecked > 0 ? openCount / totalChecked : 0;
}

// ────────────────────────────────────────────────────────
// § 7: Vibration
// ────────────────────────────────────────────────────────

/**
 * Calculate vibration at distance d from the blast.
 * Uses the scaled-distance law: V = max(charge_per_delay)^0.7 / d^1.5 * groundFactor
 * Real blasting vibration is dominated by the maximum charge per delay,
 * not the sum — splitting charge across delays reduces peak vibration.
 */
export function calculateVibrations(
  chargePerDelay: number[],
  distance: number,
  groundFactor: number,
): number {
  if (distance <= 0) return Infinity;
  if (chargePerDelay.length === 0) return 0;
  const maxCharge = Math.max(...chargePerDelay);
  return Math.pow(maxCharge, 0.7) / Math.pow(distance, 1.5) * groundFactor;
}

/**
 * Group charges by delay and compute total charge per delay slot.
 */
export function groupChargesByDelay(
  holes: readonly DrillHole[],
  charges: Record<string, HoleCharge>,
  delays: Record<string, number>,
): number[] {
  const delayGroups = new Map<number, number>();
  for (const hole of holes) {
    const charge = charges[hole.id];
    const delay = delays[hole.id];
    if (charge !== undefined && delay !== undefined) {
      const existing = delayGroups.get(delay) ?? 0;
      delayGroups.set(delay, existing + charge.amountKg);
    }
  }
  return [...delayGroups.values()];
}

// ────────────────────────────────────────────────────────
// § 5.5: Energy Propagation
// ────────────────────────────────────────────────────────

export interface PropagationResult {
  effectiveEnergy: Map<string, number>;
  generatedOverflow: Map<string, number>;
}

/** Epsilon threshold for propagation leftover. Values below this are treated as zero
 *  to prevent floating-point drift causing infinite sub-epsilon propagation loops. */
const PROPAGATION_EPSILON = 1e-12;

/** Face-adjacent neighbor offsets: 6 directions (±x, ±y, ±z). */
const NEIGHBOR_OFFSETS: readonly [number, number, number][] = [
  [ 1,  0,  0],
  [-1,  0,  0],
  [ 0,  1,  0],
  [ 0, -1,  0],
  [ 0,  0,  1],
  [ 0,  0, -1],
];

/** Check if a voxel is air (no solid material). */
function isAirVoxel(voxel: VoxelData): boolean {
  return voxel.density <= 0 || voxel.composition.rocks.length === 0;
}

/**
 * Propagate energy through the voxel grid using iterative overflow.
 * Each voxel absorbs up to T(v) - already_absorbed, then distributes
 * leftover energy equally among up to 6 face-adjacent non-air neighbours.
 *
 * Pure function — does not mutate the VoxelGrid.
 *
 * @param grid - VoxelGrid (read-only).
 * @param initial - Map of "x,y,z" → initial overflow energy per voxel.
 * @returns PropagationResult with effectiveEnergy and generatedOverflow maps.
 */
export function propagateEnergy(
  grid: VoxelGrid,
  initial: Map<string, number>,
): PropagationResult {
  const effectiveEnergy = new Map<string, number>();
  const generatedOverflow = new Map<string, number>();

  // ── Filter and sanitize initial input ────────────────────────────────────────
  const overflow = new Map<string, number>();
  for (const [key, rawEnergy] of initial) {
    // Clamp NaN and negative to 0
    let energy = rawEnergy;
    if (typeof energy !== 'number' || !Number.isFinite(energy)) {
      energy = 0;
    }
    if (energy < 0) {
      energy = 0;
    }
    if (energy <= PROPAGATION_EPSILON) {
      continue;
    }

    // Parse coordinates
    const parts = key.split(',');
    if (parts.length !== 3) continue;
    const x = parseInt(parts[0]!, 10);
    const y = parseInt(parts[1]!, 10);
    const z = parseInt(parts[2]!, 10);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;

    // Skip out-of-bounds keys
    if (!grid.isInBounds(x, y, z)) continue;

    overflow.set(key, energy);
  }

  // ── Propagate: empty grid or all-air → return clean maps early ──────────────
  if (overflow.size === 0) {
    return { effectiveEnergy, generatedOverflow };
  }

  // ── Iterative propagation loop ───────────────────────────────────────────────
  let currentOverflow = overflow;

  for (let iter = 0; iter < MAX_PROPAGATION_ITERATIONS; iter++) {
    if (currentOverflow.size === 0) break;

    const nextOverflow = new Map<string, number>();
    let anyChange = false;

    for (const [key, incoming] of currentOverflow) {
      if (incoming <= PROPAGATION_EPSILON) continue;

      const parts = key.split(',');
      const x = parseInt(parts[0]!, 10);
      const y = parseInt(parts[1]!, 10);
      const z = parseInt(parts[2]!, 10);

      const voxel = grid.getVoxel(x, y, z);
      if (!voxel) continue;

      // Compute threshold and already-absorbed energy for this voxel
      const threshold = computeThreshold(voxel);
      const currentEffective = effectiveEnergy.get(key) ?? 0;

      // Absorb up to remaining capacity
      const canAbsorb = Math.max(0, threshold - currentEffective);
      const absorbed = Math.min(incoming, canAbsorb);

      if (absorbed > 0) {
        effectiveEnergy.set(key, currentEffective + absorbed);
      }

      const leftover = incoming - absorbed;

      if (leftover > PROPAGATION_EPSILON) {
        // Track overflow that passed through this voxel
        generatedOverflow.set(key, (generatedOverflow.get(key) ?? 0) + leftover);

        // Distribute leftover equally to valid face-adjacent non-air neighbours
        const validNeighbors: string[] = [];

        for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;

          if (!grid.isInBounds(nx, ny, nz)) continue;

          const nvoxel = grid.getVoxel(nx, ny, nz);
          if (!nvoxel || isAirVoxel(nvoxel)) continue;

          validNeighbors.push(`${nx},${ny},${nz}`);
        }

        if (validNeighbors.length > 0) {
          const share = leftover / validNeighbors.length;
          for (const nkey of validNeighbors) {
            nextOverflow.set(nkey, (nextOverflow.get(nkey) ?? 0) + share);
          }
          anyChange = true;
        }
        // If no valid neighbors, leftover stays in generatedOverflow (cannot dissipate).
        // Loop will detect no change next iteration and break.
      }
    }

    currentOverflow = nextOverflow;

    if (!anyChange) {
      break;
    }
  }

  return { effectiveEnergy, generatedOverflow };
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function distSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export { PROJECTION_SPEED_THRESHOLD };

// Boulder fragmentation lives in its own sub-module; re-exported here so that
// all callers importing from 'BlastCalc.js' continue to work unchanged.
export { isOversized, fragmentBoulder, resetBoulderFragIds, OVERSIZED_FRAGMENT_THRESHOLD, type Boulder, type FragmentBoulderResult } from './BoulderFragmentation.js';
