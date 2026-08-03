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
 * One chunk of storage: CHUNK_SIZE × sizeY × CHUNK_SIZE voxels, plus the
 * sub-rect of it the site actually owns.
 *
 * `x0/z0/x1/z1` (max exclusive) exist because a site's *initial* rect is not
 * required to be a multiple of CHUNK_SIZE — a 24 m level occupies 2×2 chunks
 * but owns only 24 m of them. Every chunk claimed by expansion owns its full
 * span, and `growToFull` promotes a partial chunk when play reaches past it.
 */
interface VoxelChunk {
  readonly cx: number;
  readonly cz: number;
  x0: number; z0: number; x1: number; z1: number;
  readonly density: Float64Array;
  readonly compId: Uint16Array;
  readonly fracture: Float64Array;
  /** Sparse, keyed by chunk-local flat index. Only voxels with ore pay for a Record. */
  readonly ores: Map<number, Record<string, number>>;
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

  isInBounds(x: number, y: number, z: number): boolean {
    if (y < 0 || y >= this.sizeY) return false;
    const chunk = this.chunkAt(x, z);
    if (!chunk) return false;
    return x >= chunk.x0 && x < chunk.x1 && z >= chunk.z0 && z < chunk.z1;
  }

  /** True when the site owns the column at (x, z), regardless of height. */
  containsColumn(x: number, z: number): boolean {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return false;
    return x >= chunk.x0 && x < chunk.x1 && z >= chunk.z0 && z < chunk.z1;
  }

  /** The owned chunk covering (x, z), or null. */
  private chunkAt(x: number, z: number): VoxelChunk | null {
    const key = chunkKey(chunkIndexOf(x), chunkIndexOf(z));
    if (key === this.cacheKey) return this.cacheChunk;
    const chunk = this.chunks.get(key) ?? null;
    this.cacheKey = key;
    this.cacheChunk = chunk;
    return chunk;
  }

  /** Chunk-local flat index. x fastest, then y, then z — same axis order the dense layout used. */
  private static localIndex(chunk: VoxelChunk, x: number, y: number, z: number, sizeY: number): number {
    const lx = x - chunk.cx * CHUNK_SIZE;
    const lz = z - chunk.cz * CHUNK_SIZE;
    return lx + y * CHUNK_SIZE + lz * CHUNK_SIZE * sizeY;
  }

  /** Resolve (x, y, z) to its chunk and local index, or null when the site does not own it. */
  private resolve(x: number, y: number, z: number): { chunk: VoxelChunk; i: number } | null {
    if (y < 0 || y >= this.sizeY) return null;
    const chunk = this.chunkAt(x, z);
    if (!chunk) return null;
    if (x < chunk.x0 || x >= chunk.x1 || z < chunk.z0 || z >= chunk.z1) return null;
    return { chunk, i: VoxelGrid.localIndex(chunk, x, y, z, this.sizeY) };
  }

