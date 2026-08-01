// BlastSimulator2026 — Console commands for world creation and inspection

import type { CommandResult } from '../ConsoleRunner.js';
import { createGame, buildGameNavGrid, type GameState } from '../../core/state/GameState.js';
import { getBiome, getAllBiomes } from '../../core/world/BiomeCatalog.js';
import { generateTerrain, buildTerrainContext } from '../../core/world/TerrainGen.js';
import { buildStructureSet } from '../../core/world/Structures.js';
import { buildLandscapeMap, sampleLandscapeColumn, type LandscapeMap } from '../../core/world/LandscapeMap.js';
import type { Rect } from '../../core/world/WorldGen.js';
import { getRock } from '../../core/world/RockCatalog.js';
import { getOre } from '../../core/world/OreCatalog.js';
import { getDominantRockId } from '../../core/world/VoxelGrid.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';
import { decodeVoxelGrid, type SerializedVoxels } from '../../core/state/VoxelGridCodec.js';

/**
 * The landscape's coarse tile map plus a reusable fine-grained sampler
 * (#458 T3.2) — the seam mesher needs point samples at 1m resolution near
 * the playable rect, which the stored 4m tile arrays can't provide. Bundling
 * both here means the sampler closes over the same worldGen/structureSet/
 * strata/palette `ensureLandscape` already built, so a caller never needs to
 * reconstruct the (expensive) structure set a second time just to sample a
 * handful of extra points.
 */
export interface LandscapeHandle {
  map: LandscapeMap;
  playableRect: Rect;
  sampleColumn(x: number, z: number): { height: number; biomeId: number; surfCompId: number };
}

/** Shared game context for console commands. */
export interface GameContext {
  state: GameState | null;
  grid: VoxelGrid | null;
  /**
   * Purely-aesthetic landscape zone beside `grid` (#458 T2.1/D7) — never
   * serialized, never read by simulation. Built lazily via `ensureLandscape`
   * rather than eagerly here: nothing consumed it before T3.2's landscape
   * mesher, and eager construction would add several seconds to every
   * `new_game`/`regenerateGrid` call. Command-mode scenarios never
   * instantiate a renderer, so they never trigger this build at all; only
   * the browser game and interaction-mode/visual harnesses pay the cost.
   */
  landscape: LandscapeHandle | null;
  /** Event emitter for game-over and campaign events. Listeners attached in main.ts/console.ts. */
  emitter: EventEmitter;
}

/** Grid edge length (voxels) used when a size is not explicitly given. */
export const DEFAULT_GRID_SIZE = 64;

/**
 * Regenerate `ctx.grid` and its dependent navgrid for `ctx.state`. The
 * VoxelGrid is not part of the serialized GameState (see the WorldState
 * comment in GameState.ts), so every path that creates or restores a
 * GameState — new game, campaign level start, save load — must rebuild it
 * from scratch the same way. Centralized here so all four call sites
 * (`newGameCommand`, `campaignStartCommand`, `loadCommand`, and the
 * Save/Load UI's load handler in main.ts) stay in sync (#408).
 */
export function regenerateGrid(
  ctx: GameContext,
  params: {
    seed: number; climateBias: readonly [number, number];
    sizeX: number; sizeY: number; sizeZ: number;
    mixedRockHardness?: boolean;
  },
): void {
  if (!ctx.state) return;
  const { seed, climateBias, sizeX, sizeY, sizeZ, mixedRockHardness } = params;
  ctx.grid = generateTerrain({ sizeX, sizeY, sizeZ, seed, climateBias, ...(mixedRockHardness !== undefined ? { mixedRockHardness } : {}) });
  ctx.landscape = null; // stale for the new grid — rebuilt lazily by ensureLandscape() (#458 T2.1)
  buildGameNavGrid(ctx.state, ctx.grid, ctx.state.buildings.buildings, ctx.state.drillHoles);
  ctx.emitter.emit('terrain:updated', {
    region: { minX: 0, minY: 0, minZ: 0, maxX: sizeX - 1, maxY: sizeY - 1, maxZ: sizeZ - 1 },
  });
}

/**
 * Build (or return the already-built) landscape map for the current grid.
 * Lazy and cached on `ctx.landscape` — call this the first time something
 * actually needs landscape data (T3.2's mesher; `landscape_info` below);
 * every other command that only touches the playable grid never pays this
 * cost. `params` must match whatever `regenerateGrid`/`restoreGrid` most
 * recently built the grid with, or the two will disagree at the boundary.
 */
