// BlastSimulator2026 — 3D voxel grid for terrain representation
// SoA typed-array storage + a deduped rock-composition palette (#458 T0.1):
// eliminates the 3 heap objects/voxel the old array-of-objects layout paid
// even for air, which made grids beyond ~100 per side OOM-risk territory.
// Density and fracture stay Float64 (not the smaller Uint8 the plan sketched)
// so existing fractional-value round-trips stay bit-exact — the win here is
// object elimination, not field width, and the extra bytes are negligible
// against the layout this replaces.
// Voxel cell size: 1 m × 1 m × 1 m (SI units throughout). All grid
// coordinates are in metres, with each cell spanning exactly 1.0 m per axis.

import { TerrainEdits, oresDeepEqual, replaySegmentsInRange, boundaryAt, type EditBoundary } from './TerrainEdits';
import { SOLID_VOXEL_DENSITY_THRESHOLD } from '../config/balance';

export interface VoxelRockComposition {
  /** Up to N rock types with coefficients summing to 1.0. Empty for air. */
  rocks: Array<{ rockId: string; coefficient: number }>;
}

export interface VoxelData {
  /** Rock composition: up to 4 rock types with coefficients summing to 1.0. Empty array for air. */
  composition: VoxelRockComposition;
  /** 0 = empty/air, 1 = fully solid. */
  density: number;
  /** Map of ore_id → density (0.0–1.0). */
  oreDensities: Record<string, number>;
  /** Modifier on fracture threshold (1.0 = normal, < 1.0 = pre-cracked). */
  fractureModifier: number;
}

export interface RegionEntry {
  x: number;
  y: number;
  z: number;
  data: VoxelData;
}

/** Return the rock ID with the highest coefficient, or '' if composition is empty. */
export function getDominantRockId(composition: VoxelRockComposition): string {
  if (composition.rocks.length === 0) return '';
  let best = composition.rocks[0]!;
  for (let i = 1; i < composition.rocks.length; i++) {
    if (composition.rocks[i]!.coefficient > best.coefficient) {
      best = composition.rocks[i]!;
    }
  }
  return best.rockId;
}

/** Coefficients are quantized to the nearest 1/QUANTUM so equivalent blends dedupe in the palette. */
const QUANTUM = 100;

interface PaletteEntry {
  comp: VoxelRockComposition;
  dominantRockId: string;
}

/**
 * Dedupes rock compositions into a palette so voxels store a Uint16 index
 * instead of owning their own {rockId, coefficient}[] + wrapper object.
 * Entry 0 is reserved for air (empty composition). Every composition
 * returned by `get` is frozen and shared across every voxel with that exact
 * blend — treat it as immutable (#458 A8).
 */
const AIR_COMPOSITION: VoxelRockComposition = Object.freeze({
  rocks: Object.freeze([] as Array<{ rockId: string; coefficient: number }>),
}) as VoxelRockComposition;

export class CompositionPalette {
  private readonly entries: PaletteEntry[] = [
    { comp: AIR_COMPOSITION, dominantRockId: '' },
  ];
  private readonly keyToId = new Map<string, number>();

  /** Number of distinct compositions interned so far (including the reserved air entry at 0). */
  get size(): number {
    return this.entries.length;
  }

  /** Intern a composition, returning its palette index (0 for air / all-zero blends). */
  intern(composition: VoxelRockComposition): number {
    const quantized = composition.rocks
      .map(r => ({ rockId: r.rockId, coefficient: Math.round(r.coefficient * QUANTUM) / QUANTUM }))
      .filter(r => r.coefficient > 0)
      .sort((a, b) => (a.rockId < b.rockId ? -1 : a.rockId > b.rockId ? 1 : 0));

    if (quantized.length === 0) return 0;

    const key = quantized.map(r => `${r.rockId}:${r.coefficient}`).join('|');
    const existing = this.keyToId.get(key);
    if (existing !== undefined) return existing;

    if (this.entries.length >= 65536) {
      throw new Error('CompositionPalette overflow: more than 65535 distinct rock compositions in one grid.');
    }

    const rocks = quantized.map(r => Object.freeze({ rockId: r.rockId, coefficient: r.coefficient }));
    const comp = Object.freeze({ rocks: Object.freeze(rocks) }) as VoxelRockComposition;
    const id = this.entries.length;
    this.entries.push({ comp, dominantRockId: getDominantRockId(comp) });
    this.keyToId.set(key, id);
    return id;
  }

  /** Look up a palette entry by index. An out-of-range index resolves to the air entry (0). */
  get(id: number): PaletteEntry {
    return this.entries[id] ?? this.entries[0]!;
  }

  /** All interned compositions in index order (index 0 is always the reserved air entry). For save serialization. */
  toArray(): VoxelRockComposition[] {
    return this.entries.map(e => e.comp);
  }
}

/**
 * Voxels per chunk side on the horizontal axes (#473 D1). Matches
 * TerrainMesh's own `CHUNK_SIZE`, so one owned chunk maps 1:1 onto one mesh
 * chunk and a newly claimed chunk re-marches exactly one mesh.
 */
export const CHUNK_SIZE = 16;

/** Voxels in one cubic CHUNK_SIZE**3 slab (#1182) — shared by every `VoxelSlab` typed-array allocation below. */
const SLAB_VOLUME = CHUNK_SIZE ** 3;

/** Chunk index of a world coordinate. `>> 4` floors toward -inf, which is what signed coordinates need. */
export function chunkIndexOf(worldCoord: number): number {
  return Math.floor(worldCoord) >> 4;
}

/**
 * Clamp an untrusted save-JSON numeric value into `[lo, hi]`, rounding to the
 * nearest integer and falling back to `fallback` for non-finite input.
 * Shared by `clampChunkRectToTile` below (a chunk's owned rect) and
 * `VoxelGridCodec.ts`'s `clampSavePosition` (edit-segment positions) — both
 * clamp a save-JSON position field the same way, so this lives once rather
 * than twice (#1181 review).
 */
