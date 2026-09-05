// BlastSimulator2026 — Unit tests: NavGrid
// Tasks 5.15–5.19: NavGrid surface detection, full build, dirty-region patch after blast
//
// Test breakdown:
//   computeSurfaceY (§1–3):   solid column, air column, out-of-bounds clamping
//   buildNavGrid     (§4–9):   dimensions, void vs walkable, drill_hole, blocked, priority
//   patchNavGrid     (§10–14): region isolation, no-op, clamping, walkable→void transition
//   BlastResult      (§15):    clearedRegion returned by executeBlast

import { describe, it, expect, beforeEach } from 'vitest';
import { NavGrid, type NavCellType, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import type { Building } from '../../../src/core/entities/Building.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import type { BlastRegion } from '../../../src/core/mining/BlastExecution.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';
import { addHole } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { buildRamp } from '../../../src/core/mining/Ramp.js';
import { NAV_MAX_CLIMB_HEIGHT } from '../../../src/core/config/balance.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Create a solid voxel with optional overrides. */
function solidVoxel(overrides?: Partial<VoxelData>): VoxelData {
  return {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
    ...overrides,
  };
}

/** Build a VoxelGrid where every column has solid rock from y=0 to solidTopY (inclusive). */
function makeSolidGrid(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  solidTopY: number,
): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y <= solidTopY; y++) {
        grid.setVoxel(x, y, z, solidVoxel());
      }
    }
  }
  return grid;
}

/** Build a VoxelGrid where only a specific column (cx, cz) has solid rock. */
function makeSingleColumnGrid(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  cx: number,
  cz: number,
  solidTopY: number,
): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let y = 0; y <= solidTopY; y++) {
    grid.setVoxel(cx, y, cz, solidVoxel());
  }
  return grid;
}

/** Convert a NavGrid to a flat map of (x,z) → type for easy inspection. */
function cellTypeMap(grid: NavGrid): Map<string, NavCellType> {
  const map = new Map<string, NavCellType>();
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      map.set(`${x},${z}`, grid.cells[z]![x]!.type);
    }
  }
  return map;
}

/** Fully-charged blast plan for integration-style tests. Uses dynatomics (1300 J/kg × 5 kg). */
function makeBlastPlan(holes: DrillHole[]) {
  const holeIds = holes.map(h => h.id);
  const holeDepths: Record<string, number> = {};
  for (const h of holes) holeDepths[h.id] = h.depth;
  const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 5, 1);
  const delays = autoVPattern(holes, 25);
  return assembleBlastPlan(holes, charges, delays);
}

/** Standard test grid: 20 × 10 × 20, solid rock y=0..4. */
function makeTestGrid(): VoxelGrid {
  return makeSolidGrid(20, 10, 20, 4);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: computeSurfaceY
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid.computeSurfaceY', () => {
  it('returns the topmost solid Y for a column with solid rock', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    // Rock at y=0..4 → top solid voxel is y=4 → surface Y = 4
    const y = NavGrid.computeSurfaceY(grid, 3, 3);
    expect(y).toBe(4);
  });

  it('returns -1 for a column with no rock (all air)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const y = NavGrid.computeSurfaceY(grid, 0, 0);
    expect(y).toBe(-1);
  });

  it('clamps out-of-bounds x coordinate to grid limits', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    // Column (-1, 0) should be clamped to (0, 0) — solid rock at y=4
    const y = NavGrid.computeSurfaceY(grid, -5, 0);
    expect(y).toBe(4);
  });

  it('clamps out-of-bounds z coordinate to grid limits', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    // Column (0, 999) should be clamped to (0, 9) — solid rock at y=4
    const y = NavGrid.computeSurfaceY(grid, 0, 999);
    expect(y).toBe(4);
  });

  it('returns -1 when clamped column still has no solid voxel', () => {
    const grid = makeSingleColumnGrid(10, 10, 10, 5, 5, 4);
    // Column (5,5) has rock; column (20,5) clamps to (9,5) which has no rock
    const y = NavGrid.computeSurfaceY(grid, 20, 5);
    expect(y).toBe(-1);
  });

  it('returns -1 for a column where density is below 0.5', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Set voxel at y=5 with density 0.3 (below the 0.5 threshold)
    grid.setVoxel(0, 5, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 0.3,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    const y = NavGrid.computeSurfaceY(grid, 0, 0);
    expect(y).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2: buildNavGrid — dimensions and basic cell types
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid.buildNavGrid — dimensions', () => {
  it('creates a grid with width = voxelGrid.sizeX and height = voxelGrid.sizeZ', () => {
    const grid = makeSolidGrid(15, 8, 25, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    expect(nav.width).toBe(15);
    expect(nav.height).toBe(25);
  });

  it('creates a grid with width = 1 and height = 1 for a minimal voxel grid', () => {
    const grid = makeSolidGrid(1, 5, 1, 2);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    expect(nav.width).toBe(1);
    expect(nav.height).toBe(1);
  });

  it('populates every cell (non-empty cells array) for a small grid', () => {
    const grid = makeSolidGrid(3, 5, 4, 2);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    expect(nav.cells.length).toBe(4); // height = sizeZ = 4
    for (let z = 0; z < 4; z++) {
      expect(nav.cells[z]!.length).toBe(3); // width = sizeX = 3
    }
  });
});

describe('NavGrid.buildNavGrid — cell type derivation', () => {
  it('marks all-air columns as void with Infinity moveCost', () => {
    const grid = new VoxelGrid(5, 10, 5);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    const types = cellTypeMap(nav);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        expect(types.get(`${x},${z}`)).toBe('void');
        expect(nav.cells[z]![x]!.moveCost).toBe(Infinity);
      }
    }
  });

  it('marks all-solid columns as walkable with moveCost 1.0', () => {
    const grid = makeSolidGrid(5, 10, 5, 3);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        expect(nav.cells[z]![x]!.type).toBe('walkable');
        expect(nav.cells[z]![x]!.moveCost).toBe(1.0);
      }
    }
  });

  it('marks a column with a drill hole as drill_hole with moveCost 5.0', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const holes: DrillHole[] = [
      { id: 'H1', x: 3, z: 3, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, [], holes);
    const cell = nav.cells[3]![3]!;
    expect(cell.type).toBe('drill_hole');
    expect(cell.moveCost).toBe(5.0);
  });

  it('marks a column under a building footprint as blocked with Infinity moveCost', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 2, z: 2, hp: 80, active: true },
    ];
    const nav = NavGrid.buildNavGrid(grid, buildings, []);
    // management_office tier 1 has footprint rect(2,2) covering cells
    // (2,2), (3,2), (2,3), (3,3) relative to origin
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const cx = 2 + dx;
      const cz = 2 + dz;
      expect(nav.cells[cz]![cx]!.type).toBe('blocked');
      expect(nav.cells[cz]![cx]!.moveCost).toBe(Infinity);
    }
  });

  it('leaves cells outside building footprint as walkable', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 0, z: 0, hp: 80, active: true },
    ];
    const nav = NavGrid.buildNavGrid(grid, buildings, []);
    // Cell (5,5) is far from the footprint at (0,0)-(1,1)
    expect(nav.cells[5]![5]!.type).toBe('walkable');
  });
});