export function ensureLandscape(
  ctx: GameContext,
  params: {
    seed: number; climateBias: readonly [number, number];
    sizeX: number; sizeY: number; sizeZ: number;
    mixedRockHardness?: boolean;
  },
): LandscapeHandle | null {
  if (!ctx.grid) return null;
  if (ctx.landscape) return ctx.landscape;

  const { worldGen, biome, strata } = buildTerrainContext(params);
  const structureSet = buildStructureSet(params.seed, worldGen.fields, worldGen.shapingAt, biome.forestDensity, worldGen.playableRect);
  const palette = ctx.grid.palette;
  const map = buildLandscapeMap(worldGen, params.climateBias, structureSet, strata, palette);

  ctx.landscape = {
    map,
    playableRect: worldGen.playableRect,
    sampleColumn: (x, z) => sampleLandscapeColumn(worldGen, params.climateBias, structureSet, strata, palette, x, z),
  };
  return ctx.landscape;
}

/**
 * Restore `ctx.grid` from a save's embedded voxel payload (v6+), preserving
 * actual terrain mutations — blast craters, ramps — instead of discarding
 * them the way `regenerateGrid`'s from-seed path does. Mirrors
 * `regenerateGrid`'s navgrid-build and event-emission steps exactly; only
 * the grid's origin (decoded vs. freshly generated) differs (#458 T0.3).
 */
export function restoreGrid(ctx: GameContext, voxels: SerializedVoxels): void {
  if (!ctx.state) return;
  ctx.grid = decodeVoxelGrid(voxels);
  ctx.landscape = null; // stale for the restored grid — rebuilt lazily by ensureLandscape() (#458 T2.1)
  buildGameNavGrid(ctx.state, ctx.grid, ctx.state.buildings.buildings, ctx.state.drillHoles);
  ctx.emitter.emit('terrain:updated', {
    region: { minX: 0, minY: 0, minZ: 0, maxX: voxels.sizeX - 1, maxY: voxels.sizeY - 1, maxZ: voxels.sizeZ - 1 },
  });
}

export function newGameCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const mineType = named['mine_type'] ?? 'desert_badlands';
  const seed = named['seed'] ? parseInt(named['seed'], 10) : Date.now() % 100000;

  const biome = getBiome(mineType);
  if (!biome) {
    const valid = getAllBiomes().map(b => b.id).join(', ');
    return { success: false, output: `Unknown mine type: "${mineType}". Valid: ${valid}` };
  }

  const size = named['size'] ? parseInt(named['size'], 10) : DEFAULT_GRID_SIZE;
  ctx.state = createGame({
    seed, mineType,
    ...(named['cash'] ? { startingCash: parseInt(named['cash'], 10) } : {}),
  });
  ctx.state.world = { sizeX: size, sizeY: size, sizeZ: size, gridReady: true };
  regenerateGrid(ctx, { seed, climateBias: biome.climateCenter, sizeX: size, sizeY: size, sizeZ: size });

  return {
    success: true,
    output: `Game created. ${size}x${size}x${size} terrain, ${mineType} biome, seed ${seed}.`,
  };
}

export function inspectCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.grid) return { success: false, output: 'No game loaded. Use new_game first.' };

  const coords = (args[0] ?? '').split(',').map(Number);
  if (coords.length < 3 || coords.some(isNaN)) {
    return { success: false, output: 'Usage: inspect x,y,z' };
  }
  const [x, y, z] = coords as [number, number, number];

  if (!ctx.grid.isInBounds(x, y, z)) {
    return {
      success: false,
      output: `Out of bounds: (${x},${y},${z}). Grid is ${ctx.grid.sizeX}x${ctx.grid.sizeY}x${ctx.grid.sizeZ}.`,
    };
  }

  const v = ctx.grid.getVoxel(x, y, z)!;
  if (v.density === 0) {
    return { success: true, output: `(${x},${y},${z}): Air (empty)` };
  }

  const dominantRockId = getDominantRockId(v.composition);
  const rock = getRock(dominantRockId);
  const rockName = rock ? rock.id : dominantRockId;
  const oreLines = Object.entries(v.oreDensities)
    .map(([id, d]) => {
      const ore = getOre(id);
      return `  ${ore ? ore.id : id}: ${(d * 100).toFixed(0)}%`;
    });
  const oreStr = oreLines.length > 0 ? '\nOres:\n' + oreLines.join('\n') : '\nOres: none';

  // Show composition breakdown
  const compStr = v.composition.rocks.length > 0
    ? v.composition.rocks.map(r => `${r.rockId} ${(r.coefficient * 100).toFixed(0)}%`).join(', ')
    : 'none';

  return {
    success: true,
    output: `(${x},${y},${z}): ${rockName} | composition: ${compStr} | density: ${v.density} | fracture mod: ${v.fractureModifier}${oreStr}`,
  };
}

