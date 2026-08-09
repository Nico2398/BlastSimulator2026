// BlastSimulator2026 — Charge arithmetic and ground vibration
//
// How much energy a charge delivers, how stemming and water change that, and
// what the neighbours feel. Everything about what the energy then does to the
// rock lives in EnergyPropagation / VoxelFragmentation / FragmentGeneration.

import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import type { VoxelData } from '../world/VoxelGrid.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { getRock } from '../world/RockCatalog.js';
import { PROJECTION_SPEED_THRESHOLD } from '../config/balance.js';

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

export function calculateHoleEnergy(charge: HoleCharge): number {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return 0;
  return explosive.energyPerKg * charge.amountKg;
}

export function computeInitialEnergy(charge: HoleCharge, holeDepth: number, isFlooded = false): number {
  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return 0;
  // hasTubing is always false here: the caller (buildBlastEnergyField) only
  // marks a hole flooded via wetHoles(), which already excludes tubed holes
  // (WetHoles.ts) — isFlooded=true already means "and no tubing protects it".
  const wf = waterEffect(isFlooded, explosive.waterSensitive, false);
  return explosive.energyPerKg * charge.amountKg * stemmingEfficiency(charge.stemmingM, holeDepth) * wf;
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
// Helpers
// --------------------------------------------------------

export function parseKey(key: string): [number, number, number] | null {
  const parts = key.split(',');
  if (parts.length !== 3) return null;
  const x = parseInt(parts[0]!, 10), y = parseInt(parts[1]!, 10), z = parseInt(parts[2]!, 10);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
  return [x, y, z];
}

export { PROJECTION_SPEED_THRESHOLD };
export { isOversized, isFragmentOversized, fragmentBoulder, resetBoulderFragIds, OVERSIZED_FRAGMENT_THRESHOLD, type Boulder, type FragmentBoulderResult } from './BoulderFragmentation.js';
