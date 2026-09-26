// BlastSimulator2026 — Console commands for world creation and inspection

import type { CommandResult } from '../ConsoleRunner.js';
import { createGame, buildGameNavGrid, snapAgentsToNavigableGround, syncWorldBounds, createWorldState, type GameState, type WorldState } from '../../core/state/GameState.js';
import { placeStartingCrew } from '../../core/state/SpawnPlacement.js';
import { getBiome, getAllBiomes } from '../../core/world/BiomeCatalog.js';
import { generateTerrain, buildTerrainContext, TERRAIN_GENERATOR_VERSION, requireValidGenDimension, type TerrainConfig } from '../../core/world/TerrainGen.js';
import { PlayableArea } from '../../core/world/PlayableArea.js';
import { buildStructureSet, type StructureSet } from '../../core/world/Structures.js';
import { createLazyLandscapeMap, sampleLandscapeColumn, LADDER_STEPS, type LazyLandscapeMap } from '../../core/world/LandscapeMap.js';
import type { Rect } from '../../core/world/WorldGen.js';
import { getRock } from '../../core/world/RockCatalog.js';
import { getOre } from '../../core/world/OreCatalog.js';
import { getDominantRockId, computeVoxelColumnSurfaceY, computeColumnRangeY } from '../../core/world/VoxelGrid.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';
import { decodeVoxelGrid, encodeVoxelGrid, type SerializedVoxels, type SerializedTerrainGen } from '../../core/state/VoxelGridCodec.js';
import { DEFAULT_GRID_SIZE } from '../../core/config/balance.js';
import { sanitizeFiniteOverride, parseStaffedFlag, staffedSuffix } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';
import { regionForColumns, type NavGridSyncTarget } from '../../core/nav/NavGridSync.js';

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

/**
 * The size + hardness fields `TerrainConfig` and `regenerateGrid`'s params
 * share, read from a `WorldState`'s own base (level-original) size rather
 * than its live, possibly site-expanded one — takes only the `WorldState`
 * slice it reads, not the whole `GameState`, since neither caller below
 * needs anything else off it (#1181 review — shared by `terrainConfigOf`
 * and `regenerateGridParams`, which otherwise built this same shape from
 * the same three fields independently).
 */
/**
 * TODO(#1191): WorldState doesn't carry the datum yet, only sizeY. #1191
 * threads the datum through WorldState/levels directly and this goes away.
 */
function datumFromSizeY(sizeY: number): number {
  return Math.floor(sizeY * 0.55);
}

function worldSizeParams(world: WorldState): { sizeX: number; datum: number; sizeZ: number; mixedRockHardness?: boolean } {
  return {
    sizeX: world.baseSizeX,
    datum: datumFromSizeY(world.sizeY),
    sizeZ: world.baseSizeZ,
    ...(world.mixedRockHardness !== undefined ? { mixedRockHardness: world.mixedRockHardness } : {}),
  };
}

/** The terrain config a game's grid was generated from — the datum every later chunk is generated against (#473 D3). */
export function terrainConfigOf(state: GameState): TerrainConfig | null {
  if (!state.world) return null;
  const biome = getBiome(state.mineType);
  if (!biome) return null;
  return {
    seed: state.seed,
    climateBias: biome.climateCenter,
    ...worldSizeParams(state.world),
  };
}

/**
 * The generation datum to embed in a save (#1181) — the complete generator
 * identity `decodeVoxelGrid` regenerates pristine terrain from. Undefined
 * when the state carries no world or an unknown mine type.
 */
function terrainGenDatum(state: GameState): SerializedTerrainGen | undefined {
  const config = terrainConfigOf(state);
  if (!config) return undefined;
  return {
    version: TERRAIN_GENERATOR_VERSION,
    seed: config.seed,
    climateBias: config.climateBias as [number, number],
    sizeX: config.sizeX,
    datum: config.datum,
    sizeZ: config.sizeZ,
    ...(config.mixedRockHardness !== undefined ? { mixedRockHardness: config.mixedRockHardness } : {}),
  };
}

