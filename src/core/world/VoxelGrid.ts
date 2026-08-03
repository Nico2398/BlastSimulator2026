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
 * 3D grid of voxels, stored as struct-of-arrays typed arrays plus a
 * deduped composition palette (see `CompositionPalette`).
 * Coordinate system: x = east, y = up, z = north.
 * Each cell represents 1 m × 1 m × 1 m. All grid coordinates are in metres.
 */
export class VoxelGrid {
  /** Size (in metres) of one voxel cell along each axis. Always 1.0 m. */
  static readonly CELL_SIZE = 1.0;

  /** Unique ID for this grid instance — useful for debugging reference tracking. */
  static nextId = 1;
  readonly id = VoxelGrid.nextId++;

  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly palette = new CompositionPalette();

  private readonly density: Float64Array;
  private readonly compId: Uint16Array;
  private readonly fracture: Float64Array;
  /** Sparse: only voxels with at least one ore entry pay for a Record. Keyed by flat voxel index. */
  private readonly ores = new Map<number, Record<string, number>>();

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    const n = sizeX * sizeY * sizeZ;
    this.density = new Float64Array(n);
    this.compId = new Uint16Array(n);
    this.fracture = new Float64Array(n).fill(1.0);
  }

  isInBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX
      && y >= 0 && y < this.sizeY
      && z >= 0 && z < this.sizeZ;
  }

  private index(x: number, y: number, z: number): number {
    return x + y * this.sizeX + z * this.sizeX * this.sizeY;
  }

  // ── Direct field accessors — no allocation, hot-path callers should prefer these ──

  /** Density in [0, 1]. Out-of-bounds coordinates read as 0 (air). */
  densityAt(x: number, y: number, z: number): number {
    return this.isInBounds(x, y, z) ? this.density[this.index(x, y, z)]! : 0;
  }

  /** True when density >= 0.5 — the shared "solid for meshing/physics" threshold. */
  isSolidAt(x: number, y: number, z: number): boolean {
    return this.densityAt(x, y, z) >= 0.5;
  }

  /** Fracture modifier (1.0 = normal, < 1.0 = pre-cracked). Out-of-bounds reads as 1.0. */
  fractureAt(x: number, y: number, z: number): number {
    return this.isInBounds(x, y, z) ? this.fracture[this.index(x, y, z)]! : 1.0;
  }

  /** The shared, frozen composition object for this voxel. Treat as immutable. */
  compositionAt(x: number, y: number, z: number): VoxelRockComposition {
    if (!this.isInBounds(x, y, z)) return this.palette.get(0).comp;
    return this.palette.get(this.compId[this.index(x, y, z)]!).comp;
  }

  /** Dominant rock ID, precomputed at intern time. '' for air or out-of-bounds. */
  dominantRockAt(x: number, y: number, z: number): string {
    if (!this.isInBounds(x, y, z)) return '';
    return this.palette.get(this.compId[this.index(x, y, z)]!).dominantRockId;
  }

  /** Ore densities at this voxel, or undefined if it carries no ore (the common case). */
  oresAt(x: number, y: number, z: number): Record<string, number> | undefined {
    if (!this.isInBounds(x, y, z)) return undefined;
    return this.ores.get(this.index(x, y, z));
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
    if (!this.isInBounds(x, y, z)) return;
    const i = this.index(x, y, z);
    this.density[i] = density;
    this.compId[i] = compId;
    this.fracture[i] = 1.0;
    if (ores && Object.keys(ores).length > 0) this.ores.set(i, { ...ores });
    else this.ores.delete(i);
  }

  setFractureAt(x: number, y: number, z: number, value: number): void {
    if (!this.isInBounds(x, y, z)) return;
    this.fracture[this.index(x, y, z)] = value;
  }

  /** Multiply the fracture modifier in place (e.g. cracking a voxel that didn't fully fracture). */
  scaleFractureAt(x: number, y: number, z: number, factor: number): void {
    if (!this.isInBounds(x, y, z)) return;
    const i = this.index(x, y, z);
    this.fracture[i] = this.fracture[i]! * factor;
  }

  // ── Compatibility API — materializes a VoxelData-shaped object per call ──

  /**
   * Returns undefined out of bounds. The returned object is a fresh wrapper;
   * `.composition` is the shared frozen palette entry (immutable by
   * contract), `.oreDensities` is a fresh shallow copy. Mutating the
   * returned wrapper's own fields does not write back to the grid — use the
   * direct mutators above, or `setVoxel`, to write.
   */
  getVoxel(x: number, y: number, z: number): VoxelData | undefined {
    if (!this.isInBounds(x, y, z)) return undefined;
    const i = this.index(x, y, z);
    const ores = this.ores.get(i);
    return {
      composition: this.palette.get(this.compId[i]!).comp,
      density: this.density[i]!,
      oreDensities: ores ? { ...ores } : {},
      fractureModifier: this.fracture[i]!,
    };
  }

  setVoxel(x: number, y: number, z: number, voxel: VoxelData): void {
    if (!this.isInBounds(x, y, z)) return;
    const i = this.index(x, y, z);
    this.compId[i] = this.palette.intern(voxel.composition);
    this.density[i] = voxel.density;
    this.fracture[i] = voxel.fractureModifier;
    if (Object.keys(voxel.oreDensities).length > 0) this.ores.set(i, { ...voxel.oreDensities });
    else this.ores.delete(i);
  }

  clearVoxel(x: number, y: number, z: number): void {
    if (!this.isInBounds(x, y, z)) return;
    const i = this.index(x, y, z);
    this.density[i] = 0;
    this.compId[i] = 0;
    this.fracture[i] = 1.0;
    this.ores.delete(i);
  }

  // ── Raw storage access — for VoxelGridCodec (save serialization) only ──
  // Treat all four as read-only; use the mutators above to write. Exposed
  // as the live arrays/map (no copy) since encoding immediately reads them.

  get rawDensity(): Float64Array { return this.density; }
  get rawCompId(): Uint16Array { return this.compId; }
  get rawFracture(): Float64Array { return this.fracture; }
  get rawOreEntries(): Array<[number, Record<string, number>]> { return [...this.ores.entries()]; }

  /** Overwrite this grid's raw storage from a decoded save payload. For VoxelGridCodec only. */
  restoreRaw(density: Float64Array, compId: Uint16Array, fracture: Float64Array, ores: ReadonlyMap<number, Record<string, number>>): void {
    this.density.set(density);
    this.compId.set(compId);
    this.fracture.set(fracture);
    this.ores.clear();
    for (const [i, rec] of ores) this.ores.set(i, rec);
  }

  /** Get all voxels within a bounding box (inclusive on both ends). */
  getRegion(
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
  ): RegionEntry[] {
    const results: RegionEntry[] = [];
    const x0 = Math.max(0, min.x);
    const y0 = Math.max(0, min.y);
    const z0 = Math.max(0, min.z);
    const x1 = Math.min(this.sizeX - 1, max.x);
    const y1 = Math.min(this.sizeY - 1, max.y);
    const z1 = Math.min(this.sizeZ - 1, max.z);

    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          results.push({ x, y, z, data: this.getVoxel(x, y, z)! });
        }
      }
    }
    return results;
  }

  // ── Iteration — visits only solid (density > 0) voxels ──

  forEachSolid(cb: (x: number, y: number, z: number, compId: number) => void): void {
    for (let z = 0; z < this.sizeZ; z++) {
      for (let y = 0; y < this.sizeY; y++) {
        for (let x = 0; x < this.sizeX; x++) {
          const i = this.index(x, y, z);
          if (this.density[i]! > 0) cb(x, y, z, this.compId[i]!);
        }
      }
    }
  }

  forEachSolidInRegion(
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
    cb: (x: number, y: number, z: number, compId: number) => void,
  ): void {
    const x0 = Math.max(0, min.x);
    const y0 = Math.max(0, min.y);
    const z0 = Math.max(0, min.z);
    const x1 = Math.min(this.sizeX - 1, max.x);
    const y1 = Math.min(this.sizeY - 1, max.y);
    const z1 = Math.min(this.sizeZ - 1, max.z);

    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = this.index(x, y, z);
          if (this.density[i]! > 0) cb(x, y, z, this.compId[i]!);
        }
      }
    }
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

  const cx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(x)));
  const cz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(z)));
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    if (grid.isSolidAt(cx, y, cz)) return y;
  }
  return -1;
}
