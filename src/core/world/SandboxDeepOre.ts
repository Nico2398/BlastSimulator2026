// BlastSimulator2026 — Sandbox ore layers by grade (#1933, #2281)
// Sandbox sites (ore deposits on) read ore hosting and depth windows through these helpers: G0 ores sit in the top
// layer, G1 ores below it, and G2/G3 ores are not in ordinary ground. Campaign rocks and the shared catalog are untouched.

import { ORE_G0_LAYER_DEPTH_M, ORE_PROGRESSION_HOST_FLOOR, SANDBOX_DEEP_ORE_AFFINITY } from '../config/balance.js';
import { getAllOres, type OreType } from './OreCatalog.js';
import { getRock } from './RockCatalog.js';

/** Highest ore grade ordinary ground holds. */
const ORDINARY_GROUND_MAX_GRADE = 1;

function inOrdinaryGround(ore: OreType): boolean {
  return ore.permitGrade <= ORDINARY_GROUND_MAX_GRADE;
}

/**
 * Host probability of oreId in a rock on a sandbox site: the sandbox override, else the catalog value, lifted to
 * ORE_PROGRESSION_HOST_FLOOR so every biome holds both grades. 0 for a G2/G3 ore or an unknown rock.
 */
export function sandboxHostProbability(rockId: string, oreId: string): number {
  const ore = getAllOres().find(o => o.id === oreId);
  const rock = getRock(rockId);
  if (!ore || !rock || !inOrdinaryGround(ore)) return 0;
  const base = SANDBOX_DEEP_ORE_AFFINITY[rockId]?.[oreId] ?? rock.oreProbabilities[oreId] ?? 0;
  return Math.max(base, ORE_PROGRESSION_HOST_FLOOR);
}

/** Depth window [min, max] of an ore on a sandbox site: G0 in the top layer, G1 from it down; null for G2/G3. */
export function sandboxOreWindow(ore: OreType): readonly [number, number] | null {
  if (!inOrdinaryGround(ore)) return null;
  if (ore.permitGrade === 0) return [0, ORE_G0_LAYER_DEPTH_M];
  return [Math.max(ore.depthMin, ORE_G0_LAYER_DEPTH_M), ore.depthMax];
}

/** Ore ids the given rocks can host on a sandbox site, in catalog order. */
export function sandboxOresYieldedByRocks(rockIds: readonly string[]): string[] {
  return getAllOres()
    .filter(ore => rockIds.some(id => getRock(id) !== undefined && sandboxHostProbability(id, ore.id) > 0))
    .map(o => o.id);
}
