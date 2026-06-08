// BlastSimulator2026 — Unit tests: NavGrid
// Tasks 5.15–5.19: NavGrid surface detection, full build, dirty-region patch after blast
//
// Test breakdown:
//   computeSurfaceY (§1–3):   solid column, air column, out-of-bounds clamping
//   buildNavGrid     (§4–9):   dimensions, void vs walkable, drill_hole, blocked, priority
//   patchNavGrid     (§10–14): region isolation, no-op, clamping, walkable→void transition
//   BlastResult      (§15):    clearedRegion returned by executeBlast

import { describe, it, expect, beforeEach } from 'vitest';
import { NavGrid, type NavCellType } from '../../../src/core/nav/NavGrid.js';
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
    const types = cellTypeMap(nav);
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
    expect(typeof nav.cells[1]![1]!.vehicleOccupied).toBe('boolean');
    expect(typeof nav.cells[1]![1]!.benchLevel).toBe('number');
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
// Group 4: BlastResult clearedRegion
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

    // The blast zone radius is 5. With a single hole at (5,5):
    //   minX = floor(5 - 5) = 0
    //   maxX = ceil(5 + 5) = 10
    //   minZ = floor(5 - 5) = 0
    //   maxZ = ceil(5 + 5) = 10
    expect(result!.clearedRegion.minX).toBe(0);
    expect(result!.clearedRegion.maxX).toBe(10);
    expect(result!.clearedRegion.minZ).toBe(0);
    expect(result!.clearedRegion.maxZ).toBe(10);
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
