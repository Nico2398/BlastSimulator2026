// BlastSimulator2026 — Tests for BoulderBreaking (issue #484, itinerary-driven #1091)
//
// requestBreakBoulder validates eligibility and installs the itinerary
// machinery (a PendingAction claimed/reserved for the vehicle, and an
// itinerary on the driver with a single drive leg ending in the
// ArrivalEffects.ts 'boulder_split' effect) rather than starting a per-tick
// phase machine — ArrivalEffects.test.ts covers what happens once that leg
// actually arrives. Mirrors HaulingTask.test.ts's shape for the break
// workflow instead of the haul one.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, vehicleDriverId } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import {
  requestBreakBoulder,
  isBreakEligibleVehicle,
  findReachableOversizedFragment,
} from '../../../src/core/economy/BoulderBreaking.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import type { Itinerary, ArrivalStep } from '../../../src/core/engine/Itinerary.js';
import { syncHaulDispatch } from '../../../src/core/economy/HaulDispatch.js';

const SEED = 42;

function makeFragment(id: number, x: number, z: number, volume = 1.0, mass = 1000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

/** A driverless rock_fragmenter with no active break. */
function makeIdleFragmenter(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  return purchaseVehicle(state.vehicles, 'rock_fragmenter', x, z).vehicle;
}

/** A rock_fragmenter with a licensed driver already boarded (driverId set, occupied, mounted). */
function makeDrivenFragmenter(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  const vehicle = makeIdleFragmenter(state, x, z);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng, x, z);
  assignSkill(state.employees, employee.id, 'driving.excavator', 1);
  // #1089/#1091: planItinerary/driving reads the driver off
  // vehicle.occupantIds[0]/employee.locomotion, not the driverId mirror alone.
  vehicle.occupantIds = [employee.id];
  employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  return vehicle;
}

function makeFlatNavGrid(size: number): NavGrid {
  const cells: NavCell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): NavCell => ({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

/** Every leg across `itinerary` whose arrival step is the named effect. */
function legsWithEffect(itinerary: Itinerary, effectId: string) {
  return itinerary.legs.filter(leg => (leg.onArrive as ArrivalStep).kind === 'effect' && (leg.onArrive as { effectId: string }).effectId === effectId);
}

// ── isBreakEligibleVehicle ───────────────────────────────────────────────────

describe('isBreakEligibleVehicle', () => {
  it('true for a rock_fragmenter with a driver and no reserved action', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    expect(isBreakEligibleVehicle(vehicle)).toBe(true);
  });

  it('false for a non-rock_fragmenter vehicle', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    expect(isBreakEligibleVehicle(vehicle)).toBe(false);
  });

  it('false for a rock_fragmenter with no driver assigned', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeIdleFragmenter(state);
    expect(isBreakEligibleVehicle(vehicle)).toBe(false);
  });

  it('false for a rock_fragmenter already reserved for another action', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    vehicle.reservedForActionId = 42;
    expect(isBreakEligibleVehicle(vehicle)).toBe(false);
  });

  it('false for undefined', () => {
    expect(isBreakEligibleVehicle(undefined)).toBe(false);
  });
});

// ── requestBreakBoulder — precondition failures ─────────────────────────────

describe('requestBreakBoulder — precondition failures', () => {
  it('rejects an unknown vehicle ID', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, 9999, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a debris_hauler (not a rock_fragmenter)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);
    vehicle.occupantIds = [employee.id];
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a rock_fragmenter with driverId: null', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeIdleFragmenter(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a rock_fragmenter already reserved for another action', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    vehicle.reservedForActionId = 42;
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment ID that does not exist', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);

    const result = requestBreakBoulder(state, vehicle.id, 9999);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment that is not on_ground (already in_transit)', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);
    state.logistics.fragments[0]!.state = 'in_transit';

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects an on_ground fragment whose volume is at/below the oversized threshold', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, OVERSIZED_FRAGMENT_THRESHOLD)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── requestBreakBoulder — happy path installs the itinerary machinery ──────

describe('requestBreakBoulder — happy path', () => {
  it('claims the vehicle for a fragment_debris action and installs an itinerary driving to the boulder\'s approach cell', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    const fragment = makeFragment(1, 5, 7, 1.0);
    const actionsBefore = state.pendingActions.length;
    addBlastFragments(state.logistics, [fragment], state.navGrid);
    // requestBreakBoulder claims an already-self-dispatched fragment_debris
    // action (#1091 — see HaulDispatch.ts's syncHaulDispatch) rather than
    // creating one itself; in real gameplay TickPipeline.ts runs this every
    // tick well before a player could issue a manual break request.
    syncHaulDispatch(state);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    // The core contract under test: no synchronous split.
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
    expect(state.logistics.fragments[0]!.fragment.id).toBe(1);

    // Claims the vehicle so no other request/dispatch can double-book it.
    expect(vehicle.reservedForActionId).not.toBeNull();
    const action = state.pendingActions.find(a => a.id === vehicle.reservedForActionId);
    expect(action).toBeDefined();
    expect(action!.type).toBe('fragment_debris');
    expect(action!.payload['fragmentId']).toBe(1);
    // Exactly one new action overall — syncHaulDispatch created it, and
    // requestBreakBoulder only claims it rather than creating a duplicate.
    expect(state.pendingActions.length).toBe(actionsBefore + 1);

    // Installs a driving itinerary on the driver ending in the boulder_split
    // arrival effect, per gameplay-vehicle-fleet's own
    // "[drive -> boulder, effect 'split']" shape.
    const driver = state.employees.employees.find(e => e.id === vehicleDriverId(vehicle))!;
    expect(driver.itinerary).not.toBeNull();
    const splitLegs = legsWithEffect(driver.itinerary!, 'boulder_split');
    expect(splitLegs).toHaveLength(1);

    const approach = fragmentApproachCell(fragment, state, vehicle.id);
    expect(splitLegs[0]!.destX).toBe(approach.x);
    expect(splitLegs[0]!.destZ).toBe(approach.z);
  });
});

// ── findReachableOversizedFragment ───────────────────────────────────────────

describe('findReachableOversizedFragment', () => {
  it('picks the nearest reachable oversized on-ground fragment', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    const near = makeFragment(1, 2, 2, OVERSIZED_FRAGMENT_THRESHOLD + 0.5);
    const far = makeFragment(2, 8, 8, OVERSIZED_FRAGMENT_THRESHOLD + 0.5);
    addBlastFragments(state.logistics, [far, near]);

    expect(findReachableOversizedFragment(state, vehicle.id)).toBe(1);
  });

  it('never returns a non-oversized fragment even when it is nearest', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    const nearButNotOversized = makeFragment(1, 2, 2, OVERSIZED_FRAGMENT_THRESHOLD);
    const farOversized = makeFragment(2, 8, 8, OVERSIZED_FRAGMENT_THRESHOLD + 0.5);
    addBlastFragments(state.logistics, [nearButNotOversized, farOversized]);

    expect(findReachableOversizedFragment(state, vehicle.id)).toBe(2);
  });

  it('returns null when there are zero oversized on-ground fragments', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 2, 2, OVERSIZED_FRAGMENT_THRESHOLD)]);

    expect(findReachableOversizedFragment(state, vehicle.id)).toBeNull();
  });

  it('returns null for an ineligible vehicle (no driver)', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeIdleFragmenter(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 2, 2, OVERSIZED_FRAGMENT_THRESHOLD + 1)]);

    expect(findReachableOversizedFragment(state, vehicle.id)).toBeNull();
  });
});
