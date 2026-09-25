// BlastSimulator2026 — Console commands for world creation and inspection

import type { CommandResult } from '../ConsoleRunner.js';
import { createGame, buildGameNavGrid, snapAgentsToNavigableGround, syncWorldBounds, createWorldState, type GameState } from '../../core/state/GameState.js';
import { placeStartingCrew } from '../../core/state/SpawnPlacement.js';
import { getBiome, getAllBiomes } from '../../core/world/BiomeCatalog.js';
import { generateTerrain, buildTerrainContext, type TerrainConfig } from '../../core/world/TerrainGen.js';
import { PlayableArea } from '../../core/world/PlayableArea.js';
import { buildStructureSet, type StructureSet } from '../../core/world/Structures.js';
import { createLazyLandscapeMap, sampleLandscapeColumn, LADDER_STEPS, type LazyLandscapeMap } from '../../core/world/LandscapeMap.js';
import type { Rect } from '../../core/world/WorldGen.js';
import { getRock } from '../../core/world/RockCatalog.js';
import { getOre } from '../../core/world/OreCatalog.js';
import { getDominantRockId } from '../../core/world/VoxelGrid.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';
import { decodeVoxelGrid, type SerializedVoxels, type SerializedTerrainGen } from '../../core/state/VoxelGridCodec.js';
import { DEFAULT_GRID_SIZE } from '../../core/config/balance.js';
import { sanitizeFiniteOverride, parseStaffedFlag, staffedSuffix } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';
import type { NavGridSyncTarget } from '../../core/nav/NavGridSync.js';

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
  map: LazyLandscapeMap;
  playableRect: Rect;
  sampleColumn(x: number, z: number): { height: number; biomeId: number; surfCompId: number };
  /** Ground mean world-y (`groundOffset + centerHeight`) — the aerial-perspective pass's height reference for "thick in valleys, thin on peaks" (#458 T5.2/A21). */
  groundLevelY: number;
  /** Rivers, villages (chimney positions), trees, and landmarks (crater lakes) — the ambient layer's placement data (#458 T7.2/D12/A26). */
  structureSet: StructureSet;
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
  /**
   * The site's claimed-chunk set (#473). Owns every expansion: an action past
   * the site edge asks this to claim the ground first, and takes its refusal
   * as the answer. Null until a grid exists.
   */
  playableArea: PlayableArea | null;
  /** Event emitter for game-over and campaign events. Listeners attached in main.ts/console.ts. */
  emitter: EventEmitter;
}

/**
 * Build the live `NavGridSyncTarget` for `ctx`'s current game, or null when
 * no game (or no navGrid/grid yet) exists. Shared by createRunner.ts's
 * production wiring and tests/helpers/gameContext.ts's fixture wiring
 * (#1146) so both `subscribeNavGridToUpdates` call sites read `ctx`
 * fresh through one place instead of each hand-rolling the same closure.
 */
export function buildNavGridSyncTarget(ctx: GameContext): NavGridSyncTarget | null {
  return ctx.state && ctx.state.navGrid && ctx.grid
    ? {
        navGrid: ctx.state.navGrid,
        grid: ctx.grid,
        buildings: ctx.state.buildings.buildings,
        drillHoles: ctx.state.drillHoles,
      }
    : null;
}

/** The terrain config a game's grid was generated from — the datum every later chunk is generated against (#473 D3). */
export function terrainConfigOf(state: GameState): TerrainConfig | null {
  if (!state.world) return null;
  const biome = getBiome(state.mineType);
  if (!biome) return null;
  return {
    seed: state.seed,
    climateBias: biome.climateCenter,
    sizeX: state.world.baseSizeX,
    sizeY: state.world.sizeY,
    sizeZ: state.world.baseSizeZ,
  };
}

/**
 * The generation datum to embed in a save (#1181) — the complete generator
 * identity `decodeVoxelGrid` regenerates pristine terrain from. Undefined
 * when the state carries no world or an unknown mine type.
 */
export function terrainGenDatum(_state: GameState): SerializedTerrainGen | undefined {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * The params `regenerateGrid`'s size/hardness fields should carry for a
 * no-voxels load fallback — the level's ORIGINAL base size (#1181, fixing a
 * pre-#1181 defect where that fallback regenerated at the live, possibly
 * site-expanded size instead).
 */