export function clampAxis(value: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

/**
 * Clamp a chunk's owned sub-rect to the chunk's own tile bounds — i.e. to
 * `[cx*CHUNK_SIZE, cx*CHUNK_SIZE + CHUNK_SIZE) × [cz*CHUNK_SIZE, cz*CHUNK_SIZE + CHUNK_SIZE)`.
 *
 * This is the one place untrusted save data (a chunk's `x0/z0/x1/z1` rect,
 * read straight from parsed JSON) gets validated before it reaches
 * `VoxelGrid` storage — every downstream consumer (TerrainMesh's marching
 * cubes loops, etc.) then only ever sees bounds already inside the tile, so
 * a corrupted/hand-edited save (e.g. a rect of `1e12`) can't turn a render
 * loop into an unbounded scan (#609).
 */
export function clampChunkRectToTile(
  cx: number, cz: number,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const tileX0 = cx * CHUNK_SIZE;
  const tileX1 = tileX0 + CHUNK_SIZE;
  const tileZ0 = cz * CHUNK_SIZE;
  const tileZ1 = tileZ0 + CHUNK_SIZE;

  let minX = clampAxis(rect.minX, tileX0, tileX1, tileX0);
  let maxX = clampAxis(rect.maxX, tileX0, tileX1, tileX1);
  let minZ = clampAxis(rect.minZ, tileZ0, tileZ1, tileZ0);
  let maxZ = clampAxis(rect.maxZ, tileZ0, tileZ1, tileZ1);

  if (maxX < minX) maxX = minX;
  if (maxZ < minZ) maxZ = minZ;

  return { minX, minZ, maxX, maxZ };
}

/**
 * One chunk of storage: a CHUNK_SIZE × CHUNK_SIZE column, plus the sub-rect
 * of it the site actually owns.
 *
 * `x0/z0/x1/z1` (max exclusive) exist because a site's *initial* rect is not
 * required to be a multiple of CHUNK_SIZE — a 24 m level occupies 2×2 chunks
 * but owns only 24 m of them. Every chunk claimed by expansion owns its full
 * span, and `growToFull` promotes a partial chunk when play reaches past it.
 *
 * Vertical storage is a sparse `Map` of lazily-allocated cubic 16×16×16
 * `VoxelSlab`s, one per y-band `cy = chunkIndexOf(y)` (#1182) — a column
 * claims memory proportional to how deep it was actually generated/dug,
 * rather than the grid's full declared `sizeY`. An absent entry reads as air
 * everywhere in that band; nothing allocates on a read.
 */
interface VoxelChunk {
  readonly cx: number;
  readonly cz: number;
  x0: number; z0: number; x1: number; z1: number;
  readonly slabs: Map<number, VoxelSlab>;
  /**
   * Ephemeral, per-column cache of `chunkSource`-only (no edits applied)
   * density, keyed by `cheapColumnKey(lx, lz, cy)` — backs `densityAt`'s
   * cheap dispatch so repeated cheap reads in the same column don't re-run
   * `VoxelChunkSource.materializeSlab` on a throwaway scratch grid every call
   * (#1183 fixer). Deliberately NOT part of `slabs`: never counted by
   * `allocatedSlabCount`/`slabCount`, and cleared (not preserved) by
   * `dropChunk` — it holds no gameplay state, only a memo of pure generator
   * output.
   */
  cheapDensity?: Map<number, Float64Array>;
}

/**
 * One lazily-allocated cubic 16×16×16 y-band of a chunk's column, keyed by
 * `cy = chunkIndexOf(y)` in `VoxelChunk.slabs`, allocated only when a write
 * would actually differ from the implicit air default (#1182).
 *
 * Not exported: internal storage detail of `VoxelGrid`, same as `VoxelChunk`
 * itself.
 */
interface VoxelSlab {
  density: Float64Array;   // SLAB_VOLUME entries
  compId: Uint16Array;
  fracture: Float64Array;  // filled 1.0 on allocation
  ores: Map<number, Record<string, number>>;
  touched: Uint8Array;     // 1 once a position has been written
  touchedCount: number;    // distinct positions written
  minDensity: number;      // seeded +Infinity
  maxDensity: number;      // seeded -Infinity
}

/** Packs a chunk coordinate pair into one collision-free numeric key. Range ±32768 chunks (±524 km). */
function chunkKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/**
 * Optional reporter for reads that fall outside every owned chunk (#473 §4).
 *
 * Out-of-range reads answer "air" rather than throwing, so a bound check
 * missed during the signed-coordinate migration looks like a hole in the
 * ground instead of a crash. Installing a reporter makes those reads
 * audible. Only consulted on the already-slow out-of-bounds branch, so an
 * in-bounds read pays nothing for this.
 *
 * Legitimate out-of-bounds reads exist by design (marching cubes marches one
 * cell past every side to seal the volume), so this is a diagnostic, never an
 * assertion that should be on in normal play.
 */
export type OutOfBoundsReporter = (x: number, y: number, z: number) => void;

let outOfBoundsReporter: OutOfBoundsReporter | null = null;

/** Install (or clear, with null) the out-of-bounds read reporter. Returns the previous one. */
export function setVoxelBoundsReporter(reporter: OutOfBoundsReporter | null): OutOfBoundsReporter | null {
  const previous = outOfBoundsReporter;
  outOfBoundsReporter = reporter;
  return previous;
}

/**
 * 3D grid of voxels stored as a map of chunks, each holding struct-of-arrays
 * typed arrays, plus a deduped composition palette (see `CompositionPalette`).
 * Coordinate system: x = east, y = up, z = north.
 * Each cell represents 1 m × 1 m × 1 m. All grid coordinates are in metres.
 *
 * World coordinates are **signed** (#473 D2): a site that expands west or
 * north has negative x/z. The chunk map is the site's ownership record —
 * a voxel is part of the site exactly when an owned chunk covers it — and
 * `minX/minZ/sizeX/sizeZ` describe the live bounding box of that set, which
 * moves as the site grows. Callers that only read and write voxels are
 * unaffected by the storage change; callers that iterate need to walk
 * `minX..maxX` rather than `0..sizeX`.
 */
/**
 * Materializes a chunk's terrain on first read, so a chunk is a cache of the
 * generator's output rather than the sole authority on it (#1183). A grid
 * with no attached source behaves exactly as before — every column reads
 * whatever was directly written to it, nothing more.
 */
export interface VoxelChunkSource {
  /** Continuous surface height at column (x, z), same datum as `computeVoxelColumnSurfaceHeight`. */
  surfaceHeightAt(x: number, z: number): number;
  /**
   * Fill `grid`'s voxels in `[x0, x1) × [z0, z1)` at y-band `cy`
   * (`chunkIndexOf(y) === cy`) from the generator, via `writeGeneratedVoxel`.
   */
  materializeSlab(grid: VoxelGrid, x0: number, x1: number, z0: number, z1: number, cy: number): void;
}

export class VoxelGrid {
  /** Size (in metres) of one voxel cell along each axis. Always 1.0 m. */
  static readonly CELL_SIZE = 1.0;

  /** Voxels per chunk side on x and z. Vertically, a chunk is a column of lazily-allocated CHUNK_SIZE-tall slabs (#1182), not full-height on y. */
  static readonly CHUNK_SIZE = CHUNK_SIZE;

  /** Unique ID for this grid instance — useful for debugging reference tracking. */
  static nextId = 1;
  readonly id = VoxelGrid.nextId++;

  readonly sizeY: number;
  readonly palette = new CompositionPalette();
  /** Log of edits made to this grid since generation — see `TerrainEdits`. */
  readonly edits: TerrainEdits;

  private readonly chunks = new Map<number, VoxelChunk>();
  /** Chunks whose contents have been written since generation — the save's dirty set (#473 D4). */
  private readonly dirty = new Set<number>();
  /** Generator + edit-record backing this grid's chunks, or null when nothing is attached (#1183). */
  private chunkSource: VoxelChunkSource | null = null;

  /** Live bounding box of the owned region, max exclusive. Empty grid reports a zero-size box at the origin. */
  private bMinX = 0;
  private bMinZ = 0;
  private bMaxX = 0;
  private bMaxZ = 0;

  /** Single-entry chunk lookup cache — meshing and navgrid scans walk x fastest, so they stay inside one chunk for long runs. */
  private cacheKey = -1;
  private cacheChunk: VoxelChunk | null = null;

  /**
   * Allocates the chunks covering `[0, sizeX) × [0, sizeZ)`, clipping the
   * edge chunks' owned rects to exactly that span. The signature is
   * unchanged from the dense implementation on purpose: every existing
   * caller keeps the same starting site, at the same coordinates, whether or
   * not its size divides by CHUNK_SIZE.
   */
  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeY = sizeY;
    this.edits = new TerrainEdits();
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) return;

    for (let cz = 0; cz < Math.ceil(sizeZ / CHUNK_SIZE); cz++) {
      for (let cx = 0; cx < Math.ceil(sizeX / CHUNK_SIZE); cx++) {
        const chunk = this.allocateChunk(cx, cz);
        chunk.x1 = Math.min(chunk.x1, sizeX);
        chunk.z1 = Math.min(chunk.z1, sizeZ);
      }
    }
    this.recomputeBounds();
  }

  // ── Live bounds of the owned region ──

  /** West edge of the bounding box, inclusive. */
  get minX(): number { return this.bMinX; }
  /** North edge of the bounding box, inclusive. */
  get minZ(): number { return this.bMinZ; }
  /** East edge of the bounding box, exclusive. */
  get maxX(): number { return this.bMaxX; }
  /** South edge of the bounding box, exclusive. */
  get maxZ(): number { return this.bMaxZ; }
  /** Width of the bounding box. NOT an upper bound on x — use `minX`/`maxX` to iterate. */
  get sizeX(): number { return this.bMaxX - this.bMinX; }
  /** Depth of the bounding box. NOT an upper bound on z — use `minZ`/`maxZ` to iterate. */
  get sizeZ(): number { return this.bMaxZ - this.bMinZ; }

  /** Number of chunks the site owns. */
  get chunkCount(): number { return this.chunks.size; }

  /**
   * True when (x, y, z) is a voxel the site can address at all — i.e. the
   * column is owned and y sits inside the grid's declared height.
   *
   * (#1182) Deliberately still sizeY-bounded, unlike the raw slab accessors
   * below (`densityAt` etc.): those accept y outside `[0, sizeY)` for an
   * owned column (reading air, writing only on a non-air value) without
   * allocating, but `isInBounds` keeps reporting the grid's own declared
   * vertical extent.
   */
  isInBounds(x: number, y: number, z: number): boolean {
    return this.containsColumn(x, z) && y >= 0 && y < this.sizeY;
  }

  /** True when the site owns the column at (x, z), regardless of height. */
  containsColumn(x: number, z: number): boolean {
    return this.ownerOf(x, 0, z) !== null;
  }

  /** The chunk covering (x, z) if the site has one, or null. Does not check the chunk's owned sub-rect. */
  private chunkAt(x: number, z: number): VoxelChunk | null {
    const key = chunkKey(chunkIndexOf(x), chunkIndexOf(z));
    if (key === this.cacheKey) return this.cacheChunk;
    const chunk = this.chunks.get(key) ?? null;
    this.cacheKey = key;
    this.cacheChunk = chunk;
    return chunk;
  }

  /**
   * The chunk that owns (x, y, z), or null.
   *
   * Deliberately returns the chunk rather than a {chunk, index} pair, and
   * leaves the index to `VoxelGrid.localIndex`: this runs once per corner per
   * marching-cubes cell, so allocating a wrapper object here would put a
   * short-lived object on the heap for every voxel the mesher reads.
   */
  private ownerOf(x: number, _y: number, z: number): VoxelChunk | null {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return null;
    if (x < chunk.x0 || x >= chunk.x1 || z < chunk.z0 || z >= chunk.z1) return null;
    return chunk;
  }

  /** Same as `ownerOf`, but reports the miss to the installed bounds reporter (reads only). */
  private ownerOfRead(x: number, y: number, z: number): VoxelChunk | null {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk && outOfBoundsReporter) outOfBoundsReporter(x, y, z);
    return chunk;
  }

  // ── Chunk ownership ──

  /** Chunk coordinates of every owned chunk. */
  ownedChunks(): Array<{ cx: number; cz: number }> {
    return [...this.chunks.values()].map(c => ({ cx: c.cx, cz: c.cz }));
  }

  /** True when the site owns chunk (cx, cz). */
  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  /** The owned sub-rect of chunk (cx, cz) (max exclusive), or null when unowned. */
  chunkRect(cx: number, cz: number): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return null;
    return { minX: chunk.x0, minZ: chunk.z0, maxX: chunk.x1, maxZ: chunk.z1 };
  }

  /** True when chunk (cx, cz) owns less than its full CHUNK_SIZE² span. */
  isChunkPartial(cx: number, cz: number): boolean {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    return chunk.x1 - chunk.x0 < CHUNK_SIZE || chunk.z1 - chunk.z0 < CHUNK_SIZE;
  }

  /**
   * Take ownership of chunk (cx, cz), returning the world rect that became
   * owned, or null when it was already fully owned. Storage is allocated but
   * left as air — the caller generates into it (#473 D3).
   */
  addChunk(cx: number, cz: number): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
    const existing = this.chunks.get(chunkKey(cx, cz));
    if (existing) return this.growToFull(existing);
    const chunk = this.allocateChunk(cx, cz);
    this.recomputeBounds();
    return { minX: chunk.x0, minZ: chunk.z0, maxX: chunk.x1, maxZ: chunk.z1 };
  }

  /**
   * Take ownership of chunk (cx, cz) with an explicit owned sub-rect, leaving
   * its storage as air. For save decode, which restores the exact rect a
   * partially owned edge chunk had at save time.
   */
  addChunkWithRect(cx: number, cz: number, rect: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const chunk = this.chunks.get(chunkKey(cx, cz)) ?? this.allocateChunk(cx, cz);
    const clamped = clampChunkRectToTile(cx, cz, rect);
    chunk.x0 = clamped.minX; chunk.z0 = clamped.minZ; chunk.x1 = clamped.maxX; chunk.z1 = clamped.maxZ;
    this.recomputeBounds();
  }

  /** Promote a partially owned chunk to its full span, returning the rect that became owned. */
  private growToFull(chunk: VoxelChunk): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
    const fullX1 = chunk.cx * CHUNK_SIZE + CHUNK_SIZE;
    const fullZ1 = chunk.cz * CHUNK_SIZE + CHUNK_SIZE;
    const fullX0 = chunk.cx * CHUNK_SIZE;
    const fullZ0 = chunk.cz * CHUNK_SIZE;
    if (chunk.x0 === fullX0 && chunk.z0 === fullZ0 && chunk.x1 === fullX1 && chunk.z1 === fullZ1) return null;
    chunk.x0 = fullX0; chunk.z0 = fullZ0; chunk.x1 = fullX1; chunk.z1 = fullZ1;
    this.recomputeBounds();
    return { minX: fullX0, minZ: fullZ0, maxX: fullX1, maxZ: fullZ1 };
  }

  /** Cheap: no array allocation. Slabs are allocated lazily, one per y-band, on the first differing write (#1182). */
  private allocateChunk(cx: number, cz: number): VoxelChunk {
    const chunk: VoxelChunk = {
      cx, cz,
      x0: cx * CHUNK_SIZE, z0: cz * CHUNK_SIZE,
      x1: cx * CHUNK_SIZE + CHUNK_SIZE, z1: cz * CHUNK_SIZE + CHUNK_SIZE,
      slabs: new Map(),
    };
    this.chunks.set(chunkKey(cx, cz), chunk);
    this.cacheKey = -1;
    this.cacheChunk = null;
    return chunk;
  }

  // ── Chunk source (materialize-on-read) (#1183) ──

  /** Attach the generator + edit-record source new/dropped chunk slabs materialize from. */
  attachChunkSource(source: VoxelChunkSource): void {
    this.chunkSource = source;
  }

  /**
   * Generator-only surface height at column (x, z) — `chunkSource`'s own
   * `surfaceHeightAt`, with no edit record applied. Undefined when no source
   * is attached (#1184).
   */
  generatorSurfaceHeightAt(x: number, z: number): number | undefined {
    return this.chunkSource?.surfaceHeightAt(x, z);
  }

  /** Discard chunk (cx, cz)'s materialized slabs, so its next read re-materializes from `chunkSource`. */
  dropChunk(cx: number, cz: number): void {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return;
    chunk.slabs.clear();
    chunk.cheapDensity?.clear();
    // The single-entry slab cache may point at a slab this just discarded.
    this.slabCacheKey = -1;
    this.slabCacheSlab = undefined;
  }

  private recomputeBounds(): void {
    if (this.chunks.size === 0) {
      this.bMinX = this.bMinZ = this.bMaxX = this.bMaxZ = 0;
      return;
    }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const chunk of this.chunks.values()) {
      if (chunk.x0 < minX) minX = chunk.x0;
      if (chunk.z0 < minZ) minZ = chunk.z0;
      if (chunk.x1 > maxX) maxX = chunk.x1;
      if (chunk.z1 > maxZ) maxZ = chunk.z1;
    }
    this.bMinX = minX; this.bMinZ = minZ; this.bMaxX = maxX; this.bMaxZ = maxZ;
  }

  // ── Per-chunk density summary (#560) ──

  /**
   * Conservative [min, max] density observed in chunk (cx, cz)'s y-slab
   * `slabIndex` (VoxelGrid's own CHUNK_SIZE-tall vertical banding, same
   * indexing as the storage slabs themselves — #1182 unified the two).
   * Widens monotonically on every voxel write in that slab, never narrowed
   * back down except on a full reload (#560). Returns null for an unowned
   * column; an owned column with no allocated slab at `slabIndex` (including
   * one past the grid's declared height) honestly reports `{min:0,max:0}`,
   * the same answer a fully-air allocated slab would give.
   */
  chunkDensityRange(cx: number, cz: number, slabIndex: number): { min: number; max: number } | null {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return null;
    const slab = chunk.slabs.get(slabIndex);
    if (!slab) {
      // Owned column, no resident slab — with a source attached, answer from
      // the cheap formula instead of the honest-but-wrong "all air" default
      // (#1183); with no source, unallocated genuinely means air, as before.
      return this.chunkSource ? this.cheapChunkDensityRange(chunk, slabIndex) : { min: 0, max: 0 };
    }
    if (slab.touchedCount >= VoxelGrid.slabVolume(chunk)) {
      // Every voxel in this slab has an explicit written value — no implicit
      // air left unaccounted for, so the true written min/max is exact.
      return { min: slab.minDensity, max: slab.maxDensity };
    }
    // Still some untouched positions in this slab — they're honestly air (0),
    // so fold that baseline in (density is always >= 0, so it never affects max).
    return { min: Math.min(0, slab.minDensity), max: Math.max(0, slab.maxDensity) };
  }

  /**
   * `chunkDensityRange`'s answer for a y-band with no allocated slab and an
   * attached `chunkSource` — a conservative [min, max] read straight from the
   * generator/edits without materializing the band into a slab (#1183).
   */
  private cheapChunkDensityRange(chunk: VoxelChunk, cy: number): { min: number; max: number } {
    const bandY0 = cy * CHUNK_SIZE;
    if (bandY0 >= this.sizeY) return { min: 0, max: 0 }; // entirely past the grid's declared vertical extent

    const bandY1 = bandY0 + CHUNK_SIZE - 1;

    // Any recorded edit anywhere in this band, for any column this chunk
    // owns, means the true content can't be answered from the generator
    // formula alone — never claim a false uniform result in that case.
    for (let z = chunk.z0; z < chunk.z1; z++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        for (const seg of this.edits.segmentsAt(x, z)) {
          if (seg.yLo <= bandY1 && seg.yHi >= bandY0) return { min: 0, max: 1 };
        }
      }
    }

    if (!this.chunkSource) return { min: 0, max: 0 };

    let minSurface = Infinity;
    let maxSurface = -Infinity;
    for (let z = chunk.z0; z < chunk.z1; z++) {
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const surfaceH = this.chunkSource.surfaceHeightAt(x, z);
        if (surfaceH < minSurface) minSurface = surfaceH;
        if (surfaceH > maxSurface) maxSurface = surfaceH;
      }
    }

    if (surfaceDensityAt(bandY1, minSurface) >= 1) return { min: 1, max: 1 }; // entirely solid
    if (surfaceDensityAt(bandY0, maxSurface) <= 0) return { min: 0, max: 0 }; // entirely air
    return { min: 0, max: 1 }; // straddles the surface somewhere in the band
  }

  // ── Cubic 16×16×16 slab storage (#1182) ──
  //
  // One lazily-allocated `VoxelSlab` per 16-row y-band, keyed by
  // `cy = chunkIndexOf(y)`, allocated only on a write that differs from the
  // implicit air default. A single-entry cache (below) keeps the common case
  // — repeated access to the same slab, as every hot-path scan exhibits — at
  // one `Map.get` instead of two.

  /** Allocate a fresh, all-air `VoxelSlab` (SLAB_VOLUME voxels). */
  private allocateSlab(): VoxelSlab {
    return {
      density: new Float64Array(SLAB_VOLUME),
      compId: new Uint16Array(SLAB_VOLUME),
      fracture: new Float64Array(SLAB_VOLUME).fill(1.0),
      ores: new Map(),
      touched: new Uint8Array(SLAB_VOLUME),
      touchedCount: 0,
      minDensity: Infinity,
      maxDensity: -Infinity,
    };
  }

  /** Single-entry slab lookup cache — same rationale as `cacheKey`/`cacheChunk` above, one level down. */
  private slabCacheKey = -1;
  private slabCacheSlab: VoxelSlab | undefined = undefined;

  /** Packs a chunk's coordinates and a y-band index into one collision-free numeric key for the slab cache. Valid for |cy| < 524288. */
  private static slabCacheKeyFor(chunk: VoxelChunk, cy: number): number {
    return chunkKey(chunk.cx, chunk.cz) * 1048576 + (cy + 524288);
  }

  /** The slab at chunk-local y-band `cy`, allocating one via `allocateSlab` if none exists yet. */
  private getOrCreateSlab(chunk: VoxelChunk, cy: number): VoxelSlab {
    let slab = chunk.slabs.get(cy);
    if (!slab) {
      slab = this.allocateSlab();
      chunk.slabs.set(cy, slab);
    }
    this.slabCacheKey = VoxelGrid.slabCacheKeyFor(chunk, cy);
    this.slabCacheSlab = slab;
    return slab;
  }

  /** The slab covering world y in `chunk`, or undefined if none has been allocated there. Never allocates. */
  private slabAt(chunk: VoxelChunk, y: number): VoxelSlab | undefined {
    const cy = chunkIndexOf(y);
    const key = VoxelGrid.slabCacheKeyFor(chunk, cy);
    if (key === this.slabCacheKey) return this.slabCacheSlab;
    const slab = chunk.slabs.get(cy);
    this.slabCacheKey = key;
    this.slabCacheSlab = slab;
    return slab;
  }

  /**
   * The slab covering world y in `chunk`, materializing it from `chunkSource`
   * (generator fill + replayed edits) on first read when a source is
   * attached and none exists yet — the read-side counterpart to `slabAt`,
   * which never allocates (#1183). Returns undefined when no source is
   * attached and no slab has been written directly.
   */
  private ensureSlab(chunk: VoxelChunk, y: number): VoxelSlab | undefined {
    const existing = this.slabAt(chunk, y);
    if (existing) return existing;
    if (!this.chunkSource) return undefined;
    return this.materializeSlabFromSource(chunk, chunkIndexOf(y));
  }

  /** Materialize chunk `chunk`'s y-band `cy` from `chunkSource`'s generator fill, then `replayEditsForBand` on top (#1183). */
  private materializeSlabFromSource(chunk: VoxelChunk, cy: number): VoxelSlab {
    // Allocate/register the (blank) slab FIRST — the generator fill below
    // writes into it via `writeGeneratedVoxel`, which requires the slab to
    // already be resident, and edit replay's own mutators resolve their
    // previous value through `ensureSlab`/`resolveCell`, which must see this
    // slab as already resident rather than recursing back into materialization.
    const slab = this.getOrCreateSlab(chunk, cy);
    const source = this.chunkSource;
    if (source) source.materializeSlab(this, chunk.x0, chunk.x1, chunk.z0, chunk.z1, cy);
    this.replayEditsForBand(chunk, cy);
    return slab;
  }

  /** Replay this grid's own `TerrainEdits` falling within y-band `cy` of `chunk`, on top of a freshly generator-filled slab (#1183). */
  private replayEditsForBand(chunk: VoxelChunk, cy: number): void {
    const yLo = cy * CHUNK_SIZE;
    const yHi = yLo + CHUNK_SIZE - 1;
    this.withoutEditRecording(() => {
      for (let z = chunk.z0; z < chunk.z1; z++) {
        for (let x = chunk.x0; x < chunk.x1; x++) {
          const segments = this.edits.segmentsAt(x, z);
          if (segments.length > 0) replaySegmentsInRange(this, segments, x, z, yLo, yHi);
          for (let y = yLo; y <= yHi; y++) {
            const modifier = this.edits.fractureAt(x, y, z);
            if (modifier !== undefined) this.setFractureAt(x, y, z, modifier);
          }
        }
      }
    });
  }

  /**
   * Resolve the slab covering (x, y, z) in `chunk`, its chunk-local y-band
   * `cy`, and the slab-local flat index `i` — the local index is pure
   * coordinate arithmetic, valid whether or not a slab is actually allocated
   * there, so every accessor and mutator that needs real rock/ore/previous-
   * value data shares this one lookup instead of re-deriving cy/i itself.
   *
   * The single choke point (#1183) for "give me a resident slab covering
   * (x, y, z)": routes through `ensureSlab`, which materializes from
   * `chunkSource` (generator fill + replayed edits) on first touch when one
   * is attached, or falls back to the pre-#1183 "no slab here" answer when
   * none is. A cheap read that must NOT materialize (`densityAt`,
   * `fractureAt`) does not use this — see `cheapDensityAt`/`editedDensityAt`.
   */
  private resolveCell(chunk: VoxelChunk, x: number, y: number, z: number): { slab: VoxelSlab | undefined; cy: number; i: number } {
    const cy = chunkIndexOf(y);
    const i = VoxelGrid.localIndex(chunk, cy, x, y, z);
    return { slab: this.ensureSlab(chunk, y), cy, i };
  }

  /**
   * The "previous value" every mutator (`fillVoxel`, `setVoxel`, `clearVoxel`,
   * `setFractureAt`, `scaleFractureAt`) reads before deciding whether a write
   * is a no-op: an absent slab (nothing allocated here yet) reads as the
   * implicit air default on every field, same as the accessors above.
   */
  private readCellDefaults(existing: VoxelSlab | undefined, i: number): {
    density: number; compId: number; ores: Record<string, number> | undefined; fracture: number;
  } {
    return {
      density: existing ? existing.density[i]! : 0,
      compId: existing ? existing.compId[i]! : 0,
      ores: existing ? existing.ores.get(i) : undefined,
      fracture: existing ? existing.fracture[i]! : 1.0,
    };
  }

  /** Slab-local flat index (0..4095) of (x, y, z) within the slab at chunk-local y-band `cy`. */
  private static localIndex(chunk: VoxelChunk, cy: number, x: number, y: number, z: number): number {
    const lx = x - chunk.cx * CHUNK_SIZE;
    const ly = y - cy * CHUNK_SIZE;
    const lz = z - chunk.cz * CHUNK_SIZE;
    return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
  }

  /** Voxel count of the owned x/z rect at one 16-row y-band — the full-coverage volume `chunkDensityRange` compares `touchedCount` against. */
  private static slabVolume(chunk: VoxelChunk): number {
    return (chunk.x1 - chunk.x0) * (chunk.z1 - chunk.z0) * CHUNK_SIZE;
  }

  /**
   * Widens `slab`'s tracked min/max density to include a write of `density`
   * at slab-local index `i`. Dedupes first-touch via `touched` so the same
   * position written twice doesn't double-count toward full slab coverage;
   * min/max themselves widen on every write, since density can change on a
   * re-write.
   */
  private touchDensity(slab: VoxelSlab, i: number, density: number): void {
    if (slab.touched[i] === 0) {
      slab.touched[i] = 1;
      slab.touchedCount++;
    }
    if (density < slab.minDensity) slab.minDensity = density;
    if (density > slab.maxDensity) slab.maxDensity = density;
  }

  /** Total number of allocated 16×16×16 slabs across every owned column. */
  get allocatedSlabCount(): number {
    let sum = 0;
    for (const chunk of this.chunks.values()) sum += chunk.slabs.size;
    return sum;
  }

  /** Number of allocated slabs in column (cx, cz); 0 if the column is unowned. */
  slabCount(cx: number, cz: number): number {
    return this.chunks.get(chunkKey(cx, cz))?.slabs.size ?? 0;
  }

  /**
   * Inclusive `[min, max]` cy of chunk (cx, cz)'s already-materialized slabs,
   * or null when the column is unowned or has none allocated yet.
   *
   * A surface-height scan (`computeColumnRangeY`/`computeVoxelColumnSurfaceHeight`)
   * only ever reports a column's topmost solid-to-air crossing — real ground
   * genuinely disconnected from that top (a floating block written directly
   * below an air gap, never swept through from the surface) has no effect on
   * it at all. This is the other signal a caller like TerrainMesh's `buildAll`
   * needs to still mesh that block: whatever has actually been written and
   * allocated, independent of whether it is reachable from the topmost
   * surface (#1188).
   */
  allocatedCyRange(cx: number, cz: number): { min: number; max: number } | null {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || chunk.slabs.size === 0) return null;
    let min = Infinity, max = -Infinity;
    for (const cy of chunk.slabs.keys()) {
      if (cy < min) min = cy;
      if (cy > max) max = cy;
    }
    return { min, max };
  }

  // ── Dirty tracking — what a save has to store voxel-by-voxel (#473 D4) ──

  /** Chunk coordinates of every chunk written since it was last marked pristine. */
  dirtyChunks(): Array<{ cx: number; cz: number }> {
    const out: Array<{ cx: number; cz: number }> = [];
    for (const key of this.dirty) {
      const chunk = this.chunks.get(key);
      if (chunk) out.push({ cx: chunk.cx, cz: chunk.cz });
    }
    return out;
  }

  /** True when chunk (cx, cz) differs from what generation would produce for it. */
  isChunkDirty(cx: number, cz: number): boolean {
    return this.dirty.has(chunkKey(cx, cz));
  }

  /**
   * Declare chunk (cx, cz) equal to its generated state — call right after
   * generating into it, so the writes generation itself made do not count as
   * play having changed it.
   */
  markChunkPristine(cx: number, cz: number): void {
    this.dirty.delete(chunkKey(cx, cz));
  }

  /** Force chunk (cx, cz) into the dirty set (used by save decode, which restores already-dirty chunks). */
  markChunkDirty(cx: number, cz: number): void {
    if (this.chunks.has(chunkKey(cx, cz))) this.dirty.add(chunkKey(cx, cz));
  }

  private touch(chunk: VoxelChunk): void {
    this.dirty.add(chunkKey(chunk.cx, chunk.cz));
  }

  /** True while a `withoutEditRecording` call is in progress — nested calls save/restore this. */
  private editingSuppressed = false;

  /**
   * Run `fn` with edit recording suspended — mutators called inside `fn` do
   * not append to `this.edits`. For `replayTerrainEdits` and generation,
   * neither of which should re-record what they are themselves replaying.
   */
  withoutEditRecording<T>(fn: () => T): T {
    const prev = this.editingSuppressed;
    this.editingSuppressed = true;
    try {
      return fn();
    } finally {
      this.editingSuppressed = prev;
    }
  }

  /**
   * Classify and record a density/compId/ores write at (x, y, z) — shared by
   * `fillVoxel` and `setVoxel`. A no-op write (nothing actually changed) is
   * never recorded. A density landing exactly on the grid's fully-solid (1)
   * or fully-clear (0) extreme is recorded as a plain interior row; anything
   * strictly between is a genuine fractional crossing, recorded with a
   * boundary override carrying the write's exact density/compId/ores so
   * replay reproduces it exactly. The `SOLID_VOXEL_DENSITY_THRESHOLD` this
   * file already uses for "solid" (`isSolidAt`) decides which side of that
   * fractional band counts as dug vs added.
   *
   * `prevCompId`/`newCompId` are this grid's own local `CompositionPalette`
   * indices, used only for the no-op equality check above — cheap and valid
   * since both come from the same instance. What actually reaches
   * `TerrainEdits` is the portable composition value (`this.palette.get(...)
   * .comp`), never the raw index: an `EditSegment`/`EditBoundary` may be
   * replayed onto a different `VoxelGrid` instance whose palette assigns
   * that same composition a different index (#1180).
   */
  private recordVoxelWrite(
    x: number, y: number, z: number,
    prevDensity: number, prevCompId: number, prevOres: Record<string, number> | undefined,
    newDensity: number, newCompId: number, newOres: Record<string, number> | undefined,
  ): void {
    if (this.editingSuppressed) return;
    if (prevDensity === newDensity && prevCompId === newCompId && oresDeepEqual(prevOres, newOres)) return;

    const newComposition = this.palette.get(newCompId).comp;

    if (newDensity > 0 && newDensity < 1) {
      const boundary: EditBoundary = newOres !== undefined
        ? { density: newDensity, composition: newComposition, ores: newOres }
        : { density: newDensity, composition: newComposition };
      if (newDensity >= SOLID_VOXEL_DENSITY_THRESHOLD) {
        this.edits.recordAdd(x, z, y, y, newComposition, newOres, boundary, boundary);
      } else {
        this.edits.recordDig(x, z, y, y, boundary, boundary);
      }
      return;
    }

    if (newDensity >= SOLID_VOXEL_DENSITY_THRESHOLD) {
      this.edits.recordAdd(x, z, y, y, newComposition, newOres);
    } else {
      this.edits.recordDig(x, z, y, y);
    }
  }

  /** Record a fracture-modifier change at (x, y, z) when it actually changed and recording isn't suppressed — shared by every mutator that writes `chunk.fracture`. */
  private recordFractureWrite(x: number, y: number, z: number, prev: number, next: number): void {
    if (!this.editingSuppressed && prev !== next) this.edits.recordFracture(x, y, z, next);
  }

  // ── Direct field accessors — no allocation, hot-path callers should prefer these ──

  /**
   * Density in [0, 1]. Coordinates the site does not own read as 0 (air). An
   * unallocated slab with no `chunkSource` attached also reads as 0, same as
   * before #1183; with a source attached it answers from `cheapDensityAt`
   * (edit record, else the source's cheap formula) WITHOUT materializing —
   * this is a hot-path accessor and must not allocate a slab just to answer
   * one voxel's density.
   */
  densityAt(x: number, y: number, z: number): number {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return 0;
    const slab = this.slabAt(chunk, y);
    if (slab) return slab.density[VoxelGrid.localIndex(chunk, chunkIndexOf(y), x, y, z)]!;
    return this.chunkSource ? this.cheapDensityAt(chunk, x, y, z) : 0;
  }

  /** True when density >= 0.5 — the shared "solid for meshing/physics" threshold. */
  isSolidAt(x: number, y: number, z: number): boolean {
    return this.densityAt(x, y, z) >= 0.5;
  }

  /**
   * Density at (x, y, z) from `chunkSource`/edits alone, without materializing
   * a slab in THIS grid — for a read that only needs one voxel's answer, not
   * a whole 16×16×16 band written into storage (#1183).
   *
   * Deliberately exact, not an approximation: `VoxelChunkSource` exposes no
   * per-voxel density hook narrower than `materializeSlab` itself (its only
   * other member, `surfaceHeightAt`, is a hint for mesh/nav code, not a
   * promise that density is some simple function of it — a generator's real
   * per-voxel density can depend on strata/noise same as composition does),
   * so the only way to answer exactly is to run the real contract, via
   * `sourceColumnDensity` below, on a column not backed by this grid's own
   * storage.
   */
  private cheapDensityAt(chunk: VoxelChunk, x: number, y: number, z: number): number {
    const edited = this.editedDensityAt(x, y, z);
    if (edited !== undefined) return edited;
    if (!this.chunkSource) return 0;
    return this.sourceColumnDensity(chunk, x, y, z);
  }

  /** Packs a chunk-local (lx, lz) column and a y-band index into one collision-free key for `VoxelChunk.cheapDensity`. */
  private static cheapColumnKey(lx: number, lz: number, cy: number): number {
    return (lx * CHUNK_SIZE + lz) * 1048576 + (cy + 524288);
  }

  /**
   * Generator-only density (no edits — `cheapDensityAt` already checked
   * those) at (x, y, z), memoized per column so repeated cheap reads in the
   * same 1×1×16 column cost one `materializeSlab` call, not one per voxel.
   * The memo lives on `chunk.cheapDensity`, never on `chunk.slabs`, so it is
   * invisible to `allocatedSlabCount`/`slabCount` — a chunk nothing has done
   * a real (materializing) read on still reports zero allocated slabs.
   */
  private sourceColumnDensity(chunk: VoxelChunk, x: number, y: number, z: number): number {
    const cy = chunkIndexOf(y);
    const lx = x - chunk.cx * CHUNK_SIZE;
    const lz = z - chunk.cz * CHUNK_SIZE;
    const key = VoxelGrid.cheapColumnKey(lx, lz, cy);
    let column = chunk.cheapDensity?.get(key);
    if (!column) {
      column = this.materializeScratchColumn(chunk, x, z, cy);
      if (!chunk.cheapDensity) chunk.cheapDensity = new Map();
      chunk.cheapDensity.set(key, column);
    }
    return column[y - cy * CHUNK_SIZE]!;
  }

  /**
   * Runs `chunkSource.materializeSlab` for the single column (x, z) at
   * y-band `cy` against a throwaway scratch `VoxelGrid` that owns only that
   * one chunk — never `this` grid — so the real generator contract answers
   * exactly, without allocating a slab this grid would ever report owning.
   */
  private materializeScratchColumn(chunk: VoxelChunk, x: number, z: number, cy: number): Float64Array {
    const scratch = new VoxelGrid(0, this.sizeY, 0);
    scratch.addChunk(chunk.cx, chunk.cz);
    this.chunkSource!.materializeSlab(scratch, x, x + 1, z, z + 1, cy);
    const y0 = cy * CHUNK_SIZE;
    const out = new Float64Array(CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) out[ly] = scratch.densityAt(x, y0 + ly, z);
    return out;
  }

  /** Density at (x, y, z) as recorded in `this.edits`, or undefined when this voxel carries no edit (#1183). */
  private editedDensityAt(x: number, y: number, z: number): number | undefined {
    for (const seg of this.edits.segmentsAt(x, z)) {
      if (y < seg.yLo || y > seg.yHi) continue;
      const boundary = boundaryAt(seg, y);
      if (boundary) return boundary.density;
      return seg.kind === 'added' ? 1 : 0;
    }
    return undefined;
  }

  /**
   * Fracture modifier (1.0 = normal, < 1.0 = pre-cracked). Unowned
   * coordinates read as 1.0. An unallocated slab reads a recorded fracture
   * edit if one exists (there is no cheap generator formula for fracture —
   * generation itself never produces one), else 1.0 — without materializing.
   */
  fractureAt(x: number, y: number, z: number): number {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return 1.0;
    const slab = this.slabAt(chunk, y);
    if (slab) return slab.fracture[VoxelGrid.localIndex(chunk, chunkIndexOf(y), x, y, z)]!;
    return this.edits.fractureAt(x, y, z) ?? 1.0;
  }

  /** The shared, frozen composition object for this voxel. Treat as immutable. */
  compositionAt(x: number, y: number, z: number): VoxelRockComposition {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return this.palette.get(0).comp;
    const { slab, i } = this.resolveCell(chunk, x, y, z);
    if (!slab) return this.palette.get(0).comp;
    return this.palette.get(slab.compId[i]!).comp;
  }

  /** Dominant rock ID, precomputed at intern time. '' for air, unowned coordinates, or an unallocated slab. */
  dominantRockAt(x: number, y: number, z: number): string {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return '';
    const { slab, i } = this.resolveCell(chunk, x, y, z);
    if (!slab) return '';
    return this.palette.get(slab.compId[i]!).dominantRockId;
  }

  /** Ore densities at this voxel, or undefined if it carries no ore (the common case, including an unallocated slab). */
  oresAt(x: number, y: number, z: number): Record<string, number> | undefined {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return undefined;
    const { slab, i } = this.resolveCell(chunk, x, y, z);
    if (!slab) return undefined;
    return slab.ores.get(i);
  }

  // ── Direct mutators — hot-path callers (generation, blast) should prefer these ──

  /**
   * Fill a voxel with an already-interned composition palette index.
   *
   * `density` defaults to fully solid. Generation passes a fractional value
   * for the one voxel a column's surface actually passes through, which is
   * what lets marching cubes place that surface at the continuous terrain
   * height instead of snapping it to the nearest half-voxel (#458).
   */
  fillVoxel(x: number, y: number, z: number, compId: number, ores?: Record<string, number>, density = 1.0): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const { density: prevDensity, compId: prevCompId, ores: prevOres, fracture: prevFracture } = this.readCellDefaults(existing, i);
    const newOres = ores && Object.keys(ores).length > 0 ? ores : undefined;

    // A write is always marked dirty, whether or not it actually changes the
    // stored value — a save consumer treats "was written to" and "differs
    // from generation" as the same signal, and callers rely on that (#1182
    // regression: dirty tracking predates this issue and must not change).
    this.touch(chunk);

    // No-op value (identical to what's already there, or to the implicit air
    // default in an unallocated slab): skip storage entirely, so a fillVoxel
    // that changes nothing never allocates a slab.
    if (prevDensity === density && prevCompId === compId && prevFracture === 1.0 && oresDeepEqual(prevOres, newOres)) {
      return;
    }

    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.density[i] = density;
    slab.compId[i] = compId;
    slab.fracture[i] = 1.0;
    if (newOres) slab.ores.set(i, { ...newOres });
    else slab.ores.delete(i);
    this.touchDensity(slab, i, density);
    this.recordVoxelWrite(x, y, z, prevDensity, prevCompId, prevOres, density, compId, slab.ores.get(i));
    this.recordFractureWrite(x, y, z, prevFracture, 1.0);
  }

  setFractureAt(x: number, y: number, z: number, value: number): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const { fracture: prev } = this.readCellDefaults(existing, i);
    this.writeFractureValue(chunk, existing, cy, i, x, y, z, prev, value);
  }

  /** Multiply the fracture modifier in place (e.g. cracking a voxel that didn't fully fracture). */
  scaleFractureAt(x: number, y: number, z: number, factor: number): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const { fracture: prev } = this.readCellDefaults(existing, i);
    this.writeFractureValue(chunk, existing, cy, i, x, y, z, prev, prev * factor);
  }

  /**
   * Shared write path for `setFractureAt`/`scaleFractureAt`, which differ only
   * in how `next` is computed: marks the chunk dirty unconditionally, no-ops
   * (without allocating a slab) when `next` doesn't actually differ from
   * `prev`, and otherwise allocates on demand and records the edit.
   */
  private writeFractureValue(
    chunk: VoxelChunk, existing: VoxelSlab | undefined, cy: number, i: number,
    x: number, y: number, z: number, prev: number, next: number,
  ): void {
    this.touch(chunk); // any write is dirty, whether or not the value actually changes
    if (prev === next) return; // no-op value: skip without allocating a slab
    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.fracture[i] = next;
    this.recordFractureWrite(x, y, z, prev, next);
  }

  /**
   * Write a generator-produced voxel at (x, y, z) during slab materialization
   * (#1183) — called only from a `VoxelChunkSource.materializeSlab`
   * implementation, never from gameplay code. Unlike `fillVoxel`, does not
   * record an edit: this is generation filling in the baseline, not play
   * changing it.
   */
  writeGeneratedVoxel(
    x: number, y: number, z: number,
    compId: number, ores: Record<string, number> | undefined, density: number,
  ): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const cy = chunkIndexOf(y);
    // `materializeSlabFromSource` (the normal materialize-on-read path)
    // always allocates the slab before calling into `chunkSource.
    // materializeSlab`, so the common case finds it already resident here.
    // But `VoxelChunkSource.materializeSlab` is itself a public contract
    // (TerrainGen.test.ts's "createChunkSource" tests call it directly on a
    // bare `VoxelGrid`, independent of VoxelGrid's own dispatch, per #1183)
    // — allocating on demand via `getOrCreateSlab` here, same as every other
    // mutator in this file, is what makes that contract self-sufficient
    // rather than silently dropping every write when nothing pre-allocated
    // the slab (#1183 fixer).
    const slab = chunk.slabs.get(cy) ?? this.getOrCreateSlab(chunk, cy);
    const i = VoxelGrid.localIndex(chunk, cy, x, y, z);
    slab.density[i] = density;
    slab.compId[i] = compId;
    if (ores && Object.keys(ores).length > 0) slab.ores.set(i, { ...ores });
    else slab.ores.delete(i);
    this.touchDensity(slab, i, density);
    // Deliberately no `this.touch(chunk)` (generation output is not a
    // gameplay edit — the chunk isn't dirty just because it was materialized)
    // and no `recordVoxelWrite` (nothing to record: this IS the baseline
    // `recordVoxelWrite` compares future edits against).
  }

  // ── Compatibility API — materializes a VoxelData-shaped object per call ──

  /**
   * Returns undefined for coordinates the site does not own. The returned
   * object is a fresh wrapper; `.composition` is the shared frozen palette
   * entry (immutable by contract), `.oreDensities` is a fresh shallow copy.
   * Mutating the returned wrapper's own fields does not write back to the
   * grid — use the direct mutators above, or `setVoxel`, to write.
   */
  getVoxel(x: number, y: number, z: number): VoxelData | undefined {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return undefined;
    const { slab, i } = this.resolveCell(chunk, x, y, z);
    if (!slab) {
      return { composition: this.palette.get(0).comp, density: 0, oreDensities: {}, fractureModifier: 1.0 };
    }
    const ores = slab.ores.get(i);
    return {
      composition: this.palette.get(slab.compId[i]!).comp,
      density: slab.density[i]!,
      oreDensities: ores ? { ...ores } : {},
      fractureModifier: slab.fracture[i]!,
    };
  }

  setVoxel(x: number, y: number, z: number, voxel: VoxelData): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const newCompId = this.palette.intern(voxel.composition);
    const newOres = Object.keys(voxel.oreDensities).length > 0 ? voxel.oreDensities : undefined;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const { density: prevDensity, compId: prevCompId, ores: prevOres, fracture: prevFracture } = this.readCellDefaults(existing, i);

    this.touch(chunk); // any write is dirty, whether or not the value actually changes

    if (prevDensity === voxel.density && prevCompId === newCompId
        && prevFracture === voxel.fractureModifier && oresDeepEqual(prevOres, newOres)) {
      return;
    }

    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.compId[i] = newCompId;
    slab.density[i] = voxel.density;
    slab.fracture[i] = voxel.fractureModifier;
    if (newOres) slab.ores.set(i, { ...newOres });
    else slab.ores.delete(i);
    this.touchDensity(slab, i, voxel.density);
    this.recordVoxelWrite(x, y, z, prevDensity, prevCompId, prevOres, voxel.density, newCompId, slab.ores.get(i));
    this.recordFractureWrite(x, y, z, prevFracture, voxel.fractureModifier);
  }

  clearVoxel(x: number, y: number, z: number): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const { density: prevDensity, compId: prevCompId, ores: prevOres, fracture: prevFracture } = this.readCellDefaults(existing, i);

    this.touch(chunk); // any write is dirty, whether or not the value actually changes

    // Already air (explicitly, or by an unallocated slab's implicit default): no-op value.
    if (prevDensity === 0 && prevCompId === 0 && prevFracture === 1.0 && prevOres === undefined) {
      return;
    }

    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.density[i] = 0;
    slab.compId[i] = 0;
    slab.fracture[i] = 1.0;
    slab.ores.delete(i);
    this.touchDensity(slab, i, 0);
    this.recordVoxelWrite(x, y, z, prevDensity, prevCompId, prevOres, 0, 0, undefined);
    this.recordFractureWrite(x, y, z, prevFracture, 1.0);
  }

  /** Get all voxels within a bounding box (inclusive on both ends). Unowned columns are skipped. */
  getRegion(
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
  ): RegionEntry[] {
    const results: RegionEntry[] = [];
    this.forEachInRegion(min, max, (x, y, z) => {
      results.push({ x, y, z, data: this.getVoxel(x, y, z)! });
    });
    return results;
  }

  // ── Iteration ──

  /** Visit every owned voxel in a clamped bounding box, in z → y → x order. */
  private forEachInRegion(
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
    cb: (x: number, y: number, z: number) => void,
  ): void {
    const x0 = Math.max(this.bMinX, min.x);
    const y0 = Math.max(0, min.y);
    const z0 = Math.max(this.bMinZ, min.z);
    const x1 = Math.min(this.bMaxX - 1, max.x);
    const y1 = Math.min(this.sizeY - 1, max.y);
    const z1 = Math.min(this.bMaxZ - 1, max.z);

    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (this.isInBounds(x, y, z)) cb(x, y, z);
        }
      }
    }
  }

  /**
   * Visits only solid (density > 0) voxels across the grid's whole declared
   * height `[0, sizeY - 1]`, chunk by chunk, band by band. A band with no
   * resident slab is skipped without materializing when either no
   * `chunkSource` is attached (unallocated genuinely means air, as before
   * #1183) or `cheapChunkDensityRange` reports it entirely air; a band that
   * might hold solid content (mixed or entirely solid) is materialized via
   * `ensureSlab` so the compId reported is the real one, not skipped.
   */
  forEachSolid(cb: (x: number, y: number, z: number, compId: number) => void): void {
    const bandCount = Math.ceil(this.sizeY / CHUNK_SIZE);
    for (const chunk of this.chunks.values()) {
      for (let cy = 0; cy < bandCount; cy++) {
        let slab = chunk.slabs.get(cy);
        if (!slab) {
          if (!this.chunkSource) continue;
          if (this.cheapChunkDensityRange(chunk, cy).max <= 0) continue;
          slab = this.ensureSlab(chunk, cy * CHUNK_SIZE);
          if (!slab) continue;
        }
        const y0 = Math.max(0, cy * CHUNK_SIZE);
        const y1 = Math.min(this.sizeY - 1, cy * CHUNK_SIZE + CHUNK_SIZE - 1);
        if (y0 > y1) continue;
        for (let z = chunk.z0; z < chunk.z1; z++) {
          for (let y = y0; y <= y1; y++) {
            for (let x = chunk.x0; x < chunk.x1; x++) {
              const i = VoxelGrid.localIndex(chunk, cy, x, y, z);
              if (slab.density[i]! > 0) cb(x, y, z, slab.compId[i]!);
            }
          }
        }
      }
    }
  }

  /**
   * Visits only solid (density > 0) voxels in the given region. A voxel whose
   * slab isn't resident is checked cheaply first (`cheapDensityAt`, no
   * allocation) and only materialized — via `ensureSlab` — once that cheap
   * check says it's actually solid, so a genuinely rocky never-before-read
   * voxel is never silently reported as air (#1183).
   */
  forEachSolidInRegion(
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
    cb: (x: number, y: number, z: number, compId: number) => void,
  ): void {
    this.forEachInRegion(min, max, (x, y, z) => {
      const chunk = this.ownerOf(x, y, z)!;
      let slab = this.slabAt(chunk, y);
      if (!slab) {
        if (!this.chunkSource) return;
        if (this.cheapDensityAt(chunk, x, y, z) <= 0) return; // cheap formula says air — skip without materializing
        slab = this.ensureSlab(chunk, y);
        if (!slab) return;
      }
      const i = VoxelGrid.localIndex(chunk, chunkIndexOf(y), x, y, z);
      if (slab.density[i]! > 0) cb(x, y, z, slab.compId[i]!);
    });
  }
}