/**
 * The params `regenerateGrid`'s size/hardness fields should carry for a
 * no-voxels load fallback — the level's ORIGINAL base size (#1181, fixing a
 * pre-#1181 defect where that fallback regenerated at the live, possibly
 * site-expanded size instead).
 *
 * `state.world`'s size fields come straight off untrusted save JSON (unlike
 * the default-size branch above, a trusted constant), so each is checked
 * with `requireValidGenDimension` before it can reach `generateTerrain` —
 * the same guard `decodeVoxelGrid` (VoxelGridCodec.ts) applies to its own
 * embedded generator identity, closing the sibling gap on this no-voxels
 * fallback path (#1218). Throws; `loadGridForState`'s surrounding try/catch
 * turns that into a clean `world.terrain_save_corrupt` refusal and rolls
 * `ctx` back.
 */
function regenerateGridParams(state: GameState): { sizeX: number; sizeY: number; sizeZ: number; mixedRockHardness?: boolean } {
  if (!state.world) {
    return { sizeX: DEFAULT_GRID_SIZE, sizeY: DEFAULT_GRID_SIZE, sizeZ: DEFAULT_GRID_SIZE };
  }
  const world = state.world;
  return {
    sizeX: requireValidGenDimension(world.baseSizeX, 'world.baseSizeX'),
    sizeY: requireValidGenDimension(world.sizeY, 'world.sizeY'),
    sizeZ: requireValidGenDimension(world.baseSizeZ, 'world.baseSizeZ'),
    ...(world.mixedRockHardness !== undefined ? { mixedRockHardness: world.mixedRockHardness } : {}),
  };
}

/**
 * A player-facing refusal message when `voxels` can't be loaded — either its
 * embedded generator version doesn't match this build's
 * `TERRAIN_GENERATOR_VERSION`, or the payload itself is malformed (missing
 * `gen`, wrong `v`) — or null when the version matches and the save may load.
 *
 * `voxels` is `deserialize`'s cast of parsed save JSON — untrusted, despite
 * the `SerializedVoxels` type — so `voxels.v`/`voxels.gen` are checked
 * before ever touching `.gen.version`. The malformed-payload branch gets its
 * own `world.terrain_save_corrupt` copy rather than reusing
 * `world.terrain_version_mismatch` with a placeholder `saved: -1` — that
 * reuse read as a real (bogus) generator version ("v-1") instead of "this
 * file is corrupt" (#1181 review).
 */
function terrainVersionMismatch(voxels: SerializedVoxels): string | null {
  if (voxels.v !== 8 || !voxels.gen || typeof voxels.gen.version !== 'number') {
    return t('world.terrain_save_corrupt');
  }
  if (voxels.gen.version === TERRAIN_GENERATOR_VERSION) return null;
  return t('world.terrain_version_mismatch', { saved: voxels.gen.version, current: TERRAIN_GENERATOR_VERSION });
}

