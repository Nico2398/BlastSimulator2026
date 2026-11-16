// BlastSimulator2026 — The terrain config a game's grid was generated from, and what it yields (ore islands).
// Core-side so the engine can reach it without importing the console layer.

import type { GameState, WorldState } from '../state/GameState.js';
import { getBiome } from './BiomeCatalog.js';
import { buildTerrainContext, type TerrainConfig } from './TerrainGen.js';
import type { OreIsland } from './OreIslands.js';
import type { PitMaskShape } from '../config/balance.js';

/** Size, hardness and ore-mode fields terrain generation reads off a world. */
export interface GenerationFields { sizeX: number; datum: number; sizeZ: number; mixedRockHardness?: boolean; oreDeposits?: boolean; pitMask?: PitMaskShape; oreGradeScale?: number; climateBias?: [number, number]; vehicleSlopeRatio?: number; mustReach?: { x: number; z: number } }

/**
 * The base (level-original) size + hardness fields generation reads off a
 * `WorldState` — takes only the `WorldState` slice it reads, not the whole
 * `GameState`, since neither caller below needs anything else off it
 * (#1181 review). The one source of truth for "which WorldState fields feed
 * generation": `regenerateGridParams` layers its own dimension validation on
 * top for a no-voxels load fallback.
 */
export function worldGenerationFields(world: WorldState): GenerationFields {
  return {
    sizeX: world.baseSizeX,
    datum: world.datum,
    sizeZ: world.baseSizeZ,
    ...(world.mixedRockHardness !== undefined ? { mixedRockHardness: world.mixedRockHardness } : {}),
    ...(world.oreDeposits !== undefined ? { oreDeposits: world.oreDeposits } : {}),
    ...(world.pitMask !== undefined ? { pitMask: world.pitMask } : {}),
    ...(world.oreGradeScale !== undefined ? { oreGradeScale: world.oreGradeScale } : {}),
    ...(world.climateBias ? { climateBias: world.climateBias } : {}),
  };
}

/** The terrain config a game's grid was generated from — the datum every later chunk is generated against (#473 D3). */
export function terrainConfigOf(state: GameState): TerrainConfig | null {
  if (!state.world) return null;
  const biome = getBiome(state.mineType);
  if (!biome) return null;
  const { climateBias, ...fields } = worldGenerationFields(state.world);
  return {
    seed: state.seed,
    climateBias: climateBias ?? biome.climateCenter,
    ...fields,
  };
}

/** Every ore island of the state's world (#2286); empty with no terrain config or no deposits. */
export function oreIslandsOf(state: GameState): readonly OreIsland[] {
  const config = terrainConfigOf(state);
  return config ? buildTerrainContext(config).oreIslands?.list() ?? [] : [];
}