/**
 * Clamp a world (x, z) column to the grid's own column bounds — shared by
 * computeVoxelColumnSurfaceY and getSmoothTerrainSurfaceY below, both of
 * which need "nearest column inside the grid" rather than
 * computeVoxelColumnSurfaceHeight's honest out-of-bounds NaN (#559).
 */
export function clampToGridColumn(grid: VoxelGrid, x: number, z: number): { cx: number; cz: number } {
  return {
    cx: Math.max(grid.minX, Math.min(grid.maxX - 1, Math.floor(x))),
    cz: Math.max(grid.minZ, Math.min(grid.maxZ - 1, Math.floor(z))),
  };
}

/**
 * Resolve the surface Y for column (x, z) — the highest voxel with density
 * >= 0.5. Returns null if the column is entirely void (or off-site).
 * Out-of-bounds (x, z) coordinates are clamped to the grid limits.
 *
 * Shared by NavGrid.computeSurfaceY and Ramp.ts's local column-surface
 * resolution — both need this exact scan and previously kept independent
 * copies to avoid a core/mining <-> core/nav import cycle (core/nav already
 * depends on core/mining). VoxelGrid is a true leaf module (no imports of its
 * own), so both can import from here instead.
 *
 * This is also the canonical scan that BlastExecution, SurveyCalc,
 * BuildingPlacement, and the renderer's GameRenderer delegate to (each with
 * their own +1 "first empty layer above ground" convention layered on top)
 * — see #458 T0.1. `TerrainBody.findSurfaceY` deliberately does NOT delegate
 * here: it is used for physics ground-detection on fragment positions that
 * can be outside grid bounds mid-flight, and needs "no ground" (-1) rather
 * than this function's clamp-to-edge-column behaviour in that case.
 */