describe('NavGrid.buildNavGrid — cell type priority', () => {
  it('gives void highest priority: void column stays void even with a drill hole', () => {
    const grid = new VoxelGrid(10, 10, 10); // all air
    const holes: DrillHole[] = [
      { id: 'H1', x: 2, z: 2, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, [], holes);
    // Column (2,2) has a drill hole but is void (all air) → should be void
    expect(nav.cells[2]![2]!.type).toBe('void');
    expect(nav.cells[2]![2]!.moveCost).toBe(Infinity);
  });

  it('gives void highest priority: void column stays void even with a building', () => {
    const grid = new VoxelGrid(10, 10, 10); // all air
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 2, z: 2, hp: 80, active: true },
    ];
    const nav = NavGrid.buildNavGrid(grid, buildings, []);
    // Column (2,2) has a building footprint but is void → should be void
    expect(nav.cells[2]![2]!.type).toBe('void');
  });

  it('gives drill_hole priority over blocked (drill_hole > blocked)', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 2, z: 2, hp: 80, active: true },
    ];
    const holes: DrillHole[] = [
      { id: 'H1', x: 2, z: 2, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, buildings, holes);
    // Column (2,2) is both in building footprint AND has a drill hole
    // drill_hole should win over blocked
    expect(nav.cells[2]![2]!.type).toBe('drill_hole');
    expect(nav.cells[2]![2]!.moveCost).toBe(5.0);
  });

  it('gives blocked priority over walkable (blocked > walkable)', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 3, z: 3, hp: 80, active: true },
    ];
    const nav = NavGrid.buildNavGrid(grid, buildings, []);
    // Cell (3,3) is in building footprint → blocked
    expect(nav.cells[3]![3]!.type).toBe('blocked');
    // Cell (9,9) is not in building footprint → walkable
    expect(nav.cells[9]![9]!.type).toBe('walkable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2b: buildNavGrid — ramp detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid.buildNavGrid — ramp detection', () => {
  it('flat terrain produces no ramp cells', () => {
    // 5×5 grid all solid at Y=4 → all cells surfaceY=4 → all neighbors same → no ramp
    const grid = makeSolidGrid(5, 10, 5, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    const types = cellTypeMap(nav);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        expect(types.get(`${x},${z}`)).not.toBe('ramp');
      }
    }
  });

  it('ramp detected when neighbor surface Y differs by > 1', () => {
    // 3×3 grid, center column (1,1) solidY=4, neighbor (1,2) solidY=2
    // Diff = |4-2| = 2 (> 1) → center should be ramp
    const grid = new VoxelGrid(3, 10, 3);
    // Fill center column solid to Y=4
    for (let y = 0; y <= 4; y++) grid.setVoxel(1, y, 1, solidVoxel());
    // Fill south neighbor column solid to Y=2 (lower)
    for (let y = 0; y <= 2; y++) grid.setVoxel(1, y, 2, solidVoxel());
    // Fill remaining columns solid to Y=4 to avoid void neighbors
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        if ((x === 1 && z === 1) || (x === 1 && z === 2)) continue;
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const nav = NavGrid.buildNavGrid(grid, [], []);
    expect(nav.cells[1]![1]!.type).toBe('ramp');
  });

  it('ramp NOT triggered when neighbor diff = 1', () => {
    // 3×3 grid, center solidY=4, neighbor solidY=3 → diff=1 (not > 1) → walkable
    const grid = new VoxelGrid(3, 10, 3);
    for (let y = 0; y <= 4; y++) grid.setVoxel(1, y, 1, solidVoxel());
    for (let y = 0; y <= 3; y++) grid.setVoxel(1, y, 2, solidVoxel());
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        if ((x === 1 && z === 1) || (x === 1 && z === 2)) continue;
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const nav = NavGrid.buildNavGrid(grid, [], []);
    expect(nav.cells[1]![1]!.type).toBe('walkable');
  });

  it('ramp cell has moveCost 1.8', () => {
    // 3×3 grid with height diff > 1 → ramp cell should have moveCost 1.8
    const grid = new VoxelGrid(3, 10, 3);
    for (let y = 0; y <= 4; y++) grid.setVoxel(1, y, 1, solidVoxel());
    for (let y = 0; y <= 2; y++) grid.setVoxel(1, y, 2, solidVoxel());
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        if ((x === 1 && z === 1) || (x === 1 && z === 2)) continue;
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const nav = NavGrid.buildNavGrid(grid, [], []);
    expect(nav.cells[1]![1]!.moveCost).toBe(1.8);
  });

  it('ramp detected with height diff on each cardinal direction', () => {
    // North: center (2,2) solidY=4, north neighbor (2,1) solidY=2
    const gridNorth = new VoxelGrid(5, 10, 5);
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++)
        for (let y = 0; y <= 4; y++) gridNorth.setVoxel(x, y, z, solidVoxel());
    // Lower north neighbor column
    for (let y = 0; y <= 4; y++) gridNorth.clearVoxel(2, y, 1);
    for (let y = 0; y <= 2; y++) gridNorth.setVoxel(2, y, 1, solidVoxel());
    const navNorth = NavGrid.buildNavGrid(gridNorth, [], []);
    expect(navNorth.cells[1]![2]!.type).toBe('ramp');

    // South: center (2,2) solidY=4, south neighbor (2,3) solidY=2
    const gridSouth = new VoxelGrid(5, 10, 5);
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++)
        for (let y = 0; y <= 4; y++) gridSouth.setVoxel(x, y, z, solidVoxel());
    for (let y = 0; y <= 4; y++) gridSouth.clearVoxel(2, y, 3);
    for (let y = 0; y <= 2; y++) gridSouth.setVoxel(2, y, 3, solidVoxel());
    const navSouth = NavGrid.buildNavGrid(gridSouth, [], []);
    expect(navSouth.cells[3]![2]!.type).toBe('ramp');

    // West: center (2,2) solidY=4, west neighbor (1,2) solidY=2
    const gridWest = new VoxelGrid(5, 10, 5);
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++)
        for (let y = 0; y <= 4; y++) gridWest.setVoxel(x, y, z, solidVoxel());
    for (let y = 0; y <= 4; y++) gridWest.clearVoxel(1, y, 2);
    for (let y = 0; y <= 2; y++) gridWest.setVoxel(1, y, 2, solidVoxel());
    const navWest = NavGrid.buildNavGrid(gridWest, [], []);
    expect(navWest.cells[2]![1]!.type).toBe('ramp');

    // East: center (2,2) solidY=4, east neighbor (3,2) solidY=2
    const gridEast = new VoxelGrid(5, 10, 5);
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++)
        for (let y = 0; y <= 4; y++) gridEast.setVoxel(x, y, z, solidVoxel());
    for (let y = 0; y <= 4; y++) gridEast.clearVoxel(3, y, 2);
    for (let y = 0; y <= 2; y++) gridEast.setVoxel(3, y, 2, solidVoxel());
    const navEast = NavGrid.buildNavGrid(gridEast, [], []);
    expect(navEast.cells[2]![3]!.type).toBe('ramp');
  });

  it('ramp does NOT override void', () => {
    // Cell (1,1) is void (all air), adjacent to height-diff column
    // void has higher priority than ramp
    const grid = new VoxelGrid(3, 10, 3);
    // Fill all columns solid to Y=4 first
    for (let z = 0; z < 3; z++)
      for (let x = 0; x < 3; x++)
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());
    // Clear column (1,1) to make it void
    for (let y = 0; y <= 4; y++) grid.clearVoxel(1, y, 1);
    // Lower column (1,2) to create height diff adjacent to void column
    for (let y = 0; y <= 4; y++) grid.clearVoxel(1, y, 2);
    for (let y = 0; y <= 2; y++) grid.setVoxel(1, y, 2, solidVoxel());
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // (1,1) is void → should not become ramp due to adjacent height diff
    expect(nav.cells[1]![1]!.type).toBe('void');
    expect(nav.cells[1]![1]!.moveCost).toBe(Infinity);
  });

  it('ramp does NOT override drill_hole', () => {
    // Cell with both a drill hole and adjacent height diff → drill_hole wins
    const grid = new VoxelGrid(3, 10, 3);
    for (let z = 0; z < 3; z++)
      for (let x = 0; x < 3; x++)
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());
    // Lower column (1,2) to create height diff with (1,1)
    for (let y = 0; y <= 4; y++) grid.clearVoxel(1, y, 2);
    for (let y = 0; y <= 2; y++) grid.setVoxel(1, y, 2, solidVoxel());
    const holes: DrillHole[] = [
      { id: 'H1', x: 1, z: 1, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, [], holes);
    expect(nav.cells[1]![1]!.type).toBe('drill_hole');
    expect(nav.cells[1]![1]!.moveCost).toBe(5.0);
  });

  it('ramp does NOT override blocked', () => {
    // Cell under a building footprint with adjacent height diff → blocked wins
    const grid = new VoxelGrid(5, 10, 5);
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++)
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());
    // Lower column (2,1) to create height diff with (2,2)
    for (let y = 0; y <= 4; y++) grid.clearVoxel(2, y, 1);
    for (let y = 0; y <= 2; y++) grid.setVoxel(2, y, 1, solidVoxel());
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 2, z: 2, hp: 80, active: true },
    ];
    const nav = NavGrid.buildNavGrid(grid, buildings, []);
    // (2,2) is in building footprint AND adjacent to height diff → blocked wins over ramp
    expect(nav.cells[2]![2]!.type).toBe('blocked');
    expect(nav.cells[2]![2]!.moveCost).toBe(Infinity);
  });

  it('edge cell on flat terrain is walkable, not ramp', () => {
    // 1-wide column strip: edge cells have out-of-bounds neighbors
    // Clamping should not create false ramps on flat terrain
    const grid = makeSolidGrid(1, 10, 5, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    for (let z = 0; z < 5; z++) {
      expect(nav.cells[z]![0]!.type).toBe('walkable');
    }
  });

  it('a neighbour delta well beyond NAV_MAX_CLIMB_HEIGHT does NOT classify as ramp — bounded band (#953)', () => {
    // 3×3 grid, center column (1,1) solidY=10, south neighbor (1,2) lowered
    // far past NAV_MAX_CLIMB_HEIGHT — an eight-metre crater wall, matching
    // the issue's own example. Before the fix, ramp classification was
    // unbounded (any delta > 1), so an 8-voxel cliff read as a walkable
    // 'ramp' at cost 1.8, identical to a dug haul road.
    const centerTop = 10;
    const bigDelta = NAV_MAX_CLIMB_HEIGHT + 6;
    const neighborTop = centerTop - bigDelta;
    const grid = new VoxelGrid(3, 15, 3);
    for (let y = 0; y <= centerTop; y++) grid.setVoxel(1, y, 1, solidVoxel());
    for (let y = 0; y <= neighborTop; y++) grid.setVoxel(1, y, 2, solidVoxel());
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        if ((x === 1 && z === 1) || (x === 1 && z === 2)) continue;
        for (let y = 0; y <= centerTop; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // Bounded band: delta > NAV_MAX_CLIMB_HEIGHT falls through to walkable,
    // never ramp — the actual impassability gate lives in Pathfinding.
    expect(nav.cells[1]![1]!.type).toBe('walkable');
  });
});

