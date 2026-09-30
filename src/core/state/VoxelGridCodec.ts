// BlastSimulator2026 — Voxel grid save serialization (#458 T0.3, #473 P3, #1180, #1181)
// A save embeds two things, never dense chunk data: the complete generator
// identity terrain was produced from (`SerializedTerrainGen`) and the edit
// record of everything play changed since generation (`VoxelGrid.edits`,
// #1180's `TerrainEdits`). Loading regenerates pristine terrain from the
// generator identity, then replays the edit record on top — reproducing the
// live grid voxel for voxel without saving every voxel's full state (#1181).

import { VoxelGrid, clampAxis, isValidVoxelY, type VoxelRockComposition } from '../world/VoxelGrid.js';
import type { EditSegment, EditBoundary } from '../world/TerrainEdits.js';
import { createChunkSource, buildTerrainContext, TERRAIN_GENERATOR_VERSION, requireValidGenDimension, requireValidGenDatum, type TerrainConfig } from '../world/TerrainGen.js';

/**
 * The complete generator identity a save's terrain is regenerated from —
 * every field generation reads, plus the version of the generator that
 * produced it. `sizeX`/`sizeZ` are the level's ORIGINAL dimensions, not the
 * site's current bounding box: they fix the pit mask's rect and the
 * vertical datum, so a chunk claimed after ten hours of play generates
 * against the same world the first chunk did.
 */
export interface SerializedTerrainGen {
  version: number;
  seed: number;
  climateBias: [number, number];
  sizeX: number;
  datum: number;
  sizeZ: number;
  mixedRockHardness?: boolean;
}

export interface SerializedVoxels {
  v: 8;
  gen: SerializedTerrainGen;
  /** Claimed chunks, as [cx, cz, minX, minZ, maxX, maxZ]. Regenerated from `gen` on load, then the edit record below is replayed on top. */
  claimed: Array<[cx: number, cz: number, minX: number, minZ: number, maxX: number, maxZ: number]>;
  editColumns: Array<{ x: number; z: number; segments: EditSegment[] }>;
  editFractures: Array<{ x: number; y: number; z: number; modifier: number }>;
}

/**
 * Thrown by `decodeVoxelGrid` when a save's embedded generator version
 * doesn't match the running build's `TERRAIN_GENERATOR_VERSION`. The game is
 * unreleased: a mismatched save is refused outright, never migrated
 * (project owner policy, #1181).
 */
export class TerrainGenVersionMismatchError extends Error {
  constructor(public readonly savedVersion: number, public readonly currentVersion: number) {
    super(`Save terrain generator v${savedVersion} does not match current generator v${currentVersion}.`);
  }
}

/**
 * Encode a grid's claimed-chunk set and edit record against the generator
 * identity it was produced from.
 */
export function encodeVoxelGrid(grid: VoxelGrid, gen: SerializedTerrainGen): SerializedVoxels {
  const claimed: SerializedVoxels['claimed'] = [];
  for (const { cx, cz } of grid.ownedChunks()) {
    const rect = grid.chunkRect(cx, cz);
    if (!rect) continue;
    claimed.push([cx, cz, rect.minX, rect.minZ, rect.maxX, rect.maxZ]);
  }

  const editColumns = grid.edits.columns().map(({ x, z, segments }) => ({ x, z, segments: [...segments] }));
  const editFractures = grid.edits.fractureEntries();

  return { v: 8, gen, claimed, editColumns, editFractures };
}

/**
 * Clamp an untrusted save-JSON x/z position into the grid's owned bounds —
 * the same treatment `clampChunkRectToTile` gives a chunk rect (#609).
 * Horizontal only: a y is never clamped, because every y inside
 * `MAX_VOXEL_ABS_Y` is a legitimate row (terrain has no floor or ceiling), so
 * clamping one would silently move a real edit — see `requireValidSaveY`.
 */
const clampSavePosition = clampAxis;

/**
 * An edit row read from untrusted save JSON: refused when it is not an
 * integer inside the grid's addressable vertical range. Rejected rather than
 * clamped — any in-range value is a real row, so the only thing clamping
 * could do is move a dig or a fill onto rock that was never touched.
 */
function requireValidSaveY(value: number, label: string): number {
  if (!isValidVoxelY(value)) {
    throw new Error(`corrupt save: ${label} (${value}) is not a valid voxel row`);
  }
  return value;
}

/**
 * True when `value` is a well-formed `VoxelRockComposition` — untrusted save
 * JSON must never reach `CompositionPalette.intern` (which dereferences
 * `.rocks` unconditionally) without this check, else a malformed
 * `{"kind":"added"}` segment throws a raw `TypeError` instead of a clean
 * refusal (#1181 review).
 */
function isValidComposition(value: unknown): value is VoxelRockComposition {
  if (typeof value !== 'object' || value === null) return false;
  const rocks = (value as { rocks?: unknown }).rocks;
  if (!Array.isArray(rocks)) return false;
  return rocks.every(r =>
    typeof r === 'object' && r !== null &&
    typeof (r as { rockId?: unknown }).rockId === 'string' &&
    typeof (r as { coefficient?: unknown }).coefficient === 'number',
  );
}