export function computeVoxelColumnSurfaceY(grid: VoxelGrid, x: number, z: number): number | null {
  if (grid.sizeX <= 0 || grid.sizeZ <= 0) return null;

  const { cx, cz } = clampToGridColumn(grid, x, z);
  return resolveColumnTopY(grid, cx, cz);
}

/**
 * Resolve column (x, z)'s topmost "ground" Y from the generator + edit
 * record directly — O(edit segments in that column), not O(scanned height) —
 * supporting negative and arbitrarily-high surfaces with no vertical clamp.
 * Returns null for a column with no ground at all (#1184): off-site, or (for
 * an owned column) no material anywhere.
 *
 * The generator's natural fill is a solid half-space from -Infinity up to
 * `Math.floor(generatorSurfaceHeightAt(x, z))` inclusive. Recorded edit
 * segments (`grid.edits.segmentsAt`) override that natural fill within their
 * own `[yLo, yHi]` range — a 'dug' segment is never solid, an 'added'
 * segment is always solid (both are recorded relative to
 * `SOLID_VOXEL_DENSITY_THRESHOLD`, the same threshold `isSolidAt` uses, so
 * the segment's kind alone decides without re-reading its boundary density).
 * Walking the (few) recorded segments from the top down, checking the
 * natural-fill gap above/between each one before the segment itself, finds
 * the topmost solid row in O(segments in this column) — never a scan over a
 * height range.
 *
 * Not exported: internal detail of `computeVoxelColumnSurfaceY`/
 * `computeVoxelColumnSurfaceHeight`, same as `resolveCell` above.
 */
