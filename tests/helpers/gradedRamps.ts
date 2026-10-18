// BlastSimulator2026 — hand-built pit with graded ramps for climb-limit tests (#1938)
//
// A low floor (x <= FLOOR_END_X) joined to a high plateau by one ramp corridor
// per requested grade. Each corridor is RAMP_BAND_ROWS wide and stepped at exactly
// tan(grade) per cell until the rise is spent, so its steepest step IS the
// requested grade. Corridors sit side by side, split by blocked rows, and meet
// only on the floor and on the plateau. Surfaces are written to `surfaceY` and
// `climbY`, the two fields climb gating reads.

import { NavGrid, type NavCell } from '../../src/core/nav/NavGrid.js';
import type { BuiltRamp, GameState } from '../../src/core/state/GameState.js';

export const GRADED_WIDTH = 24;
export const GRADED_RISE = 2.4;
export const FLOOR_END_X = 3;
const RAMP_BAND_ROWS = 3;

/** First plateau column of a corridor graded at `deg`. */
export function gradedRampEndX(deg: number): number {
  return FLOOR_END_X + Math.ceil(GRADED_RISE / Math.tan(deg * Math.PI / 180) - 1e-9);
}

/** Centre row (z) of corridor `index`. */
export function bandCentreZ(index: number): number {
  return index * (RAMP_BAND_ROWS + 1) + 2;
}

function cell(type: NavCell['type'], y: number): NavCell {
  const open = type === 'walkable';
  return { type, moveCost: open ? 1 : Infinity, benchLevel: 0, vehicleOccupied: false, surfaceY: y, climbY: y };
}

/** Surface height at column x of a corridor graded at `deg`. */
function heightAt(x: number, deg: number): number {
  return Math.min(GRADED_RISE, Math.max(0, x - FLOOR_END_X) * Math.tan(deg * Math.PI / 180));
}

/** Grid with one corridor per entry of `degrees` (top to bottom). */
export function buildGradedRampGrid(degrees: readonly number[]): NavGrid {
  const height = degrees.length * (RAMP_BAND_ROWS + 1) + 1;
  const plateauStart = Math.max(...degrees.map(gradedRampEndX)) + 1;
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    const band = Math.floor((z - 1) / (RAMP_BAND_ROWS + 1));
    const isSeparator = (z % (RAMP_BAND_ROWS + 1)) === 0;
    for (let x = 0; x < GRADED_WIDTH; x++) {
      if (isSeparator) {
        const open = x <= FLOOR_END_X || x >= plateauStart;
        row.push(cell(open ? 'walkable' : 'blocked', x <= FLOOR_END_X ? 0 : GRADED_RISE));
      } else {
        row.push(cell('walkable', heightAt(x, degrees[band]!)));
      }
    }
    cells.push(row);
  }
  return new NavGrid(GRADED_WIDTH, height, cells, GRADED_RISE);
}

/** Built-ramp record for corridor `index`, footprint spanning floor mouth to plateau. */
export function gradedBuiltRamp(index: number, deg: number, id: number = index + 1): BuiltRamp {
  const minZ = index * (RAMP_BAND_ROWS + 1) + 1;
  const maxX = gradedRampEndX(deg);
  return {
    id,
    width: 3,
    def: { originX: FLOOR_END_X, originZ: minZ, direction: 'east', length: maxX - FLOOR_END_X, targetDepth: 0, width: 3 },
    footprint: { minX: FLOOR_END_X, maxX, minZ, maxZ: minZ + RAMP_BAND_ROWS - 1 },
  };
}

/** Install the grid and built-ramp records on `state`. */
export function installGradedRamps(state: GameState, degrees: readonly number[]): BuiltRamp[] {
  state.navGrid = buildGradedRampGrid(degrees);
  state.builtRamps = degrees.map((deg, i) => gradedBuiltRamp(i, deg));
  state.nextBuiltRampId = degrees.length + 1;
  return state.builtRamps;
}