describe('NavGrid.buildNavGrid — surfaceY population (#953)', () => {
  it('populates NavCell.surfaceY with the column\'s computed surface Y', () => {
    const grid = makeSolidGrid(5, 10, 5, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // Column (2,2) has solid rock y=0..4 → surfaceY = 4, matching
    // NavGrid.computeSurfaceY's own contract for the same column.
    expect(nav.cells[2]![2]!.surfaceY).toBe(NavGrid.computeSurfaceY(grid, 2, 2));
    expect(nav.cells[2]![2]!.surfaceY).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2c: buildNavGrid — ramp detection after a real Ramp.buildRamp() carve on
// realistic (elevated) terrain. Regression coverage for issue #407: buildRamp
// treating depth as an absolute world Y meant it never changed a column's
// surface height, so this classification path never fired outside hand-crafted
// NavCell fixtures.
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid.buildNavGrid — ramp detection after buildRamp() on elevated terrain', () => {
  it('produces at least one ramp-typed cell along a freshly carved ramp path', () => {
    // Flat plateau at surface Y=22 (not flat-from-0) — every column starts on the
    // same bench, so before carving there is no natural elevation cliff anywhere.
    const grid = makeSolidGrid(20, 30, 30, 22);
    const beforeNav = NavGrid.buildNavGrid(grid, [], []);
    // Sanity: uniformly flat terrain has no ramp cells yet.
    for (let z = 0; z < 30; z++) {
      for (let x = 0; x < 20; x++) {
        expect(beforeNav.cells[z]![x]!.type).not.toBe('ramp');
      }
    }

    const rampResult = buildRamp(grid, {
      originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 10,
    }, 100000);
    expect(rampResult.success).toBe(true);

    const afterNav = NavGrid.buildNavGrid(grid, [], []);
    let rampCellCount = 0;
    for (let z = 0; z < 30; z++) {
      for (let x = 0; x < 20; x++) {
        if (afterNav.cells[z]![x]!.type === 'ramp') rampCellCount++;
      }
    }
    // The fix must make at least one carved column register as a ramp-typed cell.
    expect(rampCellCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3: patchNavGrid — dirty-region update
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid.patchNavGrid — region isolation', () => {
  it('updates only cells within the specified region', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // All cells start as walkable
    expect(nav.cells[0]![0]!.type).toBe('walkable');

    // Clear a specific column in the voxel grid
    grid.clearVoxel(0, 4, 0);
    grid.clearVoxel(0, 3, 0);
    grid.clearVoxel(0, 2, 0);
    grid.clearVoxel(0, 1, 0);
    grid.clearVoxel(0, 0, 0);

    // Patch only column (0,0)
    const region: BlastRegion = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // Cell (0,0) should now be void (its voxels were cleared)
    expect(nav.cells[0]![0]!.type).toBe('void');
    expect(nav.cells[0]![0]!.moveCost).toBe(Infinity);
  });

  it('leaves cells outside the region unchanged', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // Record expected types before patch
    const beforeOutside = nav.cells[5]![5]!.type;

    // Clear column (0,0) in voxel grid
    for (let y = 0; y <= 4; y++) grid.clearVoxel(0, y, 0);

    // Patch only region containing (0,0)
    const region: BlastRegion = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // Cells outside the region must have the same type as before
    expect(nav.cells[5]![5]!.type).toBe(beforeOutside);
  });

  it('creates cells with all expected fields after region update', () => {
    const grid = makeSolidGrid(8, 10, 8, 4);
    const holes: DrillHole[] = [
      { id: 'H1', x: 1, z: 1, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, [], holes);
    // Cell (1,1) is drill_hole
    expect(nav.cells[1]![1]!.type).toBe('drill_hole');

    // Clear column (1,1) so it becomes void
    for (let y = 0; y <= 4; y++) grid.clearVoxel(1, y, 1);

    // Patch region covering (1,1)
    const region: BlastRegion = { minX: 1, maxX: 1, minZ: 1, maxZ: 1 };
    NavGrid.patchNavGrid(nav, grid, [], holes, region);

    // Now drill_hole should change to void (rock removed)
    expect(nav.cells[1]![1]!.type).toBe('void');
    // vehicleOccupied and benchLevel should still be present
    expect(nav.cells[1]![1]!.vehicleOccupied).toBe(false);
    expect(nav.cells[1]![1]!.benchLevel).toBe(0);
  });
});

describe('NavGrid.patchNavGrid — boundary conditions', () => {
  it('is a no-op when the region is empty (minX > maxX)', () => {
    const grid = makeSolidGrid(5, 10, 5, 3);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    const snapshot = cellTypeMap(nav);

    // Empty region: min > max
    const region: BlastRegion = { minX: 5, maxX: 3, minZ: 0, maxZ: 0 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    const after = cellTypeMap(nav);
    expect(after).toEqual(snapshot);
  });

  it('is a no-op when the region is empty (minZ > maxZ)', () => {
    const grid = makeSolidGrid(5, 10, 5, 3);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    const snapshot = cellTypeMap(nav);

    const region: BlastRegion = { minX: 0, maxX: 0, minZ: 5, maxZ: 2 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    const after = cellTypeMap(nav);
    expect(after).toEqual(snapshot);
  });

  it('is a no-op for the sentinel empty region (minX=0, maxX=-1, minZ=0, maxZ=-1)', () => {
    const grid = makeSolidGrid(5, 10, 5, 3);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    const snapshot = cellTypeMap(nav);

    // This sentinel value is what executeBlast returns when no voxels are cleared
    const region: BlastRegion = { minX: 0, maxX: -1, minZ: 0, maxZ: -1 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    const after = cellTypeMap(nav);
    expect(after).toEqual(snapshot);
  });

  it('clamps region that extends beyond grid bounds', () => {
    const grid = makeSolidGrid(5, 10, 5, 3);
    const nav = NavGrid.buildNavGrid(grid, [], []);

    // Clear all rock in the grid so any patched cell becomes void
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y <= 3; y++) {
          grid.clearVoxel(x, y, z);
        }
      }
    }

    // Region extends far beyond the grid on all sides
    const region: BlastRegion = { minX: -10, maxX: 20, minZ: -10, maxZ: 20 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // All cells should now be void (rock was cleared)
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        expect(nav.cells[z]![x]!.type).toBe('void');
        expect(nav.cells[z]![x]!.moveCost).toBe(Infinity);
      }
    }
  });

  it('clamps region partially out of bounds on one side', () => {
    const grid = makeSolidGrid(5, 10, 5, 3);
    const nav = NavGrid.buildNavGrid(grid, [], []);

    // Clear column (0,0)
    for (let y = 0; y <= 3; y++) grid.clearVoxel(0, y, 0);

    // Region starts at minX=-5, so it clamps to 0. maxX=0 makes it just column 0.
    const region: BlastRegion = { minX: -5, maxX: 0, minZ: 0, maxZ: 0 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // Cell (0,0) should be void; cell (1,0) should remain walkable
    expect(nav.cells[0]![0]!.type).toBe('void');
    expect(nav.cells[0]![1]!.type).toBe('walkable');
  });

  it('recomputes move cost when cell type changes', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const holes: DrillHole[] = [
      { id: 'H1', x: 4, z: 4, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, [], holes);

    // Before: (4,4) is drill_hole with moveCost 5.0
    expect(nav.cells[4]![4]!.type).toBe('drill_hole');
    expect(nav.cells[4]![4]!.moveCost).toBe(5.0);

    // Clear the drill hole column so it becomes void
    for (let y = 0; y <= 4; y++) grid.clearVoxel(4, y, 4);

    // Patch region containing (4,4), but don't pass drill holes
    const region: BlastRegion = { minX: 4, maxX: 4, minZ: 4, maxZ: 4 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // After: (4,4) should be void with Infinity cost
    expect(nav.cells[4]![4]!.type).toBe('void');
    expect(nav.cells[4]![4]!.moveCost).toBe(Infinity);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3c: patchNavGrid — additional scenarios (building, drill hole, multi-cell,
//           full-grid equivalence, ramp formation, building demolition)
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid.patchNavGrid — building footprint changes', () => {
  it('marks cells as blocked when a building is placed within the patch region', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // All cells start as walkable
    expect(nav.cells[3]![3]!.type).toBe('walkable');

    // Add a building at (3,3) — management_office t1 has 2×2 footprint
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 3, z: 3, hp: 80, active: true },
    ];

    // Patch region covering the entire building footprint
    const region: BlastRegion = { minX: 3, maxX: 4, minZ: 3, maxZ: 4 };
    NavGrid.patchNavGrid(nav, grid, buildings, [], region);

    // All cells in the building footprint should be blocked
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const cx = 3 + dx;
      const cz = 3 + dz;
      expect(nav.cells[cz]![cx]!.type).toBe('blocked');
      expect(nav.cells[cz]![cx]!.moveCost).toBe(Infinity);
    }
  });

  it('leaves non-footprint cells walkable when building is placed', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // Building at (0,0) covers (0,0)-(1,1)
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 0, z: 0, hp: 80, active: true },
    ];
    const region: BlastRegion = { minX: 0, maxX: 3, minZ: 0, maxZ: 3 };
    NavGrid.patchNavGrid(nav, grid, buildings, [], region);

    // Cell (3,3) is outside the building footprint → walkable
    expect(nav.cells[3]![3]!.type).toBe('walkable');
    expect(nav.cells[3]![3]!.moveCost).toBe(1.0);
  });

  it('reverts blocked cells after building is removed from the array', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    // Build with building present
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 2, z: 2, hp: 80, active: true },
    ];
    const nav = NavGrid.buildNavGrid(grid, buildings, []);
    expect(nav.cells[2]![2]!.type).toBe('blocked');

    // Now "demolish" by passing empty buildings array and patching the region
    const region: BlastRegion = { minX: 2, maxX: 3, minZ: 2, maxZ: 3 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // Cells should revert to walkable (voxels are still solid)
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const cx = 2 + dx;
      const cz = 2 + dz;
      expect(nav.cells[cz]![cx]!.type).toBe('walkable');
    }
  });
});