function resolveColumnTopY(grid: VoxelGrid, x: number, z: number): number | null {
  if (!grid.containsColumn(x, z)) return null;

  const segments = grid.edits.segmentsAt(x, z);
  const naturalSurface = grid.generatorSurfaceHeightAt(x, z);
  const naturalFloor = naturalSurface !== undefined ? Math.floor(naturalSurface) : undefined;

  // `upperBound` is the exclusive top of the natural-fill gap currently under
  // consideration — Infinity above the topmost segment, then each rejected
  // ('dug') segment's own yLo as we walk downward past it. The gap's own top
  // is `upperBound - 1` (capped there even when `naturalFloor` reaches
  // higher, since anything from `upperBound` up is already claimed by the
  // segment above, already checked and rejected).
  let upperBound = Infinity;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (naturalFloor !== undefined) {
      const gapTop = Math.min(naturalFloor, upperBound - 1);
      if (gapTop > seg.yHi) return gapTop;
    }
    if (seg.kind === 'added') return seg.yHi;
    upperBound = seg.yLo;
  }

  if (naturalFloor !== undefined) return Math.min(naturalFloor, upperBound - 1);
  return null;
}

/**
 * Half-width, in voxels, of the band over which density falls from solid to
 * air across the surface.
 *
 * One full voxel either side. A narrower band would need a density below zero
 * on the air side to keep the crossing linear, and densities are clamped to
 * [0, 1] — the crossing would then bend and the surface would drift off the
 * height it is supposed to sit on.
 */