export function regenerateGridParams(_state: GameState): { sizeX: number; sizeY: number; sizeZ: number; mixedRockHardness?: boolean } {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * A player-facing refusal message when `voxels`' embedded generator version
 * doesn't match this build's `TERRAIN_GENERATOR_VERSION`, or null when they
 * match and the save may load.
 */
export function terrainVersionMismatch(_voxels: SerializedVoxels): string | null {
  // TODO: implement
  throw new Error('not implemented');
}

/** The whole site, as a terrain:updated region. */
function gridDirtyRegion(grid: VoxelGrid): {
  minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number;
} {
  return {
    minX: grid.minX, minY: 0, minZ: grid.minZ,
    maxX: grid.maxX - 1, maxY: grid.sizeY - 1, maxZ: grid.maxZ - 1,
  };
}

/** Re-exported so existing importers of `./world.js` keep working (#504 moved the source of truth to core/config/balance.js). */
export { DEFAULT_GRID_SIZE };

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
    /**
     * True only where this grid is a game's first (`new_game`, a campaign
     * level start, `sandbox`): the starting crew is then laid out on real
     * ground through `placeStartingCrew` (#1166). A save load reaches the
     * same function with crew positions that are the save's own — mid-shift,
     * mid-route, wherever the player left them — and must never be regrouped.
     */
    startingCrew?: boolean;
  },
): void {
  if (!ctx.state) return;
  const { seed, climateBias, sizeX, sizeY, sizeZ, mixedRockHardness } = params;
  const config: TerrainConfig = {
    sizeX, sizeY, sizeZ, seed, climateBias,
    ...(mixedRockHardness !== undefined ? { mixedRockHardness } : {}),
  };
  ctx.grid = generateTerrain(config);
  ctx.landscape = null; // stale for the new grid — rebuilt lazily by ensureLandscape() (#458 T2.1)
  ctx.playableArea = new PlayableArea(ctx.grid, config);
  syncWorldBounds(ctx.state, ctx.grid);
  buildGameNavGrid(ctx.state, ctx.grid, ctx.state.buildings.buildings, ctx.state.drillHoles);
  // Terrain only exists now, so this is the first moment a spawn point picked
  // blind (staffed roster, campaign level literals) can be checked against it.
  // On a game's first grid the whole crew is regrouped onto one patch of
  // mutually climb-connected ground (#1166); the navgrid is then rebuilt
  // because the vehicles carried their own `vehicleOccupied` cells with them.
  // Everywhere else — a save load — only genuinely stranded agents move.
  if (params.startingCrew && placeStartingCrew(ctx.state)) {
    buildGameNavGrid(ctx.state, ctx.grid, ctx.state.buildings.buildings, ctx.state.drillHoles);
  }
  snapAgentsToNavigableGround(ctx.state);
  ctx.emitter.emit('terrain:updated', { region: gridDirtyRegion(ctx.grid) });
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
  const map = createLazyLandscapeMap(worldGen, params.climateBias, structureSet, strata, palette);

  ctx.landscape = {
    map,
    playableRect: worldGen.playableRect,
    sampleColumn: (x, z) => sampleLandscapeColumn(worldGen, params.climateBias, structureSet, strata, palette, x, z),
    groundLevelY: worldGen.groundOffset + worldGen.centerHeight,
    structureSet,
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
  const config = terrainConfigOf(ctx.state);
  ctx.playableArea = config ? new PlayableArea(ctx.grid, config) : null;
  syncWorldBounds(ctx.state, ctx.grid);
  buildGameNavGrid(ctx.state, ctx.grid, ctx.state.buildings.buildings, ctx.state.drillHoles);
  ctx.emitter.emit('terrain:updated', { region: gridDirtyRegion(ctx.grid) });
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
    return { success: false, output: t('world.unknown_mine_type', { mineType, valid }) };
  }

  const size = named['size'] ? parseInt(named['size'], 10) : DEFAULT_GRID_SIZE;
  // sizeY defaults to the cubic size but can be given separately — levels at
  // the larger campaign sizes (#458 T6.1/D13) are not cubic, and console
  // testing at those aspect ratios shouldn't require a same-sized cube.
  const sizeY = named['size_y'] ? parseInt(named['size_y'], 10) : size;
  const startingCash = named['cash'] ? sanitizeFiniteOverride(parseInt(named['cash'], 10)) : undefined;

  const staffedFlag = parseStaffedFlag(named['staffed']);
  if (staffedFlag.error) {
    return { success: false, output: staffedFlag.error };
  }

  ctx.state = createGame({
    seed, mineType,
    ...(startingCash !== undefined ? { startingCash } : {}),
    ...(staffedFlag.staffed ? { staffed: true } : {}),
  });
  ctx.state.world = createWorldState(size, sizeY, size, true);
  regenerateGrid(ctx, { seed, climateBias: biome.climateCenter, sizeX: size, sizeY, sizeZ: size, startingCrew: true });

  return {
    success: true,
    output: t('world.new_game_success', {
      size, sizeY, mineType, seed,
      staffedSuffix: staffedSuffix(staffedFlag.staffed),
    }),
  };
}

