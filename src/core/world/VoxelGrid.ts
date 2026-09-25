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

import { TerrainEdits, oresDeepEqual, type EditBoundary } from './TerrainEdits';
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
  density: Float64Array;   // CHUNK_SIZE**3 = 4096
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
export class VoxelGrid {
  /** Size (in metres) of one voxel cell along each axis. Always 1.0 m. */
  static readonly CELL_SIZE = 1.0;

  /** Voxels per chunk side on x and z. Chunks are full-height on y. */
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
    if (!slab) return { min: 0, max: 0 }; // owned column, unallocated slab — honestly all air
    if (slab.touchedCount >= VoxelGrid.slabVolume(chunk)) {
      // Every voxel in this slab has an explicit written value — no implicit
      // air left unaccounted for, so the true written min/max is exact.
      return { min: slab.minDensity, max: slab.maxDensity };
    }
    // Still some untouched positions in this slab — they're honestly air (0),
    // so fold that baseline in (density is always >= 0, so it never affects max).
    return { min: Math.min(0, slab.minDensity), max: Math.max(0, slab.maxDensity) };
  }

  // ── Cubic 16×16×16 slab storage (#1182) ──
  //
  // One lazily-allocated `VoxelSlab` per 16-row y-band, keyed by
  // `cy = chunkIndexOf(y)`, allocated only on a write that differs from the
  // implicit air default. A single-entry cache (below) keeps the common case
  // — repeated access to the same slab, as every hot-path scan exhibits — at
  // one `Map.get` instead of two.

  /** Allocate a fresh, all-air `VoxelSlab` (CHUNK_SIZE**3 = 4096 voxels). */
  private allocateSlab(): VoxelSlab {
    return {
      density: new Float64Array(4096),
      compId: new Uint16Array(4096),
      fracture: new Float64Array(4096).fill(1.0),
      ores: new Map(),
      touched: new Uint8Array(4096),
      touchedCount: 0,
      minDensity: Infinity,
      maxDensity: -Infinity,
    };
  }

  /** Single-entry slab lookup cache — same rationale as `cacheKey`/`cacheChunk` above, one level down. */
  private slabCacheKey = -1;
  private slabCacheSlab: VoxelSlab | undefined = undefined;

  /** Packs a chunk's coordinates and a y-band index into one collision-free numeric key for the slab cache. */
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
   * Resolve the slab covering (x, y, z) in `chunk` (may be absent — never
   * allocates), its chunk-local y-band `cy`, and the slab-local flat index
   * `i` — the local index is pure coordinate arithmetic, valid whether or not
   * a slab is actually allocated there, so every accessor and mutator shares
   * this one lookup instead of re-deriving cy/i itself.
   */
  private resolveCell(chunk: VoxelChunk, x: number, y: number, z: number): { slab: VoxelSlab | undefined; cy: number; i: number } {
    const cy = chunkIndexOf(y);
    const i = VoxelGrid.localIndex(chunk, cy, x, y, z);
    return { slab: this.slabAt(chunk, y), cy, i };
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
  get allocatedChunkCount(): number {
    let sum = 0;
    for (const chunk of this.chunks.values()) sum += chunk.slabs.size;
    return sum;
  }

  /** Number of allocated slabs in column (cx, cz); 0 if the column is unowned. */
  slabCount(cx: number, cz: number): number {
    return this.chunks.get(chunkKey(cx, cz))?.slabs.size ?? 0;
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

  /** Density in [0, 1]. Coordinates the site does not own, or an unallocated slab, read as 0 (air). */
  densityAt(x: number, y: number, z: number): number {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return 0;
    const { slab, i } = this.resolveCell(chunk, x, y, z);
    return slab ? slab.density[i]! : 0;
  }

  /** True when density >= 0.5 — the shared "solid for meshing/physics" threshold. */
  isSolidAt(x: number, y: number, z: number): boolean {
    return this.densityAt(x, y, z) >= 0.5;
  }

  /** Fracture modifier (1.0 = normal, < 1.0 = pre-cracked). Unowned coordinates, or an unallocated slab, read as 1.0. */
  fractureAt(x: number, y: number, z: number): number {
    const chunk = this.ownerOfRead(x, y, z);
    if (!chunk) return 1.0;
    const { slab, i } = this.resolveCell(chunk, x, y, z);
    return slab ? slab.fracture[i]! : 1.0;
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
    const prevDensity = existing ? existing.density[i]! : 0;
    const prevCompId = existing ? existing.compId[i]! : 0;
    const prevOres = existing ? existing.ores.get(i) : undefined;
    const prevFracture = existing ? existing.fracture[i]! : 1.0;
    const newOres = ores && Object.keys(ores).length > 0 ? ores : undefined;

    // No-op write (identical to what's already there, or to the implicit air
    // default in an unallocated slab): skip entirely, so a fillVoxel that
    // changes nothing never allocates a slab.
    if (prevDensity === density && prevCompId === compId && prevFracture === 1.0 && oresDeepEqual(prevOres, newOres)) {
      return;
    }

    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.density[i] = density;
    slab.compId[i] = compId;
    slab.fracture[i] = 1.0;
    if (newOres) slab.ores.set(i, { ...newOres });
    else slab.ores.delete(i);
    this.touch(chunk);
    this.touchDensity(slab, i, density);
    this.recordVoxelWrite(x, y, z, prevDensity, prevCompId, prevOres, density, compId, slab.ores.get(i));
    this.recordFractureWrite(x, y, z, prevFracture, 1.0);
  }

  setFractureAt(x: number, y: number, z: number, value: number): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const prev = existing ? existing.fracture[i]! : 1.0;
    if (prev === value) return; // no-op: skip without allocating a slab
    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.fracture[i] = value;
    this.touch(chunk);
    this.recordFractureWrite(x, y, z, prev, value);
  }

  /** Multiply the fracture modifier in place (e.g. cracking a voxel that didn't fully fracture). */
  scaleFractureAt(x: number, y: number, z: number, factor: number): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const prev = existing ? existing.fracture[i]! : 1.0;
    const next = prev * factor;
    if (prev === next) return; // no-op: skip without allocating a slab
    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.fracture[i] = next;
    this.touch(chunk);
    this.recordFractureWrite(x, y, z, prev, next);
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
    const prevDensity = existing ? existing.density[i]! : 0;
    const prevCompId = existing ? existing.compId[i]! : 0;
    const prevOres = existing ? existing.ores.get(i) : undefined;
    const prevFracture = existing ? existing.fracture[i]! : 1.0;

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
    this.touch(chunk);
    this.touchDensity(slab, i, voxel.density);
    this.recordVoxelWrite(x, y, z, prevDensity, prevCompId, prevOres, voxel.density, newCompId, slab.ores.get(i));
    this.recordFractureWrite(x, y, z, prevFracture, voxel.fractureModifier);
  }

  clearVoxel(x: number, y: number, z: number): void {
    const chunk = this.ownerOf(x, y, z);
    if (!chunk) return;
    const { slab: existing, cy, i } = this.resolveCell(chunk, x, y, z);
    const prevDensity = existing ? existing.density[i]! : 0;
    const prevCompId = existing ? existing.compId[i]! : 0;
    const prevOres = existing ? existing.ores.get(i) : undefined;
    const prevFracture = existing ? existing.fracture[i]! : 1.0;

    // Already air (explicitly, or by an unallocated slab's implicit default): no-op.
    if (prevDensity === 0 && prevCompId === 0 && prevFracture === 1.0 && prevOres === undefined) {
      return;
    }

    const slab = existing ?? this.getOrCreateSlab(chunk, cy);
    slab.density[i] = 0;
    slab.compId[i] = 0;
    slab.fracture[i] = 1.0;
    slab.ores.delete(i);
    this.touch(chunk);
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
   * Visits only solid (density > 0) voxels, chunk by chunk, slab by allocated
   * slab — an unallocated slab (all-air) is skipped entirely without a scan.
   * Each slab's y-band is clamped to `[0, sizeY - 1]`, today's visible bound,
   * before walking it.
   */
  forEachSolid(cb: (x: number, y: number, z: number, compId: number) => void): void {
    for (const chunk of this.chunks.values()) {
      for (const [cy, slab] of chunk.slabs) {
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

  forEachSolidInRegion(
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
    cb: (x: number, y: number, z: number, compId: number) => void,
  ): void {
    this.forEachInRegion(min, max, (x, y, z) => {
      const chunk = this.ownerOf(x, y, z)!;
      const slab = this.slabAt(chunk, y);
      if (!slab) return;
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
 * >= 0.5. Returns -1 if the column is entirely void. Out-of-bounds (x, z)
 * coordinates are clamped to the grid limits.
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
export function computeVoxelColumnSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  if (grid.sizeX <= 0 || grid.sizeZ <= 0) return -1;

  const { cx, cz } = clampToGridColumn(grid, x, z);
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    if (grid.isSolidAt(cx, y, cz)) return y;
  }
  return -1;
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
 * actually renders at that column right now, pre- or post-blast. Returns 0
 * for an owned column with no solid voxel at all.
 *
 * Unlike computeVoxelColumnSurfaceY, does NOT clamp an out-of-bounds (x, z)
 * to the edge column — it returns NaN instead (#559). LandscapeMesh's live
 * boundary-height sampling needs an honest "no live data here" signal at the
 * claim edge, since the claim itself moves; a silent clamp there produced
 * the seam this function's fix closes.
 */
export function computeVoxelColumnSurfaceHeight(grid: VoxelGrid, x: number, z: number): number {
  if (grid.sizeX <= 0 || grid.sizeZ <= 0) return 0;
  if (!grid.containsColumn(x, z)) return NaN;

  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    const density0 = grid.densityAt(cx, y, cz);
    if (density0 >= 0.5) {
      // Same crossing interpolation as TerrainMesh's emitVertex: the voxel
      // above a topmost-solid voxel is air-side (density < 0.5, or 0 past
      // the grid's own top), and the fractional height along that edge is
      // where density == 0.5. Matches marching cubes exactly.
      const density1 = grid.densityAt(cx, y + 1, cz);
      let t = 0.5;
      if (Math.abs(density1 - density0) > 1e-6) {
        t = (0.5 - density0) / (density1 - density0);
      }
      t = Math.max(0, Math.min(1, t));
      return y + t;
    }
  }
  return 0;
}

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
 * A `height` outside [0, grid.sizeY - 1] is not rejected or reported — it is
 * silently clamped into the grid's representable vertical range before the
 * write, so a caller passing an out-of-range value gets a clamped result
 * rather than a signal that anything was off.
 *
 * Returns the highest Y index written or cleared by this call, or -1 for a
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
): number {
  if (!grid.containsColumn(x, z)) return -1;
  if (!Number.isFinite(height)) return -1;

  // Read the OLD surface before clamping `height`. `containsColumn` above
  // already guarantees (x, z) is in bounds, so clampToGridColumn (inside
  // computeVoxelColumnSurfaceY) is a no-op here either way — this ordering
  // is simply the natural "read old, then compute new" sequence, not a
  // correctness requirement.
  const existingTopY = computeVoxelColumnSurfaceY(grid, x, z);
  const clampedHeight = Math.max(0, Math.min(grid.sizeY - 1, height));

  // Union of "what used to be filled that must now clear" and "what the new
  // crossing band needs" — never reaches below either surface, so an
  // overhang or cavity buried deeper in the column is left untouched.
  const lowY = Math.max(0, Math.min(existingTopY + 1, Math.floor(clampedHeight) - SURFACE_BAND_HALF + 1));
  const highY = Math.min(grid.sizeY - 1, Math.max(existingTopY, Math.ceil(clampedHeight) + SURFACE_BAND_HALF - 1));

  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let y = lowY; y <= highY; y++) {
    const density = surfaceDensityAt(y, clampedHeight);
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
  oldTopY: number,
): number | null {
  if (!grid.containsColumn(x, z)) return null;

  const newTopY = computeVoxelColumnSurfaceY(grid, x, z);
  if (newTopY === oldTopY) return null;

  const cx = Math.floor(x);
  const cz = Math.floor(z);

  // Bounded sweep: the only place a legitimate pre-existing crossing band
  // above the old top could have been sitting. Never reaches further than
  // SURFACE_BAND_HALF above oldTopY, so this is O(SURFACE_BAND_HALF), not a
  // column-wide scan.
  let touchedMaxY: number | null = null;
  const sweepHigh = Math.min(grid.sizeY - 1, oldTopY + SURFACE_BAND_HALF);
  for (let y = oldTopY + 1; y <= sweepHigh; y++) {
    if (grid.densityAt(cx, y, cz) !== 0) {
      grid.clearVoxel(cx, y, cz);
      touchedMaxY = touchedMaxY === null ? y : Math.max(touchedMaxY, y);
    }
  }

  if (newTopY < 0) return touchedMaxY;

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

  return touchedMaxY === null ? bandTop : Math.max(touchedMaxY, bandTop);
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
): Map<string, { x: number; z: number; oldTopY: number }> {
  const columns = new Map<string, { x: number; z: number; oldTopY: number }>();
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
  columns: ReadonlyMap<string, { x: number; z: number; oldTopY: number }>,
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
    if (topY >= 0) composition = grid.compositionAt(x, topY, z);
  }
  return grid.palette.intern(composition);
}