export const SURFACE_BAND_HALF = 1;

/**
 * Density for voxel `y` in a column whose surface sits at continuous height
 * `surfaceH`, chosen so marching cubes puts its iso-surface exactly there.
 *
 * Marching cubes finds the 0.5 crossing by interpolating linearly between two
 * corner densities, so a field that is linear in y with value 0.5 at surfaceH
 * reproduces surfaceH exactly, fractional part and all. Filling voxels solid
 * up to a rounded surface instead is what terraced the whole site into 1 m
 * steps while the landscape beside it stayed smooth (#458).
 */
export function surfaceDensityAt(y: number, surfaceH: number): number {
  const d = 0.5 + (surfaceH - y) / (2 * SURFACE_BAND_HALF);
  return Math.max(0, Math.min(1, d));
}

/**
 * Continuous height of the topmost solid-to-air crossing at column (x, z),
 * in the same datum as heightToVoxelYContinuous. Mirrors
 * computeVoxelColumnSurfaceY's top-down scan, but returns the fractional
 * crossing height (via densityAt interpolation between the topmost solid
 * voxel and the one above it), matching what TerrainMesh's marching cubes
 * actually renders at that column right now, pre- or post-blast.
 *
 * Unlike computeVoxelColumnSurfaceY, does NOT clamp an out-of-bounds (x, z)
 * to the edge column — it returns NaN instead (#559). LandscapeMesh's live
 * boundary-height sampling needs an honest "no live data here" signal at the
 * claim edge, since the claim itself moves; a silent clamp there produced
 * the seam this function's fix closes.
 *
 * The "no ground in this owned column" case also returns NaN (#1184) — not
 * 0, since a real surface can now legitimately sit at 0 or below. Return
 * type stays plain `number`; NaN is the sentinel, not a widened union.
 */
