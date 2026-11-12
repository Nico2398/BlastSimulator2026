// BlastSimulator2026 — The NavGrid cells a fragment covers.
//
// A fragment blocks every cell its body covers on the ground, not only the
// cell of its centre: a rock two metres across occupies two cells' worth of
// ground. NavGrid cell c spans [c - 0.5, c + 0.5) (fragments are rounded to
// cells everywhere else), so a fragment spanning [x - hx, x + hx] covers every
// cell it overlaps by more than FRAGMENT_FOOTPRINT_MIN_OVERLAP_M — on that
// cell's ground: a rock lying at the foot of a crater wall does not block the
// rim above it, and a rock sealed under intact rock blocks no surface at all.
import { FRAGMENT_DRIVABLE_MAX_VOLUME_M3, FRAGMENT_FOOTPRINT_MIN_OVERLAP_M, FRAGMENT_GROUND_TOLERANCE_M } from '../config/balance.js';

/** Whether `fragment` blocks vehicles: anything bigger than the gravel they drive over (FRAGMENT_DRIVABLE_MAX_VOLUME_M3). */
export function fragmentBlocksVehicles(fragment: FootprintFragment): boolean {
  return fragment.volume === undefined || fragment.volume > FRAGMENT_DRIVABLE_MAX_VOLUME_M3 + 1e-9;
}

/** What the footprint reads of a fragment: its centre and, when known, its half-extents. */
export interface FootprintFragment {
  readonly id?: number;
  /** m³; absent counts as blocking (hand-built fixtures). */
  readonly volume?: number;
  readonly position: { readonly x: number; readonly y?: number; readonly z: number };
  readonly halfExtents?: { readonly x: number; readonly y?: number; readonly z: number };
}

/**
 * Whether `fragment` lies on the ground of a cell whose surface is `surfaceY`: its top
 * reaches that surface (within FRAGMENT_GROUND_TOLERANCE_M). A rock below a cell's
 * surface — sealed under it, or at the foot of the wall that cell tops — is not on it.
 * True when either height is unknown (hand-built grids model no terrain).
 */
export function fragmentRestsOn(fragment: FootprintFragment, surfaceY: number | undefined): boolean {
  const y = fragment.position.y;
  if (surfaceY === undefined || y === undefined) return true;
  const hy = fragment.halfExtents?.y;
  return y + (hy !== undefined && Number.isFinite(hy) ? Math.max(0, hy) : 0) >= surfaceY - FRAGMENT_GROUND_TOLERANCE_M;
}

/** First and last cell index along one axis covered by a body centred at `c` with half-width `h`. */
function coveredRange(c: number, h: number): [number, number] {
  const centre = Math.round(c);
  const lo = Math.ceil(c - h - 0.5 + FRAGMENT_FOOTPRINT_MIN_OVERLAP_M);
  const hi = Math.floor(c + h + 0.5 - FRAGMENT_FOOTPRINT_MIN_OVERLAP_M);
  return [Math.min(lo, centre), Math.max(hi, centre)];
}

/**
 * Every NavGrid cell `fragment` covers, its centre cell always included. A
 * fragment without half-extents (hand-built fixtures) covers its centre cell.
 */
export function fragmentFootprintCells(fragment: FootprintFragment): Array<{ x: number; z: number }> {
  const { x0, x1, z0, z1 } = footprintBounds(fragment);
  const cells: Array<{ x: number; z: number }> = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells.push({ x, z });
  return cells;
}

/**
 * The cells within `reach` cells (Chebyshev) of `fragment`'s footprint, outside it: where a
 * vehicle stands to load or break the rock, since the rock's own cells are not driven on.
 * Nearest ring first.
 */
export function fragmentRingCells(fragment: FootprintFragment, reach = 1): Array<{ x: number; z: number; ring: number }> {
  const { x0, x1, z0, z1 } = footprintBounds(fragment);
  const cells: Array<{ x: number; z: number; ring: number }> = [];
  for (let z = z0 - reach; z <= z1 + reach; z++) {
    for (let x = x0 - reach; x <= x1 + reach; x++) {
      const ring = Math.max(x0 - x, x - x1, z0 - z, z - z1);
      if (ring <= 0) continue;
      cells.push({ x, z, ring });
    }
  }
  return cells.sort((a, b) => a.ring - b.ring);
}

function footprintBounds(fragment: FootprintFragment): { x0: number; x1: number; z0: number; z1: number } {
  const h = fragment.halfExtents;
  const [x0, x1] = coveredRange(fragment.position.x, h && Number.isFinite(h.x) ? Math.max(0, h.x) : 0);
  const [z0, z1] = coveredRange(fragment.position.z, h && Number.isFinite(h.z) ? Math.max(0, h.z) : 0);
  return { x0, x1, z0, z1 };
}