  /** Same as `resolve`, but reports the miss to the installed bounds reporter (reads only). */
  private resolveRead(x: number, y: number, z: number): { chunk: VoxelChunk; i: number } | null {
    const hit = this.resolve(x, y, z);
    if (!hit && outOfBoundsReporter) outOfBoundsReporter(x, y, z);
    return hit;
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
    chunk.x0 = rect.minX; chunk.z0 = rect.minZ; chunk.x1 = rect.maxX; chunk.z1 = rect.maxZ;
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

  private allocateChunk(cx: number, cz: number): VoxelChunk {
    const n = CHUNK_SIZE * this.sizeY * CHUNK_SIZE;
    const chunk: VoxelChunk = {
      cx, cz,
      x0: cx * CHUNK_SIZE, z0: cz * CHUNK_SIZE,
      x1: cx * CHUNK_SIZE + CHUNK_SIZE, z1: cz * CHUNK_SIZE + CHUNK_SIZE,
      density: new Float64Array(n),
      compId: new Uint16Array(n),
      fracture: new Float64Array(n).fill(1.0),
      ores: new Map(),
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

  // ── Direct field accessors — no allocation, hot-path callers should prefer these ──

  /** Density in [0, 1]. Coordinates the site does not own read as 0 (air). */
  densityAt(x: number, y: number, z: number): number {
    const hit = this.resolveRead(x, y, z);
    return hit ? hit.chunk.density[hit.i]! : 0;
  }

  /** True when density >= 0.5 — the shared "solid for meshing/physics" threshold. */
  isSolidAt(x: number, y: number, z: number): boolean {
    return this.densityAt(x, y, z) >= 0.5;
  }

  /** Fracture modifier (1.0 = normal, < 1.0 = pre-cracked). Unowned coordinates read as 1.0. */
  fractureAt(x: number, y: number, z: number): number {
    const hit = this.resolveRead(x, y, z);
    return hit ? hit.chunk.fracture[hit.i]! : 1.0;
  }

  /** The shared, frozen composition object for this voxel. Treat as immutable. */
  compositionAt(x: number, y: number, z: number): VoxelRockComposition {
    const hit = this.resolveRead(x, y, z);
    if (!hit) return this.palette.get(0).comp;
    return this.palette.get(hit.chunk.compId[hit.i]!).comp;
  }

  /** Dominant rock ID, precomputed at intern time. '' for air or unowned coordinates. */
  dominantRockAt(x: number, y: number, z: number): string {
    const hit = this.resolveRead(x, y, z);
    if (!hit) return '';
    return this.palette.get(hit.chunk.compId[hit.i]!).dominantRockId;
  }

  /** Ore densities at this voxel, or undefined if it carries no ore (the common case). */
  oresAt(x: number, y: number, z: number): Record<string, number> | undefined {
    const hit = this.resolveRead(x, y, z);
    if (!hit) return undefined;
    return hit.chunk.ores.get(hit.i);
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
    const hit = this.resolve(x, y, z);
    if (!hit) return;
    const { chunk, i } = hit;
    chunk.density[i] = density;
    chunk.compId[i] = compId;
    chunk.fracture[i] = 1.0;
    if (ores && Object.keys(ores).length > 0) chunk.ores.set(i, { ...ores });
    else chunk.ores.delete(i);
    this.touch(chunk);
  }

  setFractureAt(x: number, y: number, z: number, value: number): void {
    const hit = this.resolve(x, y, z);
    if (!hit) return;
    hit.chunk.fracture[hit.i] = value;
    this.touch(hit.chunk);
  }

  /** Multiply the fracture modifier in place (e.g. cracking a voxel that didn't fully fracture). */
  scaleFractureAt(x: number, y: number, z: number, factor: number): void {
    const hit = this.resolve(x, y, z);
    if (!hit) return;
    hit.chunk.fracture[hit.i] = hit.chunk.fracture[hit.i]! * factor;
    this.touch(hit.chunk);
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
    const hit = this.resolveRead(x, y, z);
    if (!hit) return undefined;
    const { chunk, i } = hit;
    const ores = chunk.ores.get(i);
    return {
      composition: this.palette.get(chunk.compId[i]!).comp,
      density: chunk.density[i]!,
      oreDensities: ores ? { ...ores } : {},
      fractureModifier: chunk.fracture[i]!,
    };
  }

  setVoxel(x: number, y: number, z: number, voxel: VoxelData): void {
    const hit = this.resolve(x, y, z);
    if (!hit) return;
    const { chunk, i } = hit;
    chunk.compId[i] = this.palette.intern(voxel.composition);
    chunk.density[i] = voxel.density;
    chunk.fracture[i] = voxel.fractureModifier;
    if (Object.keys(voxel.oreDensities).length > 0) chunk.ores.set(i, { ...voxel.oreDensities });
    else chunk.ores.delete(i);
    this.touch(chunk);
  }

  clearVoxel(x: number, y: number, z: number): void {
    const hit = this.resolve(x, y, z);
    if (!hit) return;
    const { chunk, i } = hit;
    chunk.density[i] = 0;
    chunk.compId[i] = 0;
    chunk.fracture[i] = 1.0;
    chunk.ores.delete(i);
    this.touch(chunk);
  }

  // ── Raw chunk storage access — for VoxelGridCodec (save serialization) only ──
  // Treat the returned arrays as read-only; use the mutators above to write.
  // Exposed as the live arrays/map (no copy) since encoding immediately reads them.

  rawChunk(cx: number, cz: number): {
    rect: { minX: number; minZ: number; maxX: number; maxZ: number };
    density: Float64Array;
    compId: Uint16Array;
    fracture: Float64Array;
    oreEntries: Array<[number, Record<string, number>]>;
  } | null {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return null;
    return {
      rect: { minX: chunk.x0, minZ: chunk.z0, maxX: chunk.x1, maxZ: chunk.z1 },
      density: chunk.density,
      compId: chunk.compId,
      fracture: chunk.fracture,
      oreEntries: [...chunk.ores.entries()],
    };
  }

  /** Overwrite one chunk's raw storage from a decoded save payload. For VoxelGridCodec only. */
  restoreChunkRaw(
    cx: number, cz: number,
    rect: { minX: number; minZ: number; maxX: number; maxZ: number },
    density: Float64Array, compId: Uint16Array, fracture: Float64Array,
    ores: ReadonlyMap<number, Record<string, number>>,
  ): void {
    let chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) chunk = this.allocateChunk(cx, cz);
    chunk.x0 = rect.minX; chunk.z0 = rect.minZ; chunk.x1 = rect.maxX; chunk.z1 = rect.maxZ;
    chunk.density.set(density);
    chunk.compId.set(compId);
    chunk.fracture.set(fracture);
    chunk.ores.clear();
    for (const [i, rec] of ores) chunk.ores.set(i, rec);
    this.recomputeBounds();
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

  /** Visits only solid (density > 0) voxels, chunk by chunk. */
  forEachSolid(cb: (x: number, y: number, z: number, compId: number) => void): void {
    for (const chunk of this.chunks.values()) {
      for (let z = chunk.z0; z < chunk.z1; z++) {
        for (let y = 0; y < this.sizeY; y++) {
          for (let x = chunk.x0; x < chunk.x1; x++) {
            const i = VoxelGrid.localIndex(chunk, x, y, z, this.sizeY);
            if (chunk.density[i]! > 0) cb(x, y, z, chunk.compId[i]!);
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
      const hit = this.resolve(x, y, z)!;
      if (hit.chunk.density[hit.i]! > 0) cb(x, y, z, hit.chunk.compId[hit.i]!);
    });
  }
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

  const cx = Math.max(grid.minX, Math.min(grid.maxX - 1, Math.floor(x)));
  const cz = Math.max(grid.minZ, Math.min(grid.maxZ - 1, Math.floor(z)));
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    if (grid.isSolidAt(cx, y, cz)) return y;
  }
  return -1;
}