export function computeVoxelColumnSurfaceHeight(grid: VoxelGrid, x: number, z: number): number {
  if (grid.sizeX <= 0 || grid.sizeZ <= 0) return 0;
  if (!grid.containsColumn(x, z)) return NaN;

  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const topY = resolveColumnTopY(grid, cx, cz);
  if (topY === null) return NaN;

  // Same crossing interpolation as TerrainMesh's emitVertex: the voxel above
  // the topmost-solid voxel is air-side (density < 0.5), and the fractional
  // height along that edge is where density == 0.5. Matches marching cubes
  // exactly.
  const density0 = grid.densityAt(cx, topY, cz);
  const density1 = grid.densityAt(cx, topY + 1, cz);
  let t = 0.5;
  if (Math.abs(density1 - density0) > 1e-6) {
    t = (0.5 - density0) / (density1 - density0);
  }
  t = Math.max(0, Math.min(1, t));
  return topY + t;
}

/**
 * Vertical span actually touched by ground across every column in
 * `[minX, maxX] × [minZ, maxZ]` (inclusive), via
 * `computeVoxelColumnSurfaceHeight`. No-ground (NaN) columns are skipped.
 * Returns `{ minY: floor(lowest), maxY: ceil(highest) }` over the columns
 * that do have ground, or `null` when no column in the rect has any (#1185)
 * — used by change producers that currently report a full-grid `minY: 0,
 * maxY: sizeY - 1` region, meaningless now the grid has no vertical cap.
 */
export function computeColumnRangeY(
  grid: VoxelGrid,
  minX: number, maxX: number, minZ: number, maxZ: number,
): { minY: number; maxY: number } | null {
  let lowest = Infinity;
  let highest = -Infinity;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const height = computeVoxelColumnSurfaceHeight(grid, x, z);
      if (Number.isNaN(height)) continue;
      if (height < lowest) lowest = height;
      if (height > highest) highest = height;
    }
  }
  if (lowest === Infinity) return null;
  return { minY: Math.floor(lowest), maxY: Math.ceil(highest) };
}

/**
 * Largest gap, in voxels, between a column's existing surface and a newly
 * written one that `setVoxelColumnSurfaceHeight` will still sweep-clear
 * between. Both ends are unclamped (#1184) — `existingTopY` comes from a
 * generator surface plus a replayed edit record, `height` from the caller —
 * so a corrupted or extreme save can put them arbitrarily far apart and turn
 * the write loop below into one iteration per voxel of that gap. Real
 * terrain spans at most a few hundred metres; 1000 is generous headroom
 * above that, chosen so no legitimate column (e.g. one carved down to -50
 * against a ~20-high generator surface) is ever affected.
 */
const MAX_SURFACE_SWEEP_GAP = 1000;

/**
 * Writes column (x, z)'s top surface to continuous height `height`: fully
 * solid below the crossing, the straddling pair carrying the fractional
 * density surfaceDensityAt defines, zero above — so
 * computeVoxelColumnSurfaceHeight reads back exactly `height` afterwards.
 *
 * Touches only the band between the column's existing topmost solid voxel
 * (computeVoxelColumnSurfaceY) and the new target's own band — never reaches
 * below the old surface's immediate neighbourhood, so an overhang or cavity
 * buried deeper in the column survives untouched. This is the primitive
 * that expresses "ground ends here"; it does not flatten the column's whole
 * stack, and it is not itself a ground-clearing side effect of anything else.
 *
 * A column the grid does not own is a no-op, matching fillVoxel/setVoxel/
 * clearVoxel's own silent-no-op convention for unowned coordinates. A
 * non-finite `height` (NaN, Infinity, -Infinity) is likewise a silent no-op.
 *
 * `height` is written as given, with no clamp toward `[0, grid.sizeY - 1]`
 * (#1184) — a column is writable at any height, negative included, since
 * rock now extends to every depth.
 *
 * Returns the highest Y index written or cleared by this call, or null for a
 * no-op (unowned column or non-finite height) — for a caller tracking a
 * dirty-region bound (`renormaliseVoxelColumnAfterCarve`).
 */