/** The whole site, as a terrain:updated region. */
function gridDirtyRegion(grid: VoxelGrid): {
  minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number;
} {
  return regionForColumns(
    { minX: grid.minX, maxX: grid.maxX - 1, minZ: grid.minZ, maxZ: grid.maxZ - 1 },
    grid,
  );
}

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
  const datum = datumFromSizeY(sizeY);
  const config: TerrainConfig = {
    sizeX, datum, sizeZ, seed, climateBias,
    ...(mixedRockHardness !== undefined ? { mixedRockHardness } : {}),
  };
  if (ctx.state.world && mixedRockHardness !== undefined) {
    ctx.state.world.mixedRockHardness = mixedRockHardness;
  }
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
    sizeX: number; datum: number; sizeZ: number;
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
 * Restore `ctx.grid` from an already-decoded voxel grid, preserving actual
 * terrain mutations — blast craters, ramps — instead of discarding them the
 * way `regenerateGrid`'s from-seed path does. Mirrors `regenerateGrid`'s
 * navgrid-build and event-emission steps exactly; only the grid's origin
 * (decoded vs. freshly generated) differs (#458 T0.3).
 *
 * Takes an already-decoded `VoxelGrid` rather than the raw
 * `SerializedVoxels` payload: `loadGridForState` below decodes (and
 * validates) the payload *before* touching `ctx` at all, so nothing this
 * function does can throw partway through an already-mutated `ctx` (#1181
 * review — `decodeVoxelGrid` throws on malformed edit/composition/size data,
 * and that used to happen here, after `ctx.state` was already swapped).
 */
function restoreGrid(ctx: GameContext, grid: VoxelGrid): void {
  if (!ctx.state) return;
  ctx.grid = grid;
  ctx.landscape = null; // stale for the restored grid — rebuilt lazily by ensureLandscape() (#458 T2.1)
  const config = terrainConfigOf(ctx.state);
  ctx.playableArea = config ? new PlayableArea(ctx.grid, config) : null;
  syncWorldBounds(ctx.state, ctx.grid);
  buildGameNavGrid(ctx.state, ctx.grid, ctx.state.buildings.buildings, ctx.state.drillHoles);
  ctx.emitter.emit('terrain:updated', { region: gridDirtyRegion(ctx.grid) });
}

/**
 * Load `state`'s grid into `ctx`, sharing the version-check +
 * restore/regenerate branch every load path needs — `regenerateGrid`'s own
 * doc comment already warns this branch "must stay in sync" across call
 * sites (#408); `loadCommand` (saveload.ts) and the Saves modal's load
 * handler (main.ts) previously each wrote it out independently, which is
 * exactly the drift that comment warns about (#1181 review). Returns a
 * player-facing refusal message and leaves `ctx.state` untouched when the
 * save can't load (unknown mine type, or a terrain-generator version
 * mismatch); returns null and assigns `ctx.state = state` on success. Each
 * call site only differs in how it reports a non-null result (command-result
 * output vs. a UI notify toast).
 *
 * `ctx.state`/`ctx.grid`/`ctx.playableArea`/`ctx.landscape` are left exactly
 * as they were on every refusal path, including one only `decodeVoxelGrid`
 * (or the restore/regenerate step itself) can detect — a malformed edit
 * segment, an invalid composition, or a generator identity outside
 * `MAX_TERRAIN_GEN_DIMENSION`. `decodeVoxelGrid` runs *before* `ctx.state` is
 * touched so its own throws never see a mutated `ctx`; the assign +
 * restore/regenerate step that follows is still wrapped in try/catch and
 * rolls `ctx` back on any other failure, so a corrupt save can never leave a
 * half-swapped `GameContext` — new `state` with the old `grid`/`playableArea`
 * still pointing at the previous game (#1181 review).
 */
export function loadGridForState(ctx: GameContext, state: GameState): string | null {
  const biome = getBiome(state.mineType);
  if (!biome) {
    // Plain dev string, not `world.unknown_mine_type` (which is
    // `newGameCommand`'s i18n'd validation of a player-*typed* mine_type
    // argument) — a saved state whose own `mineType` fails `getBiome` means
    // the save itself is corrupt, the same low-probability edge
    // `terrainVersionMismatch` reuses non-i18n copy for elsewhere in this
    // file (#1181 review).
    return `Save has unknown mine type "${state.mineType}".`;
  }

  if (state.world?.voxels) {
    const mismatch = terrainVersionMismatch(state.world.voxels);
    if (mismatch) return mismatch;
  }

  let decodedGrid: VoxelGrid | null = null;
  if (state.world?.voxels) {
    try {
      decodedGrid = decodeVoxelGrid(state.world.voxels);
    } catch {
      return t('world.terrain_save_corrupt');
    }
  }

  const prevState = ctx.state;
  const prevGrid = ctx.grid;
  const prevLandscape = ctx.landscape;
  const prevPlayableArea = ctx.playableArea;
  try {
    ctx.state = state;
    if (decodedGrid) {
      restoreGrid(ctx, decodedGrid);
    } else {
      const { sizeX, sizeY, sizeZ, mixedRockHardness } = regenerateGridParams(state);
      regenerateGrid(ctx, {
        seed: state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ,
        ...(mixedRockHardness !== undefined ? { mixedRockHardness } : {}),
      });
    }
  } catch {
    ctx.state = prevState;
    ctx.grid = prevGrid;
    ctx.landscape = prevLandscape;
    ctx.playableArea = prevPlayableArea;
    return t('world.terrain_save_corrupt');
  }
  return null;
}

/**
 * The generation datum + encoded voxel payload to embed into `state.world`
 * right before a save is taken (#1181 review) — `saveCommand` (saveload.ts)
 * and `main.ts`'s `savesModal.setGetState` each independently computed this
 * (`terrainGenDatum` + the `ctx.grid && state.world && gen` guard +
 * `encodeVoxelGrid`'s spread), the save-side mirror of the exact duplication
 * `loadGridForState` above was extracted to fix on the load side. Returns
 * `state.world` unchanged when there is no grid, no world, or no resolvable
 * generator identity to embed.
 */
export function embedVoxelsForSave(ctx: GameContext, state: GameState): GameState['world'] {
  const gen = terrainGenDatum(state);
  if (!ctx.grid || !state.world || !gen) return state.world;
  return { ...state.world, voxels: encodeVoxelGrid(ctx.grid, gen) };
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

  if (!ctx.grid.containsColumn(x, z)) {
    return {
      success: false,
      output: t('world.inspect_off_site', {
        x, y, z,
        minX: ctx.grid.minX, minZ: ctx.grid.minZ,
        maxX: ctx.grid.maxX - 1, maxZ: ctx.grid.maxZ - 1,
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

/**
 * Format `computeColumnRangeY`'s result as the `terrain_info` "Vertical
 * extent" report line — `null` (no column in the site has ground) reports
 * "no ground" rather than a bogus `minY to maxY` (#1187).
 */
export function formatVerticalExtent(range: { minY: number; maxY: number } | null): string {
  if (!range) return 'Vertical extent: no ground';
  return `Vertical extent: ${range.minY} to ${range.maxY}`;
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
  // Real vertical extent of ground across the site, not 0..sizeY — the grid
  // has no vertical cap (#1187). Null (no ground anywhere) means no scan.
  const range = computeColumnRangeY(grid, grid.minX, grid.maxX - 1, grid.minZ, grid.maxZ - 1);
  if (range) {
    // Walks the live bounding box, not 0..size: the site starts wherever play
    // has taken it, and columns inside the box it does not own are skipped
    // rather than counted as air (#473).
    for (let x = grid.minX; x < grid.maxX; x++) {
      for (let z = grid.minZ; z < grid.maxZ; z++) {
        if (!grid.containsColumn(x, z)) continue;
        for (let y = range.minY; y <= range.maxY; y++) {
          if (grid.densityAt(x, y, z) > 0) solidCount++;
          else airCount++;
        }
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
      formatVerticalExtent(range),
    ].join('\n'),
  };
}

/**
 * Builds (or reports the already-built) landscape map for the current game
 * — the first real trigger for `ensureLandscape`'s lazy build. Config comes
 * from `terrainConfigOf`, the level's original base size (#1188) — not
 * `ctx.state.world`'s live, possibly site-expanded size, which would cut the
 * landscape against the wrong pit-mask rect if this command runs after an
 * expansion.
 */
export function landscapeInfoCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state || !ctx.grid || !ctx.state.world) {
    return { success: false, output: t('console.no_game_loaded') };
  }

  const config = terrainConfigOf(ctx.state);
  if (!config) return { success: false, output: t('world.landscape_unknown_mine_type', { mineType: ctx.state.mineType }) };

  const landscape = ensureLandscape(ctx, config);
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

  // Find surface (topmost solid voxel) — the grid has no vertical cap, so
  // this is not a bounded scan (#1187).
  const surfaceY = computeVoxelColumnSurfaceY(ctx.grid, x, z);

  if (surfaceY === null) {
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
