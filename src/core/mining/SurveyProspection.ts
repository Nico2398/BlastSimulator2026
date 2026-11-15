// BlastSimulator2026 — Long-range prospection (#2286): a coarse map of the ore islands, no per-voxel detail.

import type { Random } from '../math/Random.js';
import type { OreIsland } from '../world/OreIslands.js';
import { clamp } from './SurveyEstimateMath.js';
import {
  ORE_ISLAND_MAX_DISTANCE_M, ORE_ISLAND_MIN_DISTANCE_M, ORE_ISLAND_ORE_IDS, ORE_ISLAND_RADIUS_MAX_M, ORE_ISLAND_RADIUS_MIN_M,
  PROSPECTION_FALSE_LEAD_MAX, PROSPECTION_ORE_MISREAD_CHANCE, PROSPECTION_POSITION_ERROR_M, PROSPECTION_RADIUS_STEP_M,
  PROSPECTION_TOP_SKILL, SURVEY_COVERAGE_RADIUS,
} from '../config/balance.js';

/** One island as a prospection reports it: a coarse area and the G2 ore that dominates it. */
export interface ProspectedIsland {
  x: number;
  z: number;
  radius: number;
  oreId: string;
}

/** Inputs of a prospection read. */
export interface ProspectionParams {
  centerX: number;
  centerZ: number;
  skillLevel: number;
}

const roundRadius = (r: number): number =>
  Math.max(PROSPECTION_RADIUS_STEP_M, Math.round(r / PROSPECTION_RADIUS_STEP_M) * PROSPECTION_RADIUS_STEP_M);

const randomOre = (rng: Random): string | undefined => ORE_ISLAND_ORE_IDS[rng.nextInt(0, ORE_ISLAND_ORE_IDS.length - 1)];

/**
 * Report every island whose centre lies within the prospection radius of the centre, as a coarse area with its
 * dominant ore. Noise (position jitter, a misread ore, false leads) falls to zero at the top skill and is seeded.
 */
export function prospectIslands(
  islands: readonly OreIsland[],
  params: ProspectionParams,
  rng: Random,
): ProspectedIsland[] {
  const { centerX, centerZ, skillLevel } = params;
  const noise = clamp((PROSPECTION_TOP_SKILL - skillLevel) / (PROSPECTION_TOP_SKILL - 1), 0, 1);
  const reach = SURVEY_COVERAGE_RADIUS.prospection;
  const found: ProspectedIsland[] = [];
  for (const island of islands) {
    if (Math.hypot(island.x - centerX, island.z - centerZ) > reach) continue;
    let oreId = island.oreIds[0] ?? '';
    if (noise > 0 && rng.chance(PROSPECTION_ORE_MISREAD_CHANCE * noise)) oreId = randomOre(rng) ?? oreId;
    const angle = rng.next() * Math.PI * 2;
    const dist = rng.next() * PROSPECTION_POSITION_ERROR_M * noise;
    found.push({
      x: Math.round(island.x + Math.cos(angle) * dist),
      z: Math.round(island.z + Math.sin(angle) * dist),
      radius: roundRadius(island.radius),
      oreId,
    });
  }
  const falseLeads = rng.nextInt(0, Math.round(PROSPECTION_FALSE_LEAD_MAX * noise));
  for (let i = 0; i < falseLeads; i++) {
    const lead = falseLead(islands, centerX, centerZ, rng);
    if (lead) found.push(lead);
  }
  return found;
}

/** A plausible island where none lies: clear of every real one by twice the position error plus a radius. */
function falseLead(islands: readonly OreIsland[], centerX: number, centerZ: number, rng: Random): ProspectedIsland | null {
  const clearance = PROSPECTION_POSITION_ERROR_M * 2 + ORE_ISLAND_RADIUS_MAX_M;
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = rng.next() * Math.PI * 2;
    const dist = rng.nextFloat(ORE_ISLAND_MIN_DISTANCE_M, ORE_ISLAND_MAX_DISTANCE_M);
    const x = Math.round(centerX + Math.cos(angle) * dist);
    const z = Math.round(centerZ + Math.sin(angle) * dist);
    const oreId = randomOre(rng);
    const radius = rng.nextFloat(ORE_ISLAND_RADIUS_MIN_M, ORE_ISLAND_RADIUS_MAX_M);
    if (oreId && !islands.some((i) => Math.hypot(i.x - x, i.z - z) < clearance)) {
      return { x, z, radius: roundRadius(radius), oreId };
    }
  }
  return null;
}
