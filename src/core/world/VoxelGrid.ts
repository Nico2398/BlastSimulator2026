// BlastSimulator2026 — 3D voxel grid for terrain representation
// Each cell holds rock composition, density, ore densities, and fracture modifier.
// Voxel size: 1 m × 1 m × 1 m (SI units throughout).

export interface VoxelRockComposition {
  /** Up to 4 rock types with coefficients summing to 1.0. Empty array = air. */
  rocks: Array<{ rockId: string; coefficient: number }>;
}

export interface VoxelCell {
  /** Rock composition (empty = air). */
  composition: VoxelRockComposition;
  /** Legacy convenience: primary rock ID from composition (empty string for air). */
  rockId: string;
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
  data: VoxelCell;
}

/** Helper: get the rockId with the highest coefficient from a composition. Returns empty string if empty or undefined. */
export function getPrimaryRockId(composition: VoxelRockComposition | undefined): string {
  if (!composition || !composition.rocks || composition.rocks.length === 0) return '';
  let best = '';
  let bestCoeff = 0;
  for (const r of composition.rocks) {
    if (r.coefficient > bestCoeff) {
      bestCoeff = r.coefficient;
      best = r.rockId;
    }
  }
  return best;
}

/** Helper: check if a cell is air (density === 0 or composition empty). */
export function isAirCell(cell: VoxelCell): boolean {
  return cell.density === 0 || !cell.composition || cell.composition.rocks.length === 0;
}

function emptyVoxel(): VoxelCell {
  return { composition: { rocks: [] }, rockId: '', density: 0, oreDensities: {}, fractureModifier: 1.0 };
}

/**
 * 3D grid of voxels. Stored as a flat array indexed by (x, y, z).
 * Coordinate system: x = east, y = up, z = north.
 */
export class VoxelGrid {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  private readonly data: VoxelCell[];

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.data = new Array(sizeX * sizeY * sizeZ);
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] = emptyVoxel();
    }
  }

  isInBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX
      && y >= 0 && y < this.sizeY
      && z >= 0 && z < this.sizeZ;
  }

  private index(x: number, y: number, z: number): number {
    return x + y * this.sizeX + z * this.sizeX * this.sizeY;
  }

  getVoxel(x: number, y: number, z: number): VoxelCell | undefined {
    if (!this.isInBounds(x, y, z)) return undefined;
    return this.data[this.index(x, y, z)];
  }

  setVoxel(x: number, y: number, z: number, voxel: VoxelCell): void {
    if (!this.isInBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = voxel;
  }

  clearVoxel(x: number, y: number, z: number): void {
    if (!this.isInBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = emptyVoxel();
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
          const data = this.data[this.index(x, y, z)]!;
          results.push({ x, y, z, data });
        }
      }
    }
    return results;
  }
}
