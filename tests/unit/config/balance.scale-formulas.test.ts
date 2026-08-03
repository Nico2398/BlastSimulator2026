// BlastSimulator2026 — Grid-size-scaled balance formulas (#458 T6.2/D14)
// pathfindingNodeBudget and needRestSearchRadius replace flat constants that
// were sized for the old ~64-wide levels — both must scale up on D13's
// bigger levels (up to 160×160) instead of staying pinned to their old floor.

import { describe, it, expect } from 'vitest';
import {
  pathfindingNodeBudget,
  PATHFINDING_NODE_BUDGET_MIN,
  PATHFINDING_NODE_BUDGET_AREA_DIVISOR,
  needRestSearchRadius,
  NEED_REST_SEARCH_RADIUS_MIN,
  NEED_REST_SEARCH_RADIUS_GRID_DIVISOR,
} from '../../../src/core/config/balance.js';

describe('pathfindingNodeBudget (#458 T6.2/D14)', () => {
  it('stays at the floor for small grids', () => {
    expect(pathfindingNodeBudget(20, 20)).toBe(PATHFINDING_NODE_BUDGET_MIN);
    expect(pathfindingNodeBudget(32, 32)).toBe(PATHFINDING_NODE_BUDGET_MIN);
  });

  it('scales with grid area past the floor', () => {
    // 160×160 / 8 = 3200, well above the 500 floor.
    expect(pathfindingNodeBudget(160, 160)).toBe(3200);
    expect(pathfindingNodeBudget(160, 160)).toBeGreaterThan(PATHFINDING_NODE_BUDGET_MIN);
  });

  it('matches the documented formula exactly', () => {
    const w = 96, h = 40;
    const expected = Math.max(
      PATHFINDING_NODE_BUDGET_MIN,
      Math.floor((w * h) / PATHFINDING_NODE_BUDGET_AREA_DIVISOR),
    );
    expect(pathfindingNodeBudget(w, h)).toBe(expected);
  });
});

describe('needRestSearchRadius (#458 T6.2/D14)', () => {
  it('stays at the floor for small/zero grid widths', () => {
    expect(needRestSearchRadius(0)).toBe(NEED_REST_SEARCH_RADIUS_MIN);
    expect(needRestSearchRadius(32)).toBe(NEED_REST_SEARCH_RADIUS_MIN);
  });

  it('scales with grid width past the floor', () => {
    // 160 / 4 = 40, above the 20 floor.
    expect(needRestSearchRadius(160)).toBe(40);
    expect(needRestSearchRadius(160)).toBeGreaterThan(NEED_REST_SEARCH_RADIUS_MIN);
  });

  it('matches the documented formula exactly', () => {
    const width = 128;
    const expected = Math.max(NEED_REST_SEARCH_RADIUS_MIN, width / NEED_REST_SEARCH_RADIUS_GRID_DIVISOR);
    expect(needRestSearchRadius(width)).toBe(expected);
  });
});
