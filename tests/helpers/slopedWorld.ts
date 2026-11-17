// BlastSimulator2026 — hand-built floor and plateau joined by ramp corridors of chosen grades (#2288)
//
// Like gradedRamps.ts but with the floor length, rise and width chosen by the test, so a commute across it is long
// enough to be worth a ride. Corridor i is BAND_ROWS wide and stepped at exactly tan(degrees[i]) per cell until the
// rise is spent; corridors are split by blocked rows and meet only on the floor (x <= floorEnd) and the plateau.

import { NavGrid, type NavCell } from '../../src/core/nav/NavGrid.js';

export const BAND_ROWS = 3;

export interface SlopedWorldOpts {
  width: number;
  /** Last floor column; the first ramp cell is floorEnd + 1. */
  floorEnd: number;
  /** Height of the plateau above the floor, metres. */
  rise: number;
  /** One corridor per entry, top (z = 1) to bottom. */
  degrees: readonly number[];
}

const tanDeg = (d: number): number => Math.tan(d * Math.PI / 180);

/** First column past the ramp of a corridor graded at `deg`. */
export function corridorEndX(opts: Pick<SlopedWorldOpts, 'floorEnd' | 'rise'>, deg: number): number {
  return opts.floorEnd + Math.ceil(opts.rise / tanDeg(deg) - 1e-9);
}

/** First plateau column: past the end of the gentlest corridor. */
export function plateauStartX(opts: SlopedWorldOpts): number {
  return Math.max(...opts.degrees.map(d => corridorEndX(opts, d))) + 1;
}

/** Centre row of corridor `index`. */
export function corridorCentreZ(index: number): number {
  return index * (BAND_ROWS + 1) + 2;
}

function cell(open: boolean, y: number): NavCell {
  return { type: open ? 'walkable' : 'blocked', moveCost: open ? 1 : Infinity, benchLevel: 0, vehicleOccupied: false, surfaceY: y, climbY: y };
}

export function buildSlopedWorld(opts: SlopedWorldOpts): NavGrid {
  const { width, floorEnd, rise, degrees } = opts;
  const height = degrees.length * (BAND_ROWS + 1) + 1;
  const plateauStart = plateauStartX(opts);
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    const band = Math.floor((z - 1) / (BAND_ROWS + 1));
    const separator = z % (BAND_ROWS + 1) === 0;
    for (let x = 0; x < width; x++) {
      if (separator) row.push(cell(x <= floorEnd || x >= plateauStart, x <= floorEnd ? 0 : rise));
      else row.push(cell(true, Math.min(rise, Math.max(0, x - floorEnd) * tanDeg(degrees[band]!))));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells, rise);
}