describe('NavGrid.patchNavGrid — drill hole changes', () => {
  it('marks cell as drill_hole when a drill hole is added within the patch region', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    expect(nav.cells[5]![5]!.type).toBe('walkable');

    // Add a drill hole at (5,5)
    const holes: DrillHole[] = [
      { id: 'H1', x: 5, z: 5, depth: 5, diameter: 0.15 },
    ];
    const region: BlastRegion = { minX: 5, maxX: 5, minZ: 5, maxZ: 5 };
    NavGrid.patchNavGrid(nav, grid, [], holes, region);

    expect(nav.cells[5]![5]!.type).toBe('drill_hole');
    expect(nav.cells[5]![5]!.moveCost).toBe(5.0);
  });

  it('makes cell void when drill hole column rock is cleared and holes are still passed', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const holes: DrillHole[] = [
      { id: 'H1', x: 2, z: 2, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, [], holes);
    expect(nav.cells[2]![2]!.type).toBe('drill_hole');

    // Clear the rock in the drill hole column so surface becomes void
    for (let y = 0; y <= 4; y++) grid.clearVoxel(2, y, 2);

    const region: BlastRegion = { minX: 2, maxX: 2, minZ: 2, maxZ: 2 };
    // Still pass holes — but void should take priority over drill_hole
    NavGrid.patchNavGrid(nav, grid, [], holes, region);

    expect(nav.cells[2]![2]!.type).toBe('void');
    expect(nav.cells[2]![2]!.moveCost).toBe(Infinity);
  });

  it('gives drill_hole priority over blocked when both overlap in a patched region', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 2, z: 2, hp: 80, active: true },
    ];
    const holes: DrillHole[] = [
      { id: 'H1', x: 2, z: 2, depth: 5, diameter: 0.15 },
    ];
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // Initially (2,2) is walkable
    expect(nav.cells[2]![2]!.type).toBe('walkable');

    // Patch with both building and drill hole — drill_hole should win
    const region: BlastRegion = { minX: 2, maxX: 3, minZ: 2, maxZ: 3 };
    NavGrid.patchNavGrid(nav, grid, buildings, holes, region);

    expect(nav.cells[2]![2]!.type).toBe('drill_hole');
    expect(nav.cells[2]![2]!.moveCost).toBe(5.0);
  });
});

