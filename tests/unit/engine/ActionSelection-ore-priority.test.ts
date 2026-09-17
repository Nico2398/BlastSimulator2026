// BlastSimulator2026 — Unit tests: ore-priority haul dispatch ranking (#671)
//
// Bug: collectedOre.<material> never rises via automatic haul dispatch on a
// small warehouse, because estimateActionCost/selectBestActionForEmployee
// (ActionSelection.ts) rank haul_debris/fragment_debris candidates purely by
// travel-time cost, with zero ore-awareness — a small Tier 1 warehouse fills
// from the first cheapest (nearest, ore-agnostic) fragments, permanently
// excluding remaining fragments, including ore ones.
//
// Fix under implementation: estimateActionCost subtracts
// ORE_HAUL_PRIORITY_BONUS_TICKS (balance.ts) from a haul_debris/fragment_debris
// candidate's ranking cost when haulActionCarriesOre (HaulDispatch.ts) is
// true, so ore-bearing candidates outrank same-role non-ore ones at realistic
// distances — ranking-only, never leaking into the real duration used for
// ETA/display (resolveActionCost).
//
// Red phase: neither haulActionCarriesOre nor ORE_HAUL_PRIORITY_BONUS_TICKS
// is wired into estimateActionCost yet (ORE_HAUL_PRIORITY_BONUS_TICKS is
// still the stub value 0), so estimateActionCost's ranking is unchanged
// pure-travel-time — the tests below that depend on ore-priority reordering
// are expected to fail until #671 is implemented.

import { describe, it, expect } from 'vitest';
import {
  estimateActionCost,
  resolveActionCost,
  selectBestActionForEmployee,
} from '../../../src/core/engine/ActionSelection.js';
import { octileHeuristic } from '../../../src/core/nav/Pathfinding.js';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { hireEmployee, assignSkill, type Employee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, getVehicleDefByTier, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { ORE_HAUL_PRIORITY_BONUS_TICKS } from '../../../src/core/config/balance.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';

// #1090: haul_debris is requiredVehicleRole: 'debris_hauler' — planItinerary
// now reports a vehicle-gated goal genuinely unresolvable (Infinity/null)
// when no vehicle of that role exists anywhere (ActionSelection.test.ts's own
// "returns Infinity ... when no free vehicle of the required role exists
// anywhere" pins this), replacing the deleted resolveVehicleGatedWalkTarget's
// defensive on-foot fallback. Every fixture below purchases one at the
// employee's own starting cell, so the board leg is zero-length and the
// route is a single drive leg at the vehicle's own (tiered) speed rather than
// AGENT_WALK_SPEED.
const DEBRIS_HAULER_SPEED = getVehicleDefByTier('debris_hauler', 1).speed;

// ── NavGrid helpers (mirrors tests/unit/engine/ActionSelection.test.ts) ────

function makeCell(type: NavCellType): NavCell {
  const moveCost = type === 'blocked' || type === 'void' ? Infinity
    : type === 'ramp' ? 1.8
    : type === 'drill_hole' ? 5.0
    : 1.0;
  return { type, moveCost, benchLevel: 0, vehicleOccupied: false };
}

/** Flat, fully-walkable NavGrid of the given size. */
function makeFlatGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) row.push(makeCell('walkable'));
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/**
 * #1091: a haul_debris candidate's itinerary always ends with a drive-to-
 * depot leg (PlanItinerary.ts's planFragmentTaskItinerary) — with no active
 * freight_warehouse anywhere, findHaulDepotApproach fails and the whole
 * itinerary is unresolvable (null), so every fixture below needs one. Placed
 * at a fixed, arbitrary point (30,30) — the ore bonus (16 ticks) dwarfs every
 * short intra-cluster distance these tests use, clamping estimateActionCost's
 * ore-bearing candidates to 0 regardless of exactly where the depot sits
 * (verified empirically), so its placement doesn't need to preserve any
 * particular symmetry for the ranking assertions to hold.
 */
function makeState(width = 60, height = 60): GameState {
  const state = createGame({ seed: 42 });
  state.navGrid = makeFlatGrid(width, height);
  const warehouse = placeBuilding(state.buildings, 'freight_warehouse', 30, 30, width, height);
  if (!warehouse.success) throw new Error(`Setup: placeBuilding failed — ${warehouse.error}`);
  warehouse.building!.active = true;
  return state;
}