export function setVoxelColumnSurfaceHeight(
  grid: VoxelGrid,
  x: number,
  z: number,
  height: number,
  compId: number,
  ores?: Record<string, number>,
): number | null {
  if (!grid.containsColumn(x, z)) return null;
  if (!Number.isFinite(height)) return null;

  // Read the OLD surface before writing the new one.
  const existingTopY = computeVoxelColumnSurfaceY(grid, x, z);

  // Union of "what used to be filled that must now clear" and "what the new
  // crossing band needs" — never reaches below either surface, so an
  // overhang or cavity buried deeper in the column is left untouched. With
  // no existing ground, only the new target's own band applies — there is no
  // old surface to sweep down from. Same when the existing surface sits
  // implausibly far from the target: treat it like "no old surface to sweep
  // down from" rather than clearing the whole gap (#1184 security review).
  const targetLowY = Math.floor(height) - SURFACE_BAND_HALF + 1;
  const targetHighY = Math.ceil(height) + SURFACE_BAND_HALF - 1;
  const sweepFromExistingTop =
    existingTopY !== null && Math.abs(existingTopY - height) <= MAX_SURFACE_SWEEP_GAP ? existingTopY : null;
  const lowY = sweepFromExistingTop === null ? targetLowY : Math.min(sweepFromExistingTop + 1, targetLowY);
  const highY = sweepFromExistingTop === null ? targetHighY : Math.max(sweepFromExistingTop, targetHighY);

  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let y = lowY; y <= highY; y++) {
    const density = surfaceDensityAt(y, height);
    if (density > 0) grid.fillVoxel(cx, y, cz, compId, ores, density);
    else grid.clearVoxel(cx, y, cz);
  }
  return highY;
}

/**
 * Smoothed (marching-cubes) terrain surface Y at the given (x, z) column —
 * the height a ground tint patch (#1006) conforms to, unlike
 * computeVoxelColumnSurfaceY's per-voxel-column step height. Clamps
 * out-of-bounds (x, z) to the nearest edge column via clampToGridColumn
 * (computeVoxelColumnSurfaceHeight itself returns NaN outside the grid
 * rather than clamping — #559, it needs an honest "no data" signal at the
 * live claim edge — so the clamp happens here instead).
 *
 * Lives here rather than in a renderer module so both TerrainMesh (a leaf
 * rendering primitive) and GameRendererTerrain (which re-exports it for its
 * own larger call graph) can depend on it without a coupling-direction
 * smell — it needs only the grid and computeVoxelColumnSurfaceHeight, both
 * already core (#1006 finding 4).
 */
export function getSmoothTerrainSurfaceY(grid: VoxelGrid | null, x: number, z: number): number {
  if (!grid || grid.sizeX <= 0 || grid.sizeZ <= 0) return 0;
  const { cx, cz } = clampToGridColumn(grid, x, z);
  const h = computeVoxelColumnSurfaceHeight(grid, cx, cz);
  return Number.isNaN(h) ? 0 : h;
}

/**
 * After a voxel-level carve has dropped column (x, z)'s exposed top from
 * `oldTopY` to wherever it now sits, clear any leftover sub-threshold density
 * the carve stranded just above the new top. When the newly exposed top is
 * itself already mid-band (a genuine fractional crossing the carve cut
 * through, not a plain fully-solid voxel), also re-grade it into the same
 * continuous band setVoxelColumnSurfaceHeight itself would write for it — so
 * a carved surface that genuinely had a crossing reads back identically to a
 * written one.
 *
 * A newly exposed top that reads fully solid (density === 1) is a flat rock
 * boundary with no natural crossing of its own — carving through it exposes
 * plain rock, not a slope — so this deliberately leaves it as a hard step
 * rather than manufacturing a band that was never there. Re-grading
 * unconditionally on every carve, including this case, is what carved a
 * spurious sub-threshold voxel one cell above every plain flat-rock cut
 * (#1148 fixer finding).
 *
 * Inputs: an existing VoxelGrid; a column (x, z); the column's topmost
 * solid-or-above (density >= 0.5) Y index from immediately before the carve
 * that just ran.
 *
 * Output: null when the column's exposed top did not move (the carve never
 * reached above the column's current top — a cavity dug from below/inside,
 * or a fragmented voxel that wasn't the column's topmost run) — in this case
 * nothing is touched, so any existing overhang or crossing band above stays
 * completely untouched. Otherwise, the highest Y this call wrote or cleared,
 * for a caller tracking a dirty-region bounding box to report onward.
 *
 * Never reaches below the highest carved gap in the column: rock separated
 * from the new top by empty space (an overhang, a cavity roof, a tunnel
 * floor) is never read or written by this function.
 *
 * A column carved down to nothing (no solid voxel left at all) is left
 * empty — there is no top to write a band for.
 */
export function renormaliseVoxelColumnAfterCarve(
  grid: VoxelGrid,
  x: number,
  z: number,
  oldTopY: number | null,
): number | null {
  if (!grid.containsColumn(x, z)) return null;

  const newTopY = computeVoxelColumnSurfaceY(grid, x, z);
  if (newTopY === oldTopY) return null;

  const cx = Math.floor(x);
  const cz = Math.floor(z);

  // Bounded sweep: the only place a legitimate pre-existing crossing band
  // above the old top could have been sitting. Never reaches further than
  // SURFACE_BAND_HALF above oldTopY, so this is O(SURFACE_BAND_HALF), not a
  // column-wide scan. With no old top at all, there is nothing above it to
  // sweep — skip entirely.
  let touchedMaxY: number | null = null;
  if (oldTopY !== null) {
    const sweepHigh = oldTopY + SURFACE_BAND_HALF;
    for (let y = oldTopY + 1; y <= sweepHigh; y++) {
      if (grid.densityAt(cx, y, cz) !== 0) {
        grid.clearVoxel(cx, y, cz);
        touchedMaxY = touchedMaxY === null ? y : Math.max(touchedMaxY, y);
      }
    }
  }

  if (newTopY === null) return touchedMaxY;

  // A fully solid new top has no genuine crossing to reconstruct — carving
  // through plain rock exposes more plain rock, and manufacturing a band
  // here would smear a spurious sub-threshold voxel one cell above a
  // perfectly clean cut. Only a top that is itself still mid-band (a real
  // crossing the carve cut through) needs re-grading.
  if (grid.densityAt(cx, newTopY, cz) >= 1) return touchedMaxY;

  const compId = grid.palette.intern(grid.compositionAt(cx, newTopY, cz));
  const ores = grid.oresAt(cx, newTopY, cz);
  const height = computeVoxelColumnSurfaceHeight(grid, cx, cz);
  const bandTop = setVoxelColumnSurfaceHeight(grid, cx, cz, height, compId, ores);

  if (touchedMaxY === null) return bandTop;
  if (bandTop === null) return touchedMaxY;
  return Math.max(touchedMaxY, bandTop);
}

/**
 * Distinct (x, z) columns among `cells`, each mapped to its topmost
 * solid-or-above Y read before a multi-cell carve's clear loop runs —
 * captured once per column, not once per cell, so a carve touching several
 * cells in the same column doesn't re-capture a top an earlier cell's clear
 * already moved. Feeds `renormaliseCarvedColumns` after the clear loop.
 * Shared by every multi-cell carve site (Ramp.ts, BlastExecution.ts) so each
 * keeps its own clear loop but not its own column-dedup bookkeeping (#1148).
 */
export function captureColumnTopsForCarve(
  grid: VoxelGrid,
  cells: ReadonlyArray<{ x: number; z: number }>,
): Map<string, { x: number; z: number; oldTopY: number | null }> {
  const columns = new Map<string, { x: number; z: number; oldTopY: number | null }>();
  for (const cell of cells) {
    const key = `${cell.x},${cell.z}`;
    if (!columns.has(key)) {
      columns.set(key, { x: cell.x, z: cell.z, oldTopY: computeVoxelColumnSurfaceY(grid, cell.x, cell.z) });
    }
  }
  return columns;
}

/**
 * Renormalise every column captured by `captureColumnTopsForCarve`, once the
 * carve's clear loop has run. Returns the highest Y any of them touched, or
 * null if none moved — for widening the caller's `terrain:updated` region.
 */
export function renormaliseCarvedColumns(
  grid: VoxelGrid,
  columns: ReadonlyMap<string, { x: number; z: number; oldTopY: number | null }>,
): number | null {
  let maxY: number | null = null;
  for (const { x, z, oldTopY } of columns.values()) {
    const touched = renormaliseVoxelColumnAfterCarve(grid, x, z, oldTopY);
    if (touched !== null) maxY = maxY === null ? touched : Math.max(maxY, touched);
  }
  return maxY;
}

/**
 * Resolve the palette composition index the newly exposed surface at column
 * (x, z) should carry once cut down to `targetY` — the composition already
 * present at (x, floor(targetY), z), so the carved-down surface exposes the
 * rock that was actually sitting there rather than switching material. Falls
 * back to the column's own topmost solid voxel's composition when that exact
 * row reads as air (e.g. targetY lands inside a void/overhang).
 *
 * Lifted here from LevelGround.ts (#1151) once Ramp.ts's own continuous
 * floor-banding (`bandRampFloor`) needed the identical lookup — a leaf
 * VoxelGrid.ts helper both callers can import without LevelGround.ts and
 * Ramp.ts importing from each other (LevelGround.ts already imports
 * `computeRampSegmentDurationTicks` from Ramp.ts, so the reverse edge would
 * cycle).
 */
export function resolveExposedCompId(grid: VoxelGrid, x: number, z: number, targetY: number): number {
  const rowY = Math.floor(targetY);
  let composition = grid.compositionAt(x, rowY, z);
  if (composition.rocks.length === 0) {
    const topY = computeVoxelColumnSurfaceY(grid, x, z);
    if (topY !== null) composition = grid.compositionAt(x, topY, z);
  }
  return grid.palette.intern(composition);
}

/**
 * First empty layer directly above ground at column (x, z). fallbackY
 * (default 0) is returned for a no-ground column.
 */
export function firstEmptyLayerAboveGround(grid: VoxelGrid, x: number, z: number, fallbackY = 0): number {
  const surface = computeVoxelColumnSurfaceY(grid, x, z);
  return surface === null ? fallbackY : surface + 1;
}
