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
import { ORE_HAUL_PRIORITY_BONUS_TICKS, SPOIL_BARREN_ORE_FRACTION_THRESHOLD } from '../../../src/core/config/balance.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { haulBlockedReason } from '../../../src/core/economy/HaulDispatch.js';
import { refreshLogisticsCapacity } from '../../../src/core/engine/BuildingTaskHelpers.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';

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
  // Barren ("plain") fragments haul to a spoil heap, ore to the warehouse (#1530).
  const heap = placeBuilding(state.buildings, 'spoil_heap', 36, 30, width, height);
  if (!heap.success) throw new Error(`Setup: placeBuilding failed — ${heap.error}`);
  return state;
}

/**
 * Same site with a spoil heap in the warehouse's slot (same top-left corner, so the
 * same nearest approach cell from the south-west): a barren candidate's depot leg then
 * costs what an ore candidate's costs in makeState (#1530).
 */
function makeHeapOnlyState(width = 60, height = 60): GameState {
  const state = createGame({ seed: 42 });
  state.navGrid = makeFlatGrid(width, height);
  const heap = placeBuilding(state.buildings, 'spoil_heap', 30, 30, width, height);
  if (!heap.success) throw new Error(`Setup: placeBuilding failed — ${heap.error}`);
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
    origin: { x, y: 0, z },
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
// selectBestActionForEmployee — the bonus applies to the REAL cost (#1586)
// ═══════════════════════════════════════════════════════════════════════════

describe('selectBestActionForEmployee — ore bonus applies to the real cost (#1586)', () => {
  /**
   * Employee (58,45) with a plain candidate 5 cells north behind a wall (z=43,
   * only gap at x=0): cheapest estimate, but a long real detour. An ore candidate
   * far to the south-east: higher estimate AND higher raw real cost than the plain
   * one, yet its bonus-adjusted real cost (raw - ORE_HAUL_PRIORITY_BONUS_TICKS) is
   * lower than the plain one's real cost.
   */
  function makeWalledLayout() {
    const state = makeState(120, 120);
    for (let x = 1; x < 120; x++) state.navGrid!.cells[43]![x] = makeCell('blocked');
    const emp = makeHaulerEmployee(state, 58, 45);
    addBlastFragments(state.logistics, [
      makeFragment(1, 58, 40, {}),
      makeFragment(2, 70, 80, { gloomium: 0.2 }),
    ]);
    const plain = makeHaulAction({ id: 1, targetX: 58, targetZ: 40, payload: { fragmentId: 1 } });
    const ore = makeHaulAction({ id: 2, targetX: 70, targetZ: 80, payload: { fragmentId: 2 } });
    return { state, emp, plain, ore };
  }

  it('the ore candidate with the higher raw real cost but lower bonus-adjusted real cost wins; totalTicks stays raw', () => {
    const { state, emp, plain, ore } = makeWalledLayout();

    const plainReal = resolveActionCost(state, emp, plain)!.totalTicks;
    const oreReal = resolveActionCost(state, emp, ore)!.totalTicks;
    // Fixture preconditions: plain is first by estimate, cheaper by raw real cost,
    // but dearer than the ore candidate once the bonus is subtracted.
    expect(estimateActionCost(state, emp, plain)).toBeLessThan(estimateActionCost(state, emp, ore));
    expect(plainReal).toBeLessThan(oreReal);
    expect(oreReal - ORE_HAUL_PRIORITY_BONUS_TICKS).toBeLessThan(plainReal);

    const result = selectBestActionForEmployee(state, emp, [plain, ore]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(ore.id);
    expect(result!.totalTicks).toBeCloseTo(oreReal, 10);
  });

  it('without the ore fragment the plain candidate (lower real cost) is still chosen', () => {
    const { state, emp, plain } = makeWalledLayout();
    addBlastFragments(state.logistics, [makeFragment(3, 70, 80, {})]);
    // Same position as the ore candidate but barren: no bonus, so real cost decides.
    const barren = makeHaulAction({ id: 3, targetX: 70, targetZ: 80, payload: { fragmentId: 3 } });

    const result = selectBestActionForEmployee(state, emp, [plain, barren]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(plain.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveActionCost — the bonus is ranking-only, never leaks into duration
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveActionCost — ore priority bonus never affects the real resolved duration (#671)', () => {
  it("an ore-bearing haul_debris candidate's resolved totalTicks matches an otherwise-identical plain candidate's, with no bonus subtracted", () => {
    const state = makeState();
    const emp = makeHaulerEmployee(state, 0, 0);
    const heapState = makeHeapOnlyState();
    const heapEmp = makeHaulerEmployee(heapState, 0, 0);

    // Two fragments at the exact same position — one ore-bearing, one not,
    // otherwise identical (same mass/volume, so computeActionWorkTicks's own
    // inputs match too) — isolates the ore bonus as the ONLY variable between
    // their two resolveActionCost calls. #1091: comparing against the real
    // plain candidate's own resolved cost (rather than a hand-rolled
    // travel-distance recomputation) stays correct regardless of exactly how
    // many legs planFragmentTaskItinerary's route happens to carry (today: a
    // drive to the fragment, then on to the depot).
    // (The plain one is barren, so it lives in the heap-only twin of the site.)
    addBlastFragments(heapState.logistics, [makeFragment(1, 10, 0, {})]);
    addBlastFragments(state.logistics, [makeFragment(2, 10, 0, { gloomium: 0.2 })]);
    const plain = makeHaulAction({ id: 1, targetX: 10, targetZ: 0, payload: { fragmentId: 1 } });
    const ore = makeHaulAction({ id: 2, targetX: 10, targetZ: 0, payload: { fragmentId: 2 } });

    const resolvedPlain = resolveActionCost(heapState, heapEmp, plain);
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
      makeFragment(3, 0, 10, { gloomium: 0.2 }),
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

// ═══════════════════════════════════════════════════════════════════════════
// Barren rock yields to any claimable ore haul (#1870)
// ═══════════════════════════════════════════════════════════════════════════

describe('selectBestActionForEmployee — a barren haul waits while an ore haul can be taken (#1870)', () => {
  /** An ore candidate this many bonus-widths farther than the barren one: cost alone picks the barren haul. */
  const BEYOND_BONUS_CELLS = 3 * ORE_HAUL_PRIORITY_BONUS_TICKS * DEBRIS_HAULER_SPEED;
  const NEAR_X = 6;
  const FAR_X = NEAR_X + BEYOND_BONUS_CELLS;

  /** Leaves `freeKg` of room in the warehouse by parking a stored filler fragment in it (what a stocked warehouse is). */
  function leaveWarehouseRoom(state: GameState, freeKg: number): void {
    const warehouse = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    refreshLogisticsCapacity(state);
    const filler = makeFragment(9000, 0, 0, {});
    filler.mass = state.logistics.storageCapacityKg - freeKg;
    state.logistics.fragments.push({ fragment: filler, state: 'stored', vehicleId: null, warehouseId: warehouse.id });
    state.logistics.storedMassKg += filler.mass;
  }

  function layout() {
    const state = makeState(260, 260);
    const emp = makeHaulerEmployee(state, 0, 0);
    addBlastFragments(state.logistics, [
      makeFragment(1, NEAR_X, 0, {}),
      makeFragment(2, FAR_X, 0, { gloomium: 0.2 }),
    ]);
    const barren = makeHaulAction({ id: 1, targetX: NEAR_X, targetZ: 0, payload: { fragmentId: 1 } });
    const ore = makeHaulAction({ id: 2, targetX: FAR_X, targetZ: 0, payload: { fragmentId: 2 } });
    return { state, emp, barren, ore };
  }

  it('fixture: on cost alone the nearer barren haul beats the ore haul even with the ore bonus', () => {
    const { state, emp, barren, ore } = layout();
    expect(estimateActionCost(state, emp, barren)).toBeLessThan(estimateActionCost(state, emp, ore));
  });

  it('a reachable ore haul and a much nearer barren haul: the driver takes the ore haul', () => {
    const { state, emp, barren, ore } = layout();
    const result = selectBestActionForEmployee(state, emp, [barren, ore]);
    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(ore.id);
  });

  it('candidate order does not matter', () => {
    const { state, emp, barren, ore } = layout();
    expect(selectBestActionForEmployee(state, emp, [ore, barren])!.action.id).toBe(ore.id);
  });

  it('every barren haul waits: with several nearer barren hauls the ore haul is still the pick', () => {
    const { state, emp, ore } = layout();
    addBlastFragments(state.logistics, [makeFragment(3, 2, 0, {}), makeFragment(4, 3, 1, {}), makeFragment(5, 1, 4, {})]);
    const extraSpots: Record<number, [number, number]> = { 3: [2, 0], 4: [3, 1], 5: [1, 4] };
    const extras = [3, 4, 5].map(id => makeHaulAction({ id, targetX: extraSpots[id]![0], targetZ: extraSpots[id]![1], payload: { fragmentId: id } }));
    const barren = makeHaulAction({ id: 1, targetX: NEAR_X, targetZ: 0, payload: { fragmentId: 1 } });
    expect(selectBestActionForEmployee(state, emp, [barren, ...extras, ore])!.action.id).toBe(ore.id);
  });

  it('the reported totalTicks stays the real cost of the ore haul', () => {
    const { state, emp, barren, ore } = layout();
    const result = selectBestActionForEmployee(state, emp, [barren, ore])!;
    expect(result.totalTicks).toBeCloseTo(resolveActionCost(state, emp, ore)!.totalTicks, 10);
  });

  it('trace ore under the barren threshold goes to the heap, so it yields to real ore like barren rock does', () => {
    const { state, emp, ore } = layout();
    addBlastFragments(state.logistics, [makeFragment(3, NEAR_X, 1, { gloomium: SPOIL_BARREN_ORE_FRACTION_THRESHOLD / 2 })]);
    const trace = makeHaulAction({ id: 3, targetX: NEAR_X, targetZ: 1, payload: { fragmentId: 3 } });
    expect(selectBestActionForEmployee(state, emp, [trace, ore])!.action.id).toBe(ore.id);
  });

  it('ore just over the barren threshold is warehouse ore, and ranks on cost against other ore', () => {
    const { state, emp, ore } = layout();
    addBlastFragments(state.logistics, [makeFragment(3, NEAR_X, 1, { gloomium: SPOIL_BARREN_ORE_FRACTION_THRESHOLD * 2 })]);
    const rich = makeHaulAction({ id: 3, targetX: NEAR_X, targetZ: 1, payload: { fragmentId: 3 } });
    expect(selectBestActionForEmployee(state, emp, [rich, ore])!.action.id).toBe(rich.id);
  });

  it('a barren haul burying a planned hole on a progression site is not held back by the ore', () => {
    const { state, emp, barren, ore } = layout();
    state.grade = createGradeState();
    state.plannedDrillHoles.push({ id: 'H1', x: NEAR_X, z: 0, depth: 6, diameter: 0.089 });
    expect(selectBestActionForEmployee(state, emp, [barren, ore])!.action.id).toBe(barren.id);
  });

  it('a planned hole elsewhere keeps the barren haul waiting behind the ore', () => {
    const { state, emp, barren, ore } = layout();
    state.grade = createGradeState();
    state.plannedDrillHoles.push({ id: 'H1', x: NEAR_X, z: 40, depth: 6, diameter: 0.089 });
    expect(selectBestActionForEmployee(state, emp, [barren, ore])!.action.id).toBe(ore.id);
  });

  it('off a progression site a planned hole under barren rock changes nothing', () => {
    const { state, emp, barren, ore } = layout();
    state.plannedDrillHoles.push({ id: 'H1', x: NEAR_X, z: 0, depth: 6, diameter: 0.089 });
    expect(selectBestActionForEmployee(state, emp, [barren, ore])!.action.id).toBe(ore.id);
  });

  it('the warehouse refuses the ore (isClaimable false): the driver takes the barren haul', () => {
    const { state, emp, barren, ore } = layout();
    const result = selectBestActionForEmployee(state, emp, [barren, ore], a => a.id !== ore.id);
    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(barren.id);
  });

  it('a really full warehouse (storage_full) lets barren rock go to the heap', () => {
    const { state, emp, barren, ore } = layout();
    leaveWarehouseRoom(state, 500); // fragments weigh 1000 kg: none fits
    expect(haulBlockedReason(state, ore)).toBe('storage_full');
    expect(haulBlockedReason(state, barren)).toBeNull();

    const result = selectBestActionForEmployee(state, emp, [barren, ore], a => haulBlockedReason(state, a) === null);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(barren.id);
  });

  it('room left in the warehouse for the ore: the ore haul still goes first', () => {
    const { state, emp, barren, ore } = layout();
    leaveWarehouseRoom(state, 1500); // fragments weigh 1000 kg: one fits
    expect(haulBlockedReason(state, ore)).toBeNull();
    const result = selectBestActionForEmployee(state, emp, [barren, ore], a => haulBlockedReason(state, a) === null);
    expect(result!.action.id).toBe(ore.id);
  });

  it('every ore fragment out of reach (walled in, no costed ore haul): barren competes as usual and is taken', () => {
    const { state, emp, barren, ore } = layout();
    // A full-height wall between the employee (and depot) and the ore: no route, no climb.
    const wallX = Math.round(FAR_X) - 2;
    expect(wallX).toBeGreaterThan(40);
    for (let z = 0; z < 260; z++) state.navGrid!.cells[z]![wallX] = makeCell('blocked');
    expect(resolveActionCost(state, emp, ore)).toBeNull();

    const result = selectBestActionForEmployee(state, emp, [barren, ore]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(barren.id);
  });

  it('walled-in ore does not let another tier-0 action displace the cheapest barren haul', () => {
    const { state, emp, barren, ore } = layout();
    const wallX = Math.round(FAR_X) - 2;
    for (let z = 0; z < 260; z++) state.navGrid!.cells[z]![wallX] = makeCell('blocked');
    expect(resolveActionCost(state, emp, ore)).toBeNull();
    // Same tier as a haul, but farther than the barren haul on the reachable side of the wall.
    const work: PendingAction = {
      id: 20, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
      targetX: NEAR_X + 15, targetZ: 0, targetY: 0, targetEmployeeId: null, status: 'queued', holderId: null,
      queuedAtTick: 0, payload: { durationTicks: 10 },
    };
    expect(estimateActionCost(state, emp, barren)).toBeLessThan(estimateActionCost(state, emp, work));

    const result = selectBestActionForEmployee(state, emp, [work, ore, barren]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(barren.id);
  });

  it('no ore on the ground at all: the nearest barren haul is chosen (no regression)', () => {
    const state = makeState(260, 260);
    const emp = makeHaulerEmployee(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 30, 0, {}), makeFragment(2, 8, 0, {})]);
    const far = makeHaulAction({ id: 1, targetX: 30, targetZ: 0, payload: { fragmentId: 1 } });
    const near = makeHaulAction({ id: 2, targetX: 8, targetZ: 0, payload: { fragmentId: 2 } });
    expect(selectBestActionForEmployee(state, emp, [far, near])!.action.id).toBe(near.id);
  });

  it('a loaded (in_transit) barren haul still finishes before a ground ore haul (#1709)', () => {
    const { state, emp, barren, ore } = layout();
    // The driver sits in a hauler that already carries the barren piece (interrupted trip, order back in the pool).
    const vehicle = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
    vehicle.occupantIds = [emp.id];
    emp.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.cargo = [{ fragmentId: 1, massKg: 1000 }];
    const tracked = state.logistics.fragments.find(t => t.fragment.id === 1)!;
    tracked.state = 'in_transit';
    tracked.vehicleId = String(vehicle.id);
    state.pendingActions.push(barren);
    reserveVehicle(state.vehicles, vehicle.id, barren.id);
    expect(resolveActionCost(state, emp, barren)).not.toBeNull();

    const result = selectBestActionForEmployee(state, emp, [barren, ore]);
    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(barren.id);
  });

  it('the ore weighting among ore hauls is unchanged: the nearer ore haul beats a farther one', () => {
    const { state, emp, ore } = layout();
    addBlastFragments(state.logistics, [makeFragment(6, FAR_X - 20, 0, { gloomium: 0.2 })]);
    const nearerOre = makeHaulAction({ id: 6, targetX: FAR_X - 20, targetZ: 0, payload: { fragmentId: 6 } });
    expect(selectBestActionForEmployee(state, emp, [ore, nearerOre])!.action.id).toBe(nearerOre.id);
  });

  it('a higher-tier charge_hole outranks both the ore haul and the barren haul', () => {
    const { state, emp, barren, ore } = layout();
    assignSkill(state.employees, emp.id, 'blasting', 1);
    const charge: PendingAction = {
      id: 10, type: 'charge_hole', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 40, targetZ: 40, targetY: 0, targetEmployeeId: null, status: 'queued', holderId: null,
      queuedAtTick: 0, payload: { holeId: 'H1', durationTicks: 10 },
    };
    expect(selectBestActionForEmployee(state, emp, [barren, ore, charge])!.action.id).toBe(charge.id);
  });

  it('with the charge_hole unclaimable the ore haul, not the barren one, is next', () => {
    const { state, emp, barren, ore } = layout();
    assignSkill(state.employees, emp.id, 'blasting', 1);
    const charge: PendingAction = {
      id: 10, type: 'charge_hole', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 40, targetZ: 40, targetY: 0, targetEmployeeId: null, status: 'queued', holderId: null,
      queuedAtTick: 0, payload: { holeId: 'H1', durationTicks: 10 },
    };
    const result = selectBestActionForEmployee(state, emp, [barren, ore, charge], a => a.type !== 'charge_hole');
    expect(result!.action.id).toBe(ore.id);
  });
});