describe('NavGrid.patchNavGrid — multi-cell rectangular region', () => {
  it('updates every cell in a 3×3 rectangular region', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    // All cells are walkable initially

    // Clear voxels in a contiguous 3×3 area (cells become void)
    for (let z = 3; z <= 5; z++) {
      for (let x = 3; x <= 5; x++) {
        for (let y = 0; y <= 4; y++) grid.clearVoxel(x, y, z);
      }
    }

    const region: BlastRegion = { minX: 3, maxX: 5, minZ: 3, maxZ: 5 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // Inside: all void
    for (let z = 3; z <= 5; z++) {
      for (let x = 3; x <= 5; x++) {
        expect(nav.cells[z]![x]!.type).toBe('void');
        expect(nav.cells[z]![x]!.moveCost).toBe(Infinity);
      }
    }
    // Outside: remains walkable
    expect(nav.cells[2]![2]!.type).toBe('walkable');
    expect(nav.cells[6]![6]!.type).toBe('walkable');
  });

  it('updates exactly 9 cells in a 3×3 region, no more, no fewer', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, [], []);

    // Record initial state
    const beforeMap = cellTypeMap(nav);

    // Clear only column (0,0)
    for (let y = 0; y <= 4; y++) grid.clearVoxel(0, y, 0);

    // Patch a 3×3 region
    const region: BlastRegion = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // Only (0,0) should have changed (from walkable to void)
    // The other 8 cells (0,1), (0,2), (1,0), (1,1), (1,2), (2,0), (2,1), (2,2)
    // should remain walkable since their voxels are unchanged
    expect(nav.cells[0]![0]!.type).toBe('void');
    for (let z = 0; z <= 2; z++) {
      for (let x = 0; x <= 2; x++) {
        if (x === 0 && z === 0) continue;
        expect(nav.cells[z]![x]!.type).toBe('walkable');
      }
    }
    // Also verify outside cells weren't touched
    expect(nav.cells[5]![5]!.type).toBe(beforeMap.get('5,5'));
  });
});

