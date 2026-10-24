import { hasClearance, type NavGrid } from './NavGrid.js';
import { isTraversableCell, type ReachableSet } from './NavGridReachability.js';
import { NEIGHBOUR_OFFSETS_8 } from './NeighbourOffsets.js';

/** How many thin cells deep a docking strip may run from the base: ring cell beside a footprint, then the strip beside that ring (#1840). */
const DOCKING_HOPS = 2;

/**
 * Widen a reachable set with the docking cells around it: a cell the set does
 * not hold, that is traversable, whose clearance is below `requiredClearance`,
 * and that touches (8 neighbours) a cell the set holds, or touches another
 * such docking cell, up to `DOCKING_HOPS` cells deep. Each hop is 8-way, so a
 * query costs about 1 + 8 + 64 lookups at two hops: bounded, the widened set
 * stays O(1) per query (#1603).
 *
 * Two hops, not unbounded: the clearance-1 ring a building footprint leaves
 * around itself can sit in a strip between footprint and wall, entered only
 * through the ring's end, so the order's approach cell is two cells from the
 * clearance-2 base (#1840). A cell three or more thin cells away stays out.
 */
export function withDockingCells(
  navGrid: NavGrid,
  base: Pick<ReachableSet, 'has'>,
  requiredClearance: number,
): Pick<ReachableSet, 'has'> {
  const docks = (x: number, z: number, hops: number): boolean => {
    if (base.has(x, z)) return true;
    if (hops === 0) return false;
    const cell = navGrid.cellAt(x, z);
    if (cell === undefined || !isTraversableCell(navGrid, x, z) || hasClearance(cell, requiredClearance)) return false;
    return NEIGHBOUR_OFFSETS_8.some(([dx, dz]) => docks(x + dx, z + dz, hops - 1));
  };
  return { has: (x, z) => docks(x, z, DOCKING_HOPS) };
}

/**
 * Where vehicle sources stand for a reachability query: a vehicle parked on a docking cell (a thin cell
 * `withDockingCells` adds) stands for the cells of clearance `requiredClearance` it docked from, up to
 * `DOCKING_HOPS` thin cells away; any other source stands where it is, rounded (#2045). A fleet parked at the
 * warehouse dock otherwise reaches no component, and every order it serves reads out of reach, so no driver
 * is ever sent back to it.
 */
export function dockedFrom(
  navGrid: NavGrid,
  sources: ReadonlyArray<{ x: number; z: number }>,
  requiredClearance: number,
): { x: number; z: number }[] {
  const thin = (x: number, z: number): boolean => {
    const cell = navGrid.cellAt(x, z);
    return cell !== undefined && isTraversableCell(navGrid, x, z) && !hasClearance(cell, requiredClearance);
  };
  const base = (x: number, z: number): boolean => {
    const cell = navGrid.cellAt(x, z);
    return cell !== undefined && isTraversableCell(navGrid, x, z) && hasClearance(cell, requiredClearance);
  };
  const out: { x: number; z: number }[] = [];
  for (const source of sources) {
    const x = Math.round(source.x);
    const z = Math.round(source.z);
    if (!thin(x, z)) {
      out.push({ x, z });
      continue;
    }
    const found = new Map<string, { x: number; z: number }>();
    let frontier = [{ x, z }];
    const seen = new Set([`${x},${z}`]);
    for (let hop = 0; hop < DOCKING_HOPS && frontier.length > 0; hop++) {
      const nextFrontier: { x: number; z: number }[] = [];
      for (const at of frontier) {
        for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
          const nx = at.x + dx;
          const nz = at.z + dz;
          const key = `${nx},${nz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (base(nx, nz)) found.set(key, { x: nx, z: nz });
          else if (thin(nx, nz)) nextFrontier.push({ x: nx, z: nz });
        }
      }
      frontier = nextFrontier;
    }
    if (found.size === 0) out.push({ x, z });
    else out.push(...found.values());
  }
  return out;
}
