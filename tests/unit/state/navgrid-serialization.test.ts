import { describe, it, expect } from 'vitest';
import { stateCommand } from '../../../src/console/commands/state.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import type { NavCell, NavCellType } from '../../../src/core/nav/NavGrid.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { createTubingState } from '../../../src/core/mining/Tubing.js';

// ── Helper factories ────────────────────────────────────────────────────────

/** Create a single NavCell of the specified type. */
function makeCell(type: NavCellType, benchLevel = 0): NavCell {
  const costs: Record<NavCellType, number> = {
    walkable: 1.0,
    ramp: 1.8,
    drill_hole: 5.0,
    blocked: Infinity,
    void: Infinity,
  };
  return { type, moveCost: costs[type], benchLevel, vehicleOccupied: false };
}

/**
 * Build a 10×10 NavGrid where every cell is the same type.
 */
function makeUniformGrid(type: NavCellType): NavGrid {
  const width = 10;
  const height = 10;
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push(makeCell(type));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells, 5);
}

/**
 * Build a 10×10 NavGrid with a known distribution of cell types.
 * Layout (z, x):
 *   - walkable: rows 0-7, cols 0-9 → 80 cells
 *   - blocked:  rows 8, cols 0-4 → 5 cells
 *   - drill_hole: rows 8, cols 5-9 → 5 cells
 *   - ramp: rows 9, cols 0-4 → 5 cells
 *   - void: rows 9, cols 5-9 → 5 cells
 */
function makeMixedGrid(): NavGrid {
  const width = 10;
  const height = 10;
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      let type: NavCellType;
      if (z < 8) {
        type = 'walkable';
      } else if (z === 8) {
        type = x < 5 ? 'blocked' : 'drill_hole';
      } else {
        type = x < 5 ? 'ramp' : 'void';
      }
      row.push(makeCell(type));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells, 12);
}

/** Create a minimal MiningContext wrapping the given GameState. */
function makeCtx(state: ReturnType<typeof createGame>): MiningContext {
  return {
    state,
    grid: null,
    emitter: new EventEmitter(),
    softwareTier: 1,
    tubingState: createTubingState(),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('stateCommand — navGrid serialization', () => {
  it('navGrid is null when no NavGrid is assigned', () => {
    const state = createGame({ seed: 42 });
    // state.navGrid is null by default from createGame
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.navGrid).toBeNull();
  });

  it('navGrid includes width, height, maxSurfaceY when NavGrid is present', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeUniformGrid('walkable');
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);

    expect(parsed.navGrid).not.toBeNull();
    expect(parsed.navGrid.width).toBe(10);
    expect(parsed.navGrid.height).toBe(10);
    expect(parsed.navGrid.maxSurfaceY).toBe(5);
  });

  it('navGrid.cellTypeCounts has all 5 cell types for uniform walkable grid', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeUniformGrid('walkable');
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);
    const counts = parsed.navGrid.cellTypeCounts;

    expect(counts).toHaveProperty('walkable');
    expect(counts).toHaveProperty('blocked');
    expect(counts).toHaveProperty('drill_hole');
    expect(counts).toHaveProperty('ramp');
    expect(counts).toHaveProperty('void');
  });

  it('uniform walkable grid reports 100 walkable, 0 others', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeUniformGrid('walkable');
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);
    const counts = parsed.navGrid.cellTypeCounts;

    expect(counts.walkable).toBe(100);
    expect(counts.blocked).toBe(0);
    expect(counts.drill_hole).toBe(0);
    expect(counts.ramp).toBe(0);
    expect(counts.void).toBe(0);
  });

  it('mixed grid reports correct counts for each cell type', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeMixedGrid();
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);
    const counts = parsed.navGrid.cellTypeCounts;

    expect(counts.walkable).toBe(80);
    expect(counts.blocked).toBe(5);
    expect(counts.drill_hole).toBe(5);
    expect(counts.ramp).toBe(5);
    expect(counts.void).toBe(5);
  });

  it('mixed grid total cell count equals width × height', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeMixedGrid();
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);
    const counts = parsed.navGrid.cellTypeCounts;
    const total = counts.walkable + counts.blocked + counts.drill_hole + counts.ramp + counts.void;

    expect(total).toBe(100); // 10 × 10
  });

  it('uniform blocked grid reports all 100 cells as blocked', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeUniformGrid('blocked');
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);
    const counts = parsed.navGrid.cellTypeCounts;

    expect(counts.blocked).toBe(100);
    expect(counts.walkable).toBe(0);
  });

  it('uniform void grid reports all 100 cells as void', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeUniformGrid('void');
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);
    const counts = parsed.navGrid.cellTypeCounts;

    expect(counts.void).toBe(100);
  });

  it('navGrid serialization does not include cell-level data (width/height only)', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = makeUniformGrid('walkable');
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);

    // The serialized navGrid should not contain the full cells array
    expect(parsed.navGrid.cells).toBeUndefined();
    // It should have width, height, maxSurfaceY, cellTypeCounts
    expect(Object.keys(parsed.navGrid).sort()).toEqual([
      'cellTypeCounts',
      'height',
      'maxSurfaceY',
      'width',
    ]);
  });

  it('navGrid appears in the serialized output when game state is present', () => {
    const state = createGame({ seed: 99 });
    state.navGrid = makeUniformGrid('ramp');
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    const parsed = JSON.parse(result.output);

    expect(parsed).toHaveProperty('navGrid');
    expect(parsed.navGrid).not.toBeNull();
  });

  it('stateCommand with no game returns failure', () => {
    const ctx: MiningContext = {
      state: null,
      grid: null,
      emitter: new EventEmitter(),
      softwareTier: 1,
      tubingState: createTubingState(),
    };
    const result = stateCommand(ctx, ['full'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});