describe('NavGrid.patchNavGrid — full-grid equivalence', () => {
  it('produces the same result as buildNavGrid when patching the full grid', () => {
    const grid = makeSolidGrid(15, 10, 15, 4);
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 5, z: 5, hp: 80, active: true },
    ];
    const holes: DrillHole[] = [
      { id: 'H1', x: 10, z: 10, depth: 5, diameter: 0.15 },
    ];

    // Build fresh
    const fresh = NavGrid.buildNavGrid(grid, buildings, holes);

    // Patch the entire grid
    const patched = NavGrid.buildNavGrid(grid, [], []); // start clean
    const fullRegion: BlastRegion = { minX: 0, maxX: 14, minZ: 0, maxZ: 14 };
    NavGrid.patchNavGrid(patched, grid, buildings, holes, fullRegion);

    // Both should be identical
    for (let z = 0; z < 15; z++) {
      for (let x = 0; x < 15; x++) {
        expect(patched.cells[z]![x]!.type).toBe(fresh.cells[z]![x]!.type);
        expect(patched.cells[z]![x]!.moveCost).toBe(fresh.cells[z]![x]!.moveCost);
      }
    }
  });
});

describe('NavGrid.patchNavGrid — ramp formation within patch', () => {
  it('detects ramp when terrain height changes within the patched region', () => {
    const grid = new VoxelGrid(5, 10, 5);
    // Fill all columns solid to Y=4
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++)
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());

    const nav = NavGrid.buildNavGrid(grid, [], []);
    // Flat terrain → no ramps initially
    expect(nav.cells[2]![2]!.type).toBe('walkable');

    // Lower column (2,3) to Y=2, creating height diff with (2,2)
    for (let y = 0; y <= 4; y++) grid.clearVoxel(2, y, 3);
    for (let y = 0; y <= 2; y++) grid.setVoxel(2, y, 3, solidVoxel());

    // Patch region covering (2,2) and its neighbors
    const region: BlastRegion = { minX: 1, maxX: 3, minZ: 1, maxZ: 3 };
    NavGrid.patchNavGrid(nav, grid, [], [], region);

    // (2,2) should now be ramp because neighbor (2,3) has height diff > 1
    expect(nav.cells[2]![2]!.type).toBe('ramp');
    expect(nav.cells[2]![2]!.moveCost).toBe(1.8);
  });

  it('ramp detection in patch respects higher-priority classifications', () => {
    const grid = new VoxelGrid(5, 10, 5);
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++)
        for (let y = 0; y <= 4; y++) grid.setVoxel(x, y, z, solidVoxel());

    const nav = NavGrid.buildNavGrid(grid, [], []);

    // Lower column (2,3) to create height diff with (2,2)
    for (let y = 0; y <= 4; y++) grid.clearVoxel(2, y, 3);
    for (let y = 0; y <= 2; y++) grid.setVoxel(2, y, 3, solidVoxel());

    // Also place a building covering (2,2)
    const buildings: Building[] = [
      { id: 1, type: 'management_office', tier: 1, x: 2, z: 2, hp: 80, active: true },
    ];

    const region: BlastRegion = { minX: 1, maxX: 3, minZ: 1, maxZ: 3 };
    NavGrid.patchNavGrid(nav, grid, buildings, [], region);

    // (2,2) is both adjacent to ramp AND under building footprint
    // → blocked should win over ramp (blocked > ramp priority)
    expect(nav.cells[2]![2]!.type).toBe('blocked');
  });
});
// ═══════════════════════════════════════════════════════════════════════════════

describe('executeBlast — clearedRegion', () => {
  beforeEach(() => resetHoleIds());

  it('returns a BlastResult with clearedRegion reflecting the blast zone', () => {
    const grid = makeTestGrid();                  // 20×10×20, solid y=0..4
    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);               // hole at (5,5), depth 5
    const plan = makeBlastPlan(holes);

    const result = executeBlast(plan, grid, [], 1.0);

    expect(result).not.toBeNull();
    expect(result!.clearedRegion).toBeDefined();

    // clearedRegion bounds the voxels the blast actually removed, so the
    // NavGrid patch touches exactly the ground that changed. That is a tighter
    // box than the blast zone the energy pass searched (the hole at (5,5) with
    // BLAST_ZONE_RADIUS 5 spans 0..10), and it must contain the hole itself.
    const { minX, maxX, minZ, maxZ } = result!.clearedRegion;
    expect(maxX).toBeGreaterThanOrEqual(minX);
    expect(maxZ).toBeGreaterThanOrEqual(minZ);
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(10);
    expect(minZ).toBeGreaterThanOrEqual(0);
    expect(maxZ).toBeLessThanOrEqual(10);
    expect(minX).toBeLessThanOrEqual(5);
    expect(maxX).toBeGreaterThanOrEqual(5);
    expect(minZ).toBeLessThanOrEqual(5);
    expect(maxZ).toBeGreaterThanOrEqual(5);
  });

  it('returns a non-null clearedRegion even when no voxels are cleared', () => {
    // Grid with no blastable rock (all air) → blast clears nothing
    const grid = new VoxelGrid(20, 10, 20);
    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);
    const plan = makeBlastPlan(holes);

    const result = executeBlast(plan, grid, [], 1.0);

    expect(result).not.toBeNull();
    expect(result!.clearedRegion).toBeDefined();
    expect(result!.clearedRegion.minX).toBeDefined();
    expect(result!.clearedRegion.maxX).toBeDefined();
    expect(result!.clearedRegion.minZ).toBeDefined();
    expect(result!.clearedRegion.maxZ).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4: findNearestTraversableCell / findNearestReachableCell (#437 fix —
// spawn placement for `vehicle buy` / `employee hire` so new hires/vehicles
// don't land inside a blast-crater void).
// ═══════════════════════════════════════════════════════════════════════════════

/** Build a hand-crafted NavGrid directly from a type grid, rows[z][x]. Bypasses VoxelGrid entirely for precise control over which cells are walkable/blocked. */
function makeNavGridFromTypes(rows: NavCellType[][]): NavGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  const cells = rows.map(row => row.map((type): NavCell => {
    const moveCost = type === 'walkable' ? 1.0 : type === 'ramp' ? 1.8 : type === 'drill_hole' ? 5.0 : Infinity;
    return { type, moveCost, benchLevel: 0, vehicleOccupied: false };
  }));
  return new NavGrid(width, height, cells, 0);
}

describe('NavGrid.findNearestTraversableCell', () => {
  it('returns the point unchanged when it is already traversable', () => {
    const nav = makeNavGridFromTypes([
      ['walkable', 'walkable', 'walkable'],
      ['walkable', 'walkable', 'walkable'],
      ['walkable', 'walkable', 'walkable'],
    ]);
    const result = NavGrid.findNearestTraversableCell(nav, 1, 1);
    expect(result).toEqual({ x: 1, z: 1 });
  });

  it('searches outward in expanding rings to find the nearest traversable cell', () => {
    // 5×5 grid, entirely blocked except a single walkable cell at (4,4).
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'blocked'));
    rows[4]![4] = 'walkable';
    const nav = makeNavGridFromTypes(rows);

    const result = NavGrid.findNearestTraversableCell(nav, 0, 0);
    expect(result).toEqual({ x: 4, z: 4 });
  });

  it('returns the original point unchanged when nothing traversable exists within maxRadius', () => {
    // Same grid as above, but the walkable cell at (4,4) is farther than the
    // search bound allows.
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'blocked'));
    rows[4]![4] = 'walkable';
    const nav = makeNavGridFromTypes(rows);

    const result = NavGrid.findNearestTraversableCell(nav, 0, 0, 2);
    expect(result).toEqual({ x: 0, z: 0 });
  });
});

