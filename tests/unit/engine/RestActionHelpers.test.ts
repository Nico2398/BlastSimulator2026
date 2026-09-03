// BlastSimulator2026 — Tests for deductRestCost (relocated from
// GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { defineZone } from '../../../src/core/entities/Zone.js';
import {
  deductRestCost, findNearestBuildingOfType, completeRestForEmployee,
} from '../../../src/core/engine/RestActionHelpers.js';
import { NEED_REST_COSTS, NEED_REST_NO_BUILDING_CAP, MAX_NEED_GAUGE } from '../../../src/core/config/balance.js';

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

// #945: completeRestForEmployee's with-building path used to apply
// BUILDING_REPLENISH_RATES.fatigue[tier] once per tick of NEED_REST_DURATIONS
// (a flat, tier-scaled total), rather than landing the gauge at the fixed
// ceiling MAX_NEED_GAUGE (100) the way the no-building path already does via
// NEED_REST_NO_BUILDING_CAP. At Tier 1 (rate 8 × duration 8 = 64), a rest
// starting from 25 fatigue lands at ~89, not 100 — the driver in the
// tutorial box-cut repro (#945) never leaves a rest fully rested, so it
// re-triggers a proactive/collapse rest again a few ticks later, forcing
// repeated dismount/reboard cycles on whatever vehicle it was driving.
// Tier 2 (rate 14) and Tier 3 (rate 20) already reach 100 through
// replenishNeed's own internal Math.min(100, ...) clamp before the loop of 8
// iterations finishes, so only Tier 1 is actually under — but the fix (set
// emp[needKey] = MAX_NEED_GAUGE directly) must land all three tiers at
// exactly 100, not above.
describe('completeRestForEmployee (#945 — with-building rest lands exactly at MAX_NEED_GAUGE, every tier)', () => {
  const SEED = 42;

  it('Tier 1 living_quarters rest leaves fatigue at MAX_NEED_GAUGE (100), not the ~89 the old per-tick-rate accumulation produced', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('Tier 2 living_quarters rest lands exactly at MAX_NEED_GAUGE, not above it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;

    state.buildings.unlockedTiers.living_quarters = 3; // tier 2+ requires research unlock
    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 2);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('Tier 3 living_quarters rest lands exactly at MAX_NEED_GAUGE, not above it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;

    state.buildings.unlockedTiers.living_quarters = 3;
    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 3);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('an employee already at MAX_NEED_GAUGE stays there after a building rest (boundary — no overshoot)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = MAX_NEED_GAUGE;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('no-building rest still caps at NEED_REST_NO_BUILDING_CAP (70) — unchanged regression', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;
    // No living_quarters placed at all.

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP);
  });

  it('no-building rest leaves a gauge already above the cap alone, rather than pulling it down (boundary — unchanged regression)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 90; // already above NEED_REST_NO_BUILDING_CAP (70)

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(90);
  });

  it('clears collapsing/restTicksRemaining/restNeedKey/activeActionId after a building rest completes (unchanged regression)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;
    employee.collapsing = true;
    employee.restTicksRemaining = 3;
    employee.restNeedKey = 'fatigue';
    employee.activeActionId = 777;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.collapsing).toBe(false);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.restNeedKey).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });
});