export function terrainInfoCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state || !ctx.grid) {
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }

  const w = ctx.state.world!;
  let solidCount = 0;
  let airCount = 0;
  for (let x = 0; x < ctx.grid.sizeX; x++) {
    for (let z = 0; z < ctx.grid.sizeZ; z++) {
      for (let y = 0; y < ctx.grid.sizeY; y++) {
        const v = ctx.grid.getVoxel(x, y, z)!;
        if (v.density > 0) solidCount++;
        else airCount++;
      }
    }
  }

  return {
    success: true,
    output: [
      `Grid: ${w.sizeX}x${w.sizeY}x${w.sizeZ}`,
      `Mine type: ${ctx.state.mineType}`,
      `Seed: ${ctx.state.seed}`,
      `Solid voxels: ${solidCount}`,
      `Air voxels: ${airCount}`,
    ].join('\n'),
  };
}

/**
 * Builds (or reports the already-built) landscape map for the current game
 * — the first real trigger for `ensureLandscape`'s lazy build. Resolves
 * climateBias from the saved mine type, same as `newGameCommand`/`loadCommand`;
 * `mixedRockHardness` isn't persisted on GameState, so this always builds
 * the normal (non-mixed) strata profile even for a mixedRockHardness level —
 * a known limitation shared with `regenerateGrid`'s own load-path callers.
 */
export function landscapeInfoCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state || !ctx.grid || !ctx.state.world) {
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }

  const biome = getBiome(ctx.state.mineType);
  if (!biome) return { success: false, output: `Unknown mine type: "${ctx.state.mineType}".` };

  const { sizeX, sizeY, sizeZ } = ctx.state.world;
  const landscape = ensureLandscape(ctx, { seed: ctx.state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ });
  if (!landscape) return { success: false, output: 'Could not build landscape — no grid loaded.' };

  const { map } = landscape;
  return {
    success: true,
    output: [
      `Tiles: ${map.tiles.length}`,
      `Samples/tile: ${map.samplesPerTile}x${map.samplesPerTile}`,
      `Tile span: ${map.tileSpan}m, coarse step: ${map.coarseStep}m`,
      `Extent half: ${map.extentHalf}m`,
    ].join('\n'),
  };
}

export function surveyCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.grid) return { success: false, output: 'No game loaded. Use new_game first.' };

  const coords = (args[0] ?? '').split(',').map(Number);
  if (coords.length < 2 || coords.some(isNaN)) {
    return { success: false, output: 'Usage: survey x,z' };
  }
  const [x, z] = coords as [number, number];

  if (x < 0 || x >= ctx.grid.sizeX || z < 0 || z >= ctx.grid.sizeZ) {
    return {
      success: false,
      output: `Out of bounds: (${x},${z}). Grid is ${ctx.grid.sizeX}x${ctx.grid.sizeZ}.`,
    };
  }

  // Find surface (topmost solid voxel)
  let surfaceY = -1;
  for (let y = ctx.grid.sizeY - 1; y >= 0; y--) {
    const v = ctx.grid.getVoxel(x, y, z)!;
    if (v.density > 0) {
      surfaceY = y;
      break;
    }
  }

  if (surfaceY < 0) {
    return { success: true, output: `Survey at (${x},${z}): No solid ground.` };
  }

  const v = ctx.grid.getVoxel(x, surfaceY, z)!;
  const dominantRockId = getDominantRockId(v.composition);
  const rock = getRock(dominantRockId);
  const rockName = rock ? rock.id : dominantRockId;
  const oreLines = Object.entries(v.oreDensities)
    .map(([id, d]) => `${id}: ${(d * 100).toFixed(0)}%`);
  const oreStr = oreLines.length > 0 ? oreLines.join(', ') : 'none';

  return {
    success: true,
    output: `Survey at (${x},${z}): ${rockName} at depth ${surfaceY}. Ores: ${oreStr}`,
  };
}
