// BlastSimulator2026 — Sandbox-only deep ore content (#1933)
// Sandbox sites (ore deposits on) read ore hosting and depth windows through these helpers so deeper
// rock can pay more without changing campaign rocks, Level 1's contract ores or the shared catalog.

import { SANDBOX_DEEP_ORE_AFFINITY, SANDBOX_ORE_DEPTH_WINDOWS } from '../config/balance.js';
import { getAllOres, type OreType } from './OreCatalog.js';
import { getRock } from './RockCatalog.js';

/** Host probability of oreId in a rock on a sandbox site: the sandbox override, else the catalog value. */
export function sandboxHostProbability(rockId: string, oreId: string): number {
  const override = SANDBOX_DEEP_ORE_AFFINITY[rockId]?.[oreId];
  return override ?? getRock(rockId)?.oreProbabilities[oreId] ?? 0;
}

/** Depth window [min, max] of an ore on a sandbox site. */
export function sandboxOreWindow(ore: OreType): readonly [number, number] {
  return SANDBOX_ORE_DEPTH_WINDOWS[ore.id] ?? [ore.depthMin, ore.depthMax];
}

/** Ore ids the given rocks can host on a sandbox site, in catalog order. */
export function sandboxOresYieldedByRocks(rockIds: readonly string[]): string[] {
  return getAllOres()
    .filter(ore => rockIds.some(id => getRock(id) !== undefined && sandboxHostProbability(id, ore.id) > 0))
    .map(o => o.id);
}
