// BlastSimulator2026 — Tests for deductRestCost (relocated from
// GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { defineZone } from '../../../src/core/entities/Zone.js';
import { deductRestCost, findNearestBuildingOfType } from '../../../src/core/engine/RestActionHelpers.js';
import { NEED_REST_COSTS } from '../../../src/core/config/balance.js';

const DEDUCT_SEED = 42;

// #928: hunger and breakNeed (and their non-zero NEED_REST_COSTS entries)
// were removed — fatigue, the sole surviving gauge, has always cost 0
// (NEED_REST_COSTS.fatigue = 0). deductRestCost's non-zero-cost branch
// (the multiplication and the addExpense call) is unreachable through the
// real NeedKey type now — there is no gauge left to exercise it with. What
// remains testable is the zero-cost path itself: a fatigue rest visit
// deducts nothing and records no finance transaction, matching the "NO cash
// deduction from a fatigue rest visit" behavior the needs-cost-visual
// scenario also pins down.
describe('deductRestCost', () => {
  // ── Test 1: Boundary: fatigue visit deducts 0 from cash ──
  it('deducts 0 from cash for fatigue (no cost)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'fatigue');

    expect(state.cash).toBe(5000);
    expect(deducted).toBe(0);
    expect(deducted).toBe(NEED_REST_COSTS.fatigue);
  });

  // ── Test 2: Boundary: already-negative cash is left untouched, not reset to 0 ──
  it('does not reset already-negative cash back up to 0 (a prior bankruptcy-territory balance is not erased)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = -48870;

    const deducted = deductRestCost(state, 'fatigue');

    expect(state.cash).toBe(-48870);
    expect(deducted).toBe(0);
  });

  // ── Test 3: Boundary: fatigue (0 cost) records no expense (addExpense no-ops on amount <= 0) ──
  it('records no finance transaction for fatigue (zero-cost visit)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    deductRestCost(state, 'fatigue');

    expect(state.finances.transactions.find(t => t.category === 'needs')).toBeUndefined();
  });
});

describe('findNearestBuildingOfType — active-zone exclusion (#557)', () => {
  it('excludes a building sitting inside a still-occupied zone, picking a farther one outside instead', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const rng = new Random(DEDUCT_SEED);
    // Closer, but inside the zone about to be defined below.
    const inside = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(inside.success).toBe(true);
    // Farther, outside the zone.
    const outside = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);
    expect(outside.success).toBe(true);

    defineZone(state.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });
    hireEmployee(state.employees, 'driller', rng, 5, 5); // keeps the zone occupied -> not clear

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(outside.building!.id);
  });

  it('stops excluding once the zone reports clear — the nearer, in-zone building is eligible again (boundary)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const inside = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(inside.success).toBe(true);
    placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);

    defineZone(state.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });
    // No employees/vehicles at all -> the zone is trivially clear.

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(inside.building!.id);
  });

  it('keeps excluding once the zone reports clear of occupants, while a live blast plan still overlaps it (#557 follow-up)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const inside = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(inside.success).toBe(true);
    const outside = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);
    expect(outside.success).toBe(true);

    defineZone(state.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });
    // No employees/vehicles at all -> occupancy alone would say "clear" —
    // but a charged, un-fired blast plan squarely inside the same footprint
    // means it genuinely is not safe to route anyone back here yet.
    state.drillHoles.push({ id: 'H1', x: 5, z: 5, depth: 6, diameter: 0.089 });

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(outside.building!.id);
  });

  it('applies no exclusion at all when no zone has ever been defined (rejection — nothing to exclude)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const near = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(near.success).toBe(true);

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(near.building!.id);
  });
});