/**
 * Throws when `boundary` is present but malformed — its `composition` is
 * re-interned by `replayTerrainEdits` exactly like an 'added' segment's own
 * composition, and carries the same untrusted-save risk.
 */
function requireValidBoundary(boundary: EditBoundary | undefined, label: string): void {
  if (!boundary) return;
  if (typeof boundary.density !== 'number' || !Number.isFinite(boundary.density)) {
    throw new Error(`corrupt save: ${label} boundary has a non-finite density`);
  }
  if (!isValidComposition(boundary.composition)) {
    throw new Error(`corrupt save: ${label} boundary is missing a valid composition`);
  }
}

/**
 * Rebuild a grid from `payload.gen`'s generator identity: register ownership
 * of every claimed chunk and load `payload.editColumns`/`payload.editFractures`
 * into the grid's own edit record, then attach a `VoxelChunkSource` built
 * from that same identity (#1183) — no chunk's content is filled up front;
 * a claimed chunk's voxels materialize lazily, from the generator plus this
 * edit record, on whatever a caller actually reads. Throws
 * `TerrainGenVersionMismatchError` when `payload.gen.version` doesn't match
 * the running build's generator, or a plain `Error` when the payload's edit
 * data is malformed beyond what clamping can repair.
 */
export function decodeVoxelGrid(payload: SerializedVoxels): VoxelGrid {
  if (payload.v !== 8) {
    throw new Error(`unsupported save payload version: ${payload.v}`);
  }
  if (payload.gen.version !== TERRAIN_GENERATOR_VERSION) {
    throw new TerrainGenVersionMismatchError(payload.gen.version, TERRAIN_GENERATOR_VERSION);
  }

  const config: TerrainConfig = {
    sizeX: requireValidGenDimension(payload.gen.sizeX, 'gen.sizeX'),
    datum: requireValidGenDatum(payload.gen.datum, 'gen.datum'),
    sizeZ: requireValidGenDimension(payload.gen.sizeZ, 'gen.sizeZ'),
    seed: payload.gen.seed,
    climateBias: payload.gen.climateBias,
    ...(payload.gen.mixedRockHardness !== undefined ? { mixedRockHardness: payload.gen.mixedRockHardness } : {}),
  };

  // Empty at construction — every claimed chunk below is registered
  // explicitly, from the claimed rects the save recorded, not from
  // config.sizeX/sizeZ (a site-expanded save owns chunks past them). No
  // content is filled here (#1183): the attached chunk source materializes
  // each chunk lazily, from generation plus the edit record loaded below, on
  // whatever a caller actually reads.
  const grid = new VoxelGrid(0, 0);
  const terrain = buildTerrainContext(config);
  grid.attachChunkSource(createChunkSource(terrain, config));

  for (const [cx, cz, minX, minZ, maxX, maxZ] of payload.claimed) {
    grid.addChunkWithRect(cx, cz, { minX, minZ, maxX, maxZ });
  }

  // `grid.minX/maxX/minZ/maxZ` are set by the claimed-chunk loop above —
  // every x/z below is clamped against them, and every y is checked against
  // the grid's addressable vertical range, so a tampered/corrupted save can't
  // drive the (lazy, per-band) edit replay past the grid's real bounds
  // (#1181 review; matches #609's `clampChunkRectToTile` precedent for
  // `claimed` rects).
  for (const { x, z, segments } of payload.editColumns) {
    const cx = clampSavePosition(x, grid.minX, grid.maxX - 1, grid.minX);
    const cz = clampSavePosition(z, grid.minZ, grid.maxZ - 1, grid.minZ);
    for (const seg of segments) {
      const yLo = requireValidSaveY(seg.yLo, 'edit segment yLo');
      const yHi = requireValidSaveY(seg.yHi, 'edit segment yHi');
      if (yLo > yHi) {
        throw new Error(`corrupt save: edit segment yLo (${seg.yLo}) exceeds yHi (${seg.yHi})`);
      }
      requireValidBoundary(seg.bottomBoundary, 'bottom');
      requireValidBoundary(seg.topBoundary, 'top');
      if (seg.kind === 'added') {
        if (!isValidComposition(seg.composition)) {
          throw new Error('corrupt save: added edit segment is missing a valid composition');
        }
        grid.edits.recordAdd(cx, cz, yLo, yHi, seg.composition, seg.ores, seg.bottomBoundary, seg.topBoundary);
      } else {
        grid.edits.recordDig(cx, cz, yLo, yHi, seg.bottomBoundary, seg.topBoundary);
      }
    }
  }
  for (const { x, y, z, modifier } of payload.editFractures) {
    const fx = clampSavePosition(x, grid.minX, grid.maxX - 1, grid.minX);
    const fy = requireValidSaveY(y, 'edit fracture y');
    const fz = clampSavePosition(z, grid.minZ, grid.maxZ - 1, grid.minZ);
    grid.edits.recordFracture(fx, fy, fz, modifier);
  }

  return grid;
}