describe('NavGrid.findNearestReachableCell', () => {
  it('returns the target unchanged when it is already traversable and path-connected to the anchor', () => {
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'walkable'));
    const nav = makeNavGridFromTypes(rows);

    const result = NavGrid.findNearestReachableCell(nav, 0, 0, 4, 4);
    expect(result).toEqual({ x: 4, z: 4 });
  });

  it('falls back to the target unchanged when the anchor itself resolves to no traversable cell', () => {
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'blocked'));
    const nav = makeNavGridFromTypes(rows);

    const result = NavGrid.findNearestReachableCell(nav, 0, 0, 2, 2);
    expect(result).toEqual({ x: 2, z: 2 });
  });

  it('skips a cell that is nearest by raw distance but walled off from the anchor, in favor of an actually reachable cell', () => {
    // 7×7 grid: a walkable pocket at (3,3) is fully surrounded on all 8 sides
    // by blocked cells, isolating it from the rest of the (otherwise entirely
    // walkable) grid, which anchor (0,0) sits in. findNearestTraversableCell
    // on (3,3) would return (3,3) unchanged (it IS traversable) — but nothing
    // can actually path there, which is exactly the bug this function fixes.
    const rows: NavCellType[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 7 }, (): NavCellType => 'walkable'));
    for (const [x, z] of [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]] as const) {
      rows[z]![x] = 'blocked';
    }
    const nav = makeNavGridFromTypes(rows);

    // Sanity: the pocket itself is traversable, and pure-distance search
    // (findNearestTraversableCell) on it returns itself unchanged — it does
    // not know the cell is unreachable.
    expect(NavGrid.findNearestTraversableCell(nav, 3, 3)).toEqual({ x: 3, z: 3 });

    const result = NavGrid.findNearestReachableCell(nav, 0, 0, 3, 3);

    // Must not be the isolated pocket itself.
    expect(result).not.toEqual({ x: 3, z: 3 });
    // Must be an actually walkable, reachable cell.
    expect(nav.cells[result.z]![result.x]!.type).toBe('walkable');
    // The 8 ring cells immediately surrounding the pocket are all blocked, so
    // the true nearest reachable cell sits one ring farther out — distance²
    // 4 (e.g. (1,3), (5,3), (3,1), (3,5)) — never distance² 1 or 2, which
    // would mean it picked one of the (blocked) ring cells or the pocket.
    const distSq = (result.x - 3) ** 2 + (result.z - 3) ** 2;
    expect(distSq).toBe(4);
  });

  // ── #458 T6.1/D14: prefer a same-bench-level cell over the raw nearest ──
  //
  // The flood fill this function walks has no notion of bench level — it's a
  // flat 8-directional walkable/ramp/drill_hole adjacency check, so it calls
  // a cell "reachable" even when it sits across a bench-level boundary from
  // the anchor, connected only via Pathfinding.findMultiLevelPath's
  // ramp-entrance/exit routing. That routing re-picks its cheapest candidate
  // ramp fresh every tick from the walking agent's continuously-shifting
  // position, which can flip between near-tied ramps and produce a stable
  // walk-forward/walk-back loop that never arrives — confirmed via direct
  // reproduction (a driver frozen retrying a short walk to a freshly bought
  // vehicle for 150+ ticks). Preferring a same-bench-level candidate
  // whenever one exists sidesteps multi-level routing for this call
  // entirely, which matters more now than it used to: bigger levels
  // (#458 D13) carry far more natural terrain relief than the old ones, so
  // this kind of boundary comes up far more often.

  it('prefers a same-bench-level cell over the exact target when the target sits on a different bench', () => {
    // 5×5, entirely walkable and bench 0, except the target cell itself
    // (4,4), which sits on bench 1. Without the same-level preference, the
    // exact target always wins (distance 0 to itself) regardless of bench —
    // exactly the case that let a vehicle spawn on a bench-level boundary
    // from its driver in the first place.
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'walkable'));
    const nav = makeNavGridFromTypes(rows);
    nav.cells[4]![4]!.benchLevel = 1;

    const result = NavGrid.findNearestReachableCell(nav, 0, 0, 4, 4);

    expect(result).not.toEqual({ x: 4, z: 4 });
    expect(nav.cells[result.z]![result.x]!.benchLevel).toBe(0);
  });

  it('never returns a cell on a different bench than the anchor when the anchor itself qualifies as same-level', () => {
    // Anchor (0,0) sits on bench 0, but every other cell in the grid is
    // bench 1 — the anchor is always trivially "same level as itself", so
    // it remains the same-level candidate rather than falling through to a
    // cross-level pick, even though it's farther from the target than every
    // other reachable cell.
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'walkable'));
    const nav = makeNavGridFromTypes(rows);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        if (x !== 0 || z !== 0) nav.cells[z]![x]!.benchLevel = 1;
      }
    }

    const result = NavGrid.findNearestReachableCell(nav, 0, 0, 4, 4);
    expect(nav.cells[result.z]![result.x]!.benchLevel).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5: computeReachableSet (#466 — reachability-aware fragment selection for
// hauling. A full-clear blast leaves most fragments sitting in 'void' NavGrid
// cells; findReachableGroundFragment must never treat those as reachable, so
// this is the flood-fill it (and the "Haul" UI button) are built on.)
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid.computeReachableSet', () => {
  it('returns every traversable cell on a flat open grid', () => {
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'walkable'));
    const nav = makeNavGridFromTypes(rows);

    const reachable = NavGrid.computeReachableSet(nav, 2, 2);

    expect(reachable.size).toBe(25);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        expect(reachable.has(x, z)).toBe(true);
      }
    }
  });

  it('excludes a void-walled pocket from the reachable set when the anchor sits outside it', () => {
    // Same 7×7 layout as the findNearestReachableCell pocket fixture above, but
    // walled with 'void' — what a blast crater actually produces — instead of
    // 'blocked'.
    const rows: NavCellType[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 7 }, (): NavCellType => 'walkable'));
    for (const [x, z] of [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]] as const) {
      rows[z]![x] = 'void';
    }
    const nav = makeNavGridFromTypes(rows);

    const reachable = NavGrid.computeReachableSet(nav, 0, 0);

    // The pocket cell itself is traversable but walled off by void on all 8 sides.
    expect(reachable.has(3, 3)).toBe(false);
    // The open field outside the ring is fully reachable from the anchor.
    expect(reachable.has(0, 0)).toBe(true);
    expect(reachable.has(6, 6)).toBe(true);
    expect(reachable.has(1, 1)).toBe(true);
  });

  it('includes only the pocket when the anchor itself sits inside it', () => {
    const rows: NavCellType[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 7 }, (): NavCellType => 'walkable'));
    for (const [x, z] of [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]] as const) {
      rows[z]![x] = 'void';
    }
    const nav = makeNavGridFromTypes(rows);

    const reachable = NavGrid.computeReachableSet(nav, 3, 3);

    // The void ring cuts the pocket off from the rest of the (otherwise fully
    // walkable) grid, so flood-filling from inside it finds nothing else.
    expect(reachable.size).toBe(1);
    expect(reachable.has(3, 3)).toBe(true);
  });

  it('returns an empty set when the anchor itself sits on a non-traversable cell', () => {
    const rows: NavCellType[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): NavCellType => 'walkable'));
    rows[2]![2] = 'void';
    const nav = makeNavGridFromTypes(rows);

    const reachable = NavGrid.computeReachableSet(nav, 2, 2);

    expect(reachable.size).toBe(0);
  });

  it('agrees with findNearestReachableCell on a shared pocket fixture (regression guard)', () => {
    const rows: NavCellType[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 7 }, (): NavCellType => 'walkable'));
    for (const [x, z] of [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]] as const) {
      rows[z]![x] = 'void';
    }
    const nav = makeNavGridFromTypes(rows);

    const reachable = NavGrid.computeReachableSet(nav, 0, 0);
    const nearest = NavGrid.findNearestReachableCell(nav, 0, 0, 3, 3);

    // findNearestReachableCell's answer must itself be a member of the set
    // computeReachableSet reports as reachable from the same anchor — if the
    // implementer extracts one flood-fill both functions share (as the doc
    // comments anticipate), a divergence here means that extraction broke one
    // of them.
    expect(reachable.has(nearest.x, nearest.z)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 20: climb-aware reachability (#953)
// ═══════════════════════════════════════════════════════════════════════════════

/** NavGrid from a height map: every cell walkable, `surfaceY` taken from the map. */
function makeNavGridFromHeights(heights: number[][]): NavGrid {
  const height = heights.length;
  const width = heights[0]!.length;
  const cells = heights.map(row => row.map((surfaceY): NavCell => ({
    type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false, surfaceY,
  })));
  return new NavGrid(width, height, cells, Math.max(...heights.flat()));
}

describe('NavGrid.computeClimbReachableSet', () => {
  it('stops at a face taller than the climb limit, where the plain set walks straight over it', () => {
    const floor = 0;
    const bench = floor + NAV_MAX_CLIMB_HEIGHT + 1;
    const nav = makeNavGridFromHeights([
      [bench, bench, bench, bench],
      [bench, bench, bench, bench],
      [floor, floor, floor, floor],
      [floor, floor, floor, floor],
    ]);

    const climbAware = NavGrid.computeClimbReachableSet(nav, 0, 0);
    const plain = NavGrid.computeReachableSet(nav, 0, 0);

    expect(climbAware.has(0, 1)).toBe(true);
    expect(climbAware.has(0, 2)).toBe(false);
    expect(plain.has(0, 2)).toBe(true);
  });

  it('walks a grade the climb limit allows', () => {
    const nav = makeNavGridFromHeights([
      [0, NAV_MAX_CLIMB_HEIGHT, NAV_MAX_CLIMB_HEIGHT * 2],
      [0, NAV_MAX_CLIMB_HEIGHT, NAV_MAX_CLIMB_HEIGHT * 2],
      [0, NAV_MAX_CLIMB_HEIGHT, NAV_MAX_CLIMB_HEIGHT * 2],
    ]);

    const reachable = NavGrid.computeClimbReachableSet(nav, 0, 0);

    expect(reachable.has(2, 2)).toBe(true);
  });

  it('treats a fixture without surfaceY as unconstrained, matching the plain set', () => {
    const rows: NavCellType[][] = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, (): NavCellType => 'walkable'));
    const nav = makeNavGridFromTypes(rows);

    expect(NavGrid.computeClimbReachableSet(nav, 0, 0).size).toBe(NavGrid.computeReachableSet(nav, 0, 0).size);
  });
});

describe('NavGrid.findNearestNavigableCell', () => {
  it('answers from the largest climb-connected region, not the one the target sits on', () => {
    const summit = 20;
    const nav = makeNavGridFromHeights([
      [summit, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);

    // (0,0) is a one-cell island: every neighbour is a 20-voxel drop.
    const snapped = NavGrid.findNearestNavigableCell(nav, 0, 0);

    expect(snapped).not.toEqual({ x: 0, z: 0 });
    expect(NavGrid.computeClimbReachableSet(nav, snapped.x, snapped.z).size).toBeGreaterThan(1);
  });

  it('leaves a point that already sits on the main ground exactly where it is', () => {
    const nav = makeNavGridFromHeights([
      [20, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    expect(NavGrid.findNearestNavigableCell(nav, 2, 2)).toEqual({ x: 2, z: 2 });
  });

  it('returns the target unchanged when no cell of the grid is traversable', () => {
    const rows: NavCellType[][] = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, (): NavCellType => 'void'));

    expect(NavGrid.findNearestNavigableCell(makeNavGridFromTypes(rows), 1, 1)).toEqual({ x: 1, z: 1 });
  });
});