export function inspectCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.grid) return { success: false, output: t('console.no_game_loaded') };

  const coords = (args[0] ?? '').split(',').map(Number);
  if (coords.length < 3 || coords.some(isNaN)) {
    return { success: false, output: t('world.inspect_usage') };
  }
  const [x, y, z] = coords as [number, number, number];

  if (!ctx.grid.isInBounds(x, y, z)) {
    return {
      success: false,
      output: t('world.inspect_off_site', {
        x, y, z,
        minX: ctx.grid.minX, minZ: ctx.grid.minZ,
        maxX: ctx.grid.maxX - 1, maxZ: ctx.grid.maxZ - 1,
        sizeY: ctx.grid.sizeY,
      }),
    };
  }

  const v = ctx.grid.getVoxel(x, y, z)!;
  if (v.density === 0) {
    return { success: true, output: t('world.inspect_air', { x, y, z }) };
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
    output: t('world.inspect_result', {
      x, y, z, rockName, compStr,
      density: v.density,
      fractureModifier: v.fractureModifier,
      oreStr,
    }),
  };
}

export function terrainInfoCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state || !ctx.grid) {
    return { success: false, output: t('console.no_game_loaded') };
  }

  const w = ctx.state.world!;
  const grid = ctx.grid;
  let solidCount = 0;
  let airCount = 0;
  // Walks the live bounding box, not 0..size: the site starts wherever play
  // has taken it, and columns inside the box it does not own are skipped
  // rather than counted as air (#473).
  for (let x = grid.minX; x < grid.maxX; x++) {
    for (let z = grid.minZ; z < grid.maxZ; z++) {
      if (!grid.containsColumn(x, z)) continue;
      for (let y = 0; y < grid.sizeY; y++) {
        if (grid.densityAt(x, y, z) > 0) solidCount++;
        else airCount++;
      }
    }
  }

  return {
    success: true,
    output: [
      `Site: ${w.sizeX}x${w.sizeY}x${w.sizeZ} from (${grid.minX}, ${grid.minZ})`,
      `Level size: ${w.baseSizeX}x${w.baseSizeZ}`,
      `Claimed chunks: ${grid.chunkCount}`,
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
    return { success: false, output: t('console.no_game_loaded') };
  }

  const biome = getBiome(ctx.state.mineType);
  if (!biome) return { success: false, output: t('world.landscape_unknown_mine_type', { mineType: ctx.state.mineType }) };

  const { sizeX, sizeY, sizeZ } = ctx.state.world;
  const landscape = ensureLandscape(ctx, { seed: ctx.state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ });
  if (!landscape) return { success: false, output: t('world.landscape_build_failed') };

  const { map } = landscape;
  return {
    success: true,
    output: [
      `Ladder steps (m): ${LADDER_STEPS.join(', ')}`,
      `Cached chunks: ${map.cachedChunkIds.length}`,
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

  if (!ctx.grid.containsColumn(x, z)) {
    return {
      success: false,
      output: `Off site: (${x},${z}). The site spans (${ctx.grid.minX},${ctx.grid.minZ}) to (${ctx.grid.maxX - 1},${ctx.grid.maxZ - 1}).`,
    };
  }

  // Find surface (topmost solid voxel)
  let surfaceY = -1;
  for (let y = ctx.grid.sizeY - 1; y >= 0; y--) {
    if (ctx.grid.densityAt(x, y, z) > 0) {
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