function makeEmployee(state: GameState, x = 0, z = 0): Employee {
  const rng = new Random(42);
  const { employee } = hireEmployee(state.employees, 'driller', rng, x, z);
  return employee;
}

/**
 * A debris_hauler-licensed employee plus a debris_hauler vehicle purchased at
 * their exact starting cell (#1090: a haul_debris candidate's cost is a real
 * itinerary now, and planItinerary reports no route at all when no vehicle of
 * the required role exists — see this file's own header comment).
 */
function makeHaulerEmployee(state: GameState, x = 0, z = 0): Employee {
  const employee = makeEmployee(state, x, z);
  assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);
  purchaseVehicle(state.vehicles, 'debris_hauler', x, z);
  return employee;
}

// ── Fragment / PendingAction helpers ────────────────────────────────────────

/** Default volume sits under OVERSIZED_FRAGMENT_THRESHOLD — haulable by default. */
function makeFragment(id: number, x: number, z: number, oreDensities: Record<string, number>): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass: 1000,
    rockId: 'cruite',
    oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
    shapeSeed: id,
  };
}

function makeHaulAction(overrides: Partial<PendingAction> & { id: number; targetX: number; targetZ: number; payload: { fragmentId: number } }): PendingAction {
  return {
    type: 'haul_debris',
    requiredSkill: null,
    requiredVehicleRole: 'debris_hauler',
    targetY: 0,
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// selectBestActionForEmployee — ore-priority reordering
// ═══════════════════════════════════════════════════════════════════════════

describe('selectBestActionForEmployee — ore-priority ranking (#671)', () => {
  it('two equal-octile-distance haul_debris candidates: the ore-bearing one wins over the plain one', () => {
    const state = makeState();
    const emp = makeHaulerEmployee(state, 0, 0);

    // (10,0) and (0,10) are both octile distance 10 from (0,0) on a flat
    // grid — a genuine tie under pure travel-time ranking, so only
    // ore-awareness can break it.
    addBlastFragments(state.logistics, [
      makeFragment(1, 10, 0, {}),
      makeFragment(2, 0, 10, { gloomium: 0.2 }),
    ]);
    const plain = makeHaulAction({ id: 1, targetX: 10, targetZ: 0, payload: { fragmentId: 1 } });
    const ore = makeHaulAction({ id: 2, targetX: 0, targetZ: 10, payload: { fragmentId: 2 } });

    expect(octileHeuristic(0, 0, plain.targetX, plain.targetZ))
      .toBe(octileHeuristic(0, 0, ore.targetX, ore.targetZ));

    // Order deliberately puts the plain (lower-id) candidate first — a naive
    // "first tie wins" or "lowest id wins" implementation would pick it.
    const result = selectBestActionForEmployee(state, emp, [plain, ore]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(ore.id);
  });

  it('an ore-bearing candidate a modest extra distance farther than a plain one still wins (within the bonus\'s intended working range)', () => {
    const state = makeState();
    const emp = makeHaulerEmployee(state, 0, 0);

    // extraTicks stays strictly under the full ORE_HAUL_PRIORITY_BONUS_TICKS
    // for any positive value the implementer sets (half of it) — a small
    // fixed placeholder (1 tick) while the constant is still the stub 0, so
    // this remains meaningful (and still red) even before that value exists.
    const extraTicks = ORE_HAUL_PRIORITY_BONUS_TICKS > 0 ? ORE_HAUL_PRIORITY_BONUS_TICKS / 2 : 1;
    const extraDistance = extraTicks * DEBRIS_HAULER_SPEED;
    const baseDistance = 10;

    addBlastFragments(state.logistics, [
      makeFragment(1, baseDistance, 0, {}),
      makeFragment(2, baseDistance + extraDistance, 0, { gloomium: 0.2 }),
    ]);
    const plain = makeHaulAction({ id: 1, targetX: baseDistance, targetZ: 0, payload: { fragmentId: 1 } });
    const ore = makeHaulAction({ id: 2, targetX: baseDistance + extraDistance, targetZ: 0, payload: { fragmentId: 2 } });

    // Lower estimateActionCost wins selection (selectBestActionForEmployee
    // sorts ascending and picks the cheapest) — the bonus must make the
    // farther ore candidate's cost come in *below* the plain one's for it to
    // win, not above it.
    expect(estimateActionCost(state, emp, ore)).toBeLessThan(estimateActionCost(state, emp, plain));

    const result = selectBestActionForEmployee(state, emp, [plain, ore]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(ore.id);
  });

  it('with no ore-bearing fragment among the candidates, ranking still picks the nearer plain candidate (no regression)', () => {
    const state = makeState();
    const emp = makeHaulerEmployee(state, 0, 0);

    addBlastFragments(state.logistics, [
      makeFragment(1, 5, 0, {}),
      makeFragment(2, 20, 0, {}),
    ]);
    const near = makeHaulAction({ id: 1, targetX: 5, targetZ: 0, payload: { fragmentId: 1 } });
    const far = makeHaulAction({ id: 2, targetX: 20, targetZ: 0, payload: { fragmentId: 2 } });

    // Order deliberately reversed (farthest/highest-cost first in the array)
    // so a first-match bug would pick the wrong one.
    const result = selectBestActionForEmployee(state, emp, [far, near]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(near.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveActionCost — the bonus is ranking-only, never leaks into duration
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveActionCost — ore priority bonus never affects the real resolved duration (#671)', () => {
  it("an ore-bearing haul_debris candidate's resolved totalTicks matches an otherwise-identical plain candidate's, with no bonus subtracted", () => {
    const state = makeState();
    const emp = makeHaulerEmployee(state, 0, 0);

    // Two fragments at the exact same position — one ore-bearing, one not,
    // otherwise identical (same mass/volume, so computeActionWorkTicks's own
    // inputs match too) — isolates the ore bonus as the ONLY variable between
    // their two resolveActionCost calls. #1091: comparing against the real
    // plain candidate's own resolved cost (rather than a hand-rolled
    // travel-distance recomputation) stays correct regardless of exactly how
    // many legs planFragmentTaskItinerary's route happens to carry (today: a
    // drive to the fragment, then on to the depot).
    addBlastFragments(state.logistics, [
      makeFragment(1, 10, 0, {}),
      makeFragment(2, 10, 0, { gloomium: 0.2 }),
    ]);
    const plain = makeHaulAction({ id: 1, targetX: 10, targetZ: 0, payload: { fragmentId: 1 } });
    const ore = makeHaulAction({ id: 2, targetX: 10, targetZ: 0, payload: { fragmentId: 2 } });

    const resolvedPlain = resolveActionCost(state, emp, plain);
    const resolvedOre = resolveActionCost(state, emp, ore);
    expect(resolvedPlain).not.toBeNull();
    expect(resolvedOre).not.toBeNull();

    expect(resolvedOre!.totalTicks).toBeCloseTo(resolvedPlain!.totalTicks, 10);
  });

  it("selectBestActionForEmployee's chosen ore-bearing action reports a totalTicks matching the plain (bonus-free) real cost", () => {
    const state = makeState();
    const emp = makeHaulerEmployee(state, 0, 0);

    // Same equal-octile-distance setup as the ranking test above — the ore
    // candidate wins selection, but its reported totalTicks must still be
    // its own real (undiscounted) cost. A third, plain "control" fragment at
    // the ore candidate's own position gives an independent real cost to
    // compare against, the same way the test above does.
    addBlastFragments(state.logistics, [
      makeFragment(1, 10, 0, {}),
      makeFragment(2, 0, 10, { gloomium: 0.2 }),
      makeFragment(3, 0, 10, {}),
    ]);
    const plain = makeHaulAction({ id: 1, targetX: 10, targetZ: 0, payload: { fragmentId: 1 } });
    const ore = makeHaulAction({ id: 2, targetX: 0, targetZ: 10, payload: { fragmentId: 2 } });
    const oreControl = makeHaulAction({ id: 3, targetX: 0, targetZ: 10, payload: { fragmentId: 3 } });

    const result = selectBestActionForEmployee(state, emp, [plain, ore]);
    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(ore.id);

    const resolvedControl = resolveActionCost(state, emp, oreControl);
    expect(resolvedControl).not.toBeNull();
    expect(result!.totalTicks).toBeCloseTo(resolvedControl!.totalTicks, 10);
  });
});
