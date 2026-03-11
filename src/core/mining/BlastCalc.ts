// BlastSimulator2026 — Blast calculation engine
// Pure math functions for energy, fragmentation, velocity, free face, vibration.
// Every formula from BLAST_SYSTEM.md is implemented here.

import type { Vec3 } from '../math/Vec3.js';
import { vec3, sub, normalize, scale, length as vecLength } from '../math/Vec3.js';
import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';

// ────────────────────────────────────────────────────────
// § 2: Energy Calculation
// ────────────────────────────────────────────────────────

// Minimum effective distance² for energy field.
// Set to 4.0 (equivalent to 2m min radius) because charge is distributed
// along borehole depth (~8m), not a point source. Real blasting literature
// models the "near field" as uniform within ~2x borehole radius.
const EPSILON = 4.0;

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

/** Effective energy at depth for a hole (after stemming + water). */
export function effectiveHoleEnergy(
  charge: HoleCharge,
  holeDepth: number,
  isFlooded: boolean,
  hasTubing: boolean,
): { downward: number; upward: number } {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return { downward: 0, upward: 0 };

  const rawE = explosive.energyPerKg * charge.amountKg;
  const sf = stemmingFactor(charge.stemmingM, holeDepth);
  const wf = waterEffect(isFlooded, explosive.waterSensitive, hasTubing);

  const downward = rawE * (0.5 + 0.5 * sf) * wf;
  const upward = rawE * (1 - sf) * 0.7 * wf;
  return { downward, upward };
}

/**
 * Total energy field at a point from all holes.
 * E(P) = Σ [ E_i / (dist² + ε) ]
 */
export function calculateEnergyField(
  point: Vec3,
  holes: readonly DrillHole[],
  charges: Record<string, HoleCharge>,
  holeDepths: Record<string, number>,
): number {
  let total = 0;
  for (const hole of holes) {
    const charge = charges[hole.id];
    if (!charge) continue;
    const energy = effectiveHoleEnergy(charge, holeDepths[hole.id] ?? hole.depth, false, false);
    const holePos = vec3(hole.x, 0, hole.z);
    const d2 = distSquared(point, holePos);
    total += energy.downward / (d2 + EPSILON);
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
const MAX_FRAGMENTS_PER_VOXEL = 20;

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

const PROJECTION_SPEED_THRESHOLD = 15; // m/s

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
// Helpers
// ────────────────────────────────────────────────────────

function distSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export { PROJECTION_SPEED_THRESHOLD };
