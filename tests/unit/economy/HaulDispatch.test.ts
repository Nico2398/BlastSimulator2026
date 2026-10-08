// BlastSimulator2026 — Tests for HaulDispatch.ts (issue #552)
//
// Hauling becomes self-dispatching: syncHaulDispatch spawns one PendingAction
// per on-ground haulable fragment (haul_debris) or oversized fragment
// (fragment_debris), idempotently, so a qualified employee can pick it up via
// the normal cost-based dispatch (#549) instead of the manual Fleet-panel
// Haul button. isHaulOrFragmentActionClaimable is the claim-time gate that
// keeps a claim from succeeding once the fragment underneath it is no longer
// eligible (storage full, no longer oversized, already moved on).
//
// Red phase: syncHaulDispatch/isHaulOrFragmentActionClaimable are still
// no-op/pass-through stubs (src/core/economy/HaulDispatch.ts), so every test
// below is expected to fail until #552 is implemented.

import { setFreightRoom, setFreightRoomExact, sitesOf } from "../../helpers/freightWarehouse.js";
import { describe, it, expect } from 'vitest';
import type { ActionType } from '../../../src/core/state/GameState.js';
import { createGame, type PendingAction } from '../../../src/core/state/GameState.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';
import { haulBlockedReason, isAutoDebrisAction, syncHaulDispatch, isHaulOrFragmentActionClaimable, haulActionCarriesOre, createFragmentLookup, findNearbyHaulableFragments } from '../../../src/core/economy/HaulDispatch.js';
import { pickupFragment } from '../../../src/core/economy/Logistics.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { isHaulBlockedReason } from '../../../src/core/economy/HaulDispatch.js';
import { refreshLogisticsCapacity } from '../../../src/core/engine/BuildingTaskHelpers.js';

const SEED = 42;

// Default volume sits under OVERSIZED_FRAGMENT_THRESHOLD, mirroring
// HaulingTask.test.ts's makeFragment — plain fixtures stay haulable by
// default; oversized-gate tests override `.volume` explicitly.
function makeFragment(id: number, x: number, z: number, mass = 1000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin: { x, y: 0, z },
  };
}

/** An ore-bearing fragment: heads for a freight warehouse (barren default ones go to a spoil heap, #1530). */
function oreFragment(id: number, x: number, z: number, mass = 1000): FragmentData {
  return { ...makeFragment(id, x, z, mass), oreDensities: { blingite: 0.5 } };
}

function makeOversizedFragment(id: number, x: number, z: number, mass = 1000): FragmentData {
  const f = makeFragment(id, x, z, mass);
  f.volume = OVERSIZED_FRAGMENT_THRESHOLD + 0.5;
  return f;
}

/** Minimal PendingAction fixture for isHaulOrFragmentActionClaimable tests, mirroring VehicleReservation.test.ts's makeAction. */
function makeHaulAction(overrides: Partial<PendingAction> & { id: number; payload: { fragmentId: number } }): PendingAction {
  return {
    type: 'haul_debris',
    requiredSkill: 'driving.truck',
    requiredVehicleRole: 'debris_hauler',
    targetX: 0, targetZ: 0, targetY: 0,
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
    ...overrides,
  };
}

// ── syncHaulDispatch — creation ─────────────────────────────────────────────

describe('syncHaulDispatch — creates haul_debris actions', () => {
  it('creates one haul_debris action per on-ground haulable fragment', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [
      makeFragment(1, 5, 5),
      makeFragment(2, 8, 3),
    ]);

    syncHaulDispatch(state);

    const haulActions = state.pendingActions.filter(a => a.type === 'haul_debris');
    expect(haulActions).toHaveLength(2);

    const fragmentIds = haulActions.map(a => (a.payload as { fragmentId: number }).fragmentId).sort();
    expect(fragmentIds).toEqual([1, 2]);

    for (const action of haulActions) {
      expect(action.status).toBe('queued');
      expect(action.holderId).toBeNull();
      expect(action.targetEmployeeId).toBeNull();
      expect(action.requiredVehicleRole).toBe('debris_hauler');
      // requiredSkill is deliberately null, not 'driving.truck' — the real
      // licence check happens at claim time via requiredVehicleRole/
      // findVehicleForClaim (VehicleReservation.ts's isLicensedForRole), not
      // via requiredSkill. Setting it here would make tickEmployees'
      // roster-wide "does anyone qualify" scan (EmployeeDispatch.ts) flag this action
      // unqualified — auto-pausing the game with an unqualified_task_error
      // event — the instant it's queued on a fresh site with no licensed
      // driver hired yet, instead of letting it sit queued silently (see
      // HaulDispatch.ts's own header comment on syncHaulDispatch).
      expect(action.requiredSkill).toBeNull();

      const fragment = state.logistics.fragments.find(
        f => f.fragment.id === (action.payload as { fragmentId: number }).fragmentId,
      )!.fragment;
      const approach = fragmentApproachCell(fragment, state);
      expect(action.targetX).toBe(approach.x);
      expect(action.targetZ).toBe(approach.z);
    }
  });

  it('creates zero actions when there are no on-ground fragments (boundary: empty logistics)', () => {
    const state = createGame({ seed: SEED });

    syncHaulDispatch(state);

    expect(state.pendingActions).toHaveLength(0);
  });
});

describe('syncHaulDispatch — idempotency', () => {
  it('creates zero duplicate actions on a second call for a fragment already covered by a queued action', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    syncHaulDispatch(state);
    syncHaulDispatch(state);

    expect(state.pendingActions.filter(a => a.type === 'haul_debris')).toHaveLength(1);
  });

  it.each(['assigned', 'in_progress'] as const)(
    'creates zero duplicate actions when the existing action for that fragment is already %s (not just queued)',
    (status) => {
      const state = createGame({ seed: SEED });
      addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

      syncHaulDispatch(state);
      const existing = state.pendingActions.find(a => a.type === 'haul_debris')!;
      existing.status = status;
      existing.holderId = 999;

      syncHaulDispatch(state);

      expect(state.pendingActions.filter(a => a.type === 'haul_debris')).toHaveLength(1);
    },
  );

  it('still creates an action for a second fragment added after the first sync, without duplicating the first', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    syncHaulDispatch(state);

    addBlastFragments(state.logistics, [makeFragment(2, 6, 6)]);
    syncHaulDispatch(state);

    const haulActions = state.pendingActions.filter(a => a.type === 'haul_debris');
    expect(haulActions).toHaveLength(2);
    const fragmentIds = haulActions.map(a => (a.payload as { fragmentId: number }).fragmentId).sort();
    expect(fragmentIds).toEqual([1, 2]);
  });
});

describe('syncHaulDispatch — oversized fragments', () => {
  it('creates a fragment_debris action instead of haul_debris for an oversized on-ground fragment', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 5, 5)]);

    syncHaulDispatch(state);

    expect(state.pendingActions).toHaveLength(1);
    const action = state.pendingActions[0]!;
    expect(action.type).toBe('fragment_debris');
    expect(action.requiredVehicleRole).toBe('rock_fragmenter');
    // requiredSkill deliberately null — see the same-shaped assertion above.
    expect(action.requiredSkill).toBeNull();
    expect((action.payload as { fragmentId: number }).fragmentId).toBe(1);
  });

  it('creates a fragment_debris action for an oversized fragment exactly at the threshold plus epsilon while a threshold-exact fragment stays haulable', () => {
    const state = createGame({ seed: SEED });
    const atThreshold = makeFragment(1, 5, 5);
    atThreshold.volume = OVERSIZED_FRAGMENT_THRESHOLD;
    const overThreshold = makeFragment(2, 8, 8);
    overThreshold.volume = OVERSIZED_FRAGMENT_THRESHOLD + 0.01;
    addBlastFragments(state.logistics, [atThreshold, overThreshold]);

    syncHaulDispatch(state);

    const byFragment = new Map(
      state.pendingActions.map(a => [(a.payload as { fragmentId: number }).fragmentId, a.type]),
    );
    expect(byFragment.get(1)).toBe('haul_debris');
    expect(byFragment.get(2)).toBe('fragment_debris');
  });

  it('mixes haul_debris and fragment_debris actions correctly across a field of both fragment kinds', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [
      makeFragment(1, 1, 1),
      makeOversizedFragment(2, 2, 2),
      makeFragment(3, 3, 3),
    ]);

    syncHaulDispatch(state);

    expect(state.pendingActions).toHaveLength(3);
    const byFragment = new Map(
      state.pendingActions.map(a => [(a.payload as { fragmentId: number }).fragmentId, a.type]),
    );
    expect(byFragment.get(1)).toBe('haul_debris');
    expect(byFragment.get(2)).toBe('fragment_debris');
    expect(byFragment.get(3)).toBe('haul_debris');
  });
});

describe('syncHaulDispatch — fragments that have moved on', () => {
  it('never creates a new action for a fragment that has transitioned to in_transit, even if its prior action record was removed', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    syncHaulDispatch(state);
    expect(state.pendingActions).toHaveLength(1);

    // Simulate the action completing/being removed elsewhere, and the
    // fragment having been picked up by a hauler.
    state.pendingActions = [];
    state.logistics.fragments.find(f => f.fragment.id === 1)!.state = 'in_transit';

    syncHaulDispatch(state);

    expect(state.pendingActions).toHaveLength(0);
  });

  it('never creates a new action for a fragment that has transitioned to stored, even if its prior action record was removed', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    syncHaulDispatch(state);
    expect(state.pendingActions).toHaveLength(1);

    state.pendingActions = [];
    state.logistics.fragments.find(f => f.fragment.id === 1)!.state = 'stored';

    syncHaulDispatch(state);

    expect(state.pendingActions).toHaveLength(0);
  });
});

// ── isHaulOrFragmentActionClaimable ─────────────────────────────────────────

describe('isHaulOrFragmentActionClaimable — pass-through for other action types', () => {
  it('is true for a general_work action regardless of storage state', () => {
    const state = createGame({ seed: SEED });
    setFreightRoomExact(state, 100);
    state.logistics.storedMassKg = 100; // full

    const action: PendingAction = {
      id: 1,
      type: 'general_work',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });

  it('is true for a survey action', () => {
    const state = createGame({ seed: SEED });

    const action: PendingAction = {
      id: 2,
      type: 'survey',
      requiredSkill: 'geology',
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });
});

describe('isHaulOrFragmentActionClaimable — haul_debris storage gate', () => {
  it('is false when the fragment mass exceeds the remaining free storage capacity', () => {
    const state = createGame({ seed: SEED });
    setFreightRoomExact(state, 100); // 100 kg free
    const fragment = oreFragment(1, 5, 5, 500); // exceeds the 100 kg free room
    addBlastFragments(state.logistics, [fragment]);
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);
  });

  it('becomes true once capacity frees up enough to fit the fragment', () => {
    const state = createGame({ seed: SEED });
    setFreightRoomExact(state, 100);
    const fragment = oreFragment(1, 5, 5, 500);
    addBlastFragments(state.logistics, [fragment]);
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });
    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);

    state.logistics.fragments = state.logistics.fragments.filter(f => f.state !== 'stored'); // filler gone: 2000 kg free now

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });

  it('is true (boundary) when the fragment mass exactly equals the remaining free capacity', () => {
    const state = createGame({ seed: SEED });
    setFreightRoomExact(state, 500); // 500 kg free
    const fragment = oreFragment(1, 5, 5, 500); // exactly fits
    addBlastFragments(state.logistics, [fragment]);
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });

  it('is false when the fragment referenced by the action no longer exists (removed elsewhere)', () => {
    const state = createGame({ seed: SEED });
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 999 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);
  });

  it('is false when the fragment has already moved on to in_transit', () => {
    const state = createGame({ seed: SEED });
    const fragment = oreFragment(1, 5, 5, 100);
    addBlastFragments(state.logistics, [fragment]);
    state.logistics.fragments[0]!.state = 'in_transit';
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);
  });
});

describe('isHaulOrFragmentActionClaimable — fragment_debris oversized gate', () => {
  function makeFragmentDebrisAction(overrides: Partial<PendingAction> & { id: number; payload: { fragmentId: number } }): PendingAction {
    return {
      type: 'fragment_debris',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_fragmenter',
      targetX: 0, targetZ: 0, targetY: 0,
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
      ...overrides,
    };
  }

  it('is true while the fragment is still on_ground and still oversized', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 5, 5)]);
    const action = makeFragmentDebrisAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });

  it('is false once the fragment is no longer oversized (e.g. broken by another vehicle already)', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]); // not oversized
    const action = makeFragmentDebrisAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);
  });

  it('is false once the fragment is no longer on_ground', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 5, 5)]);
    state.logistics.fragments[0]!.state = 'in_transit';
    const action = makeFragmentDebrisAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);
  });

  it('is false when the fragment referenced no longer exists', () => {
    const state = createGame({ seed: SEED });
    const action = makeFragmentDebrisAction({ id: 1, payload: { fragmentId: 999 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);
  });

  it('is unaffected by storage capacity — breaking never touches the warehouse', () => {
    const state = createGame({ seed: SEED });
    setFreightRoomExact(state, 100);
    state.logistics.storedMassKg = 100; // full
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 5, 5, 50_000)]); // far heavier than any free room
    const action = makeFragmentDebrisAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });
});

// ── haulActionCarriesOre (#671) ─────────────────────────────────────────────
//
// Red phase: haulActionCarriesOre is still a throwing stub
// (src/core/economy/HaulDispatch.ts), so every test below is expected to
// fail until #671 is implemented. Once wired into ActionSelection.ts's
// estimateActionCost, this is the predicate that decides whether a
// haul_debris/fragment_debris candidate gets the ORE_HAUL_PRIORITY_BONUS_TICKS
// ranking discount.

describe('haulActionCarriesOre', () => {
  it('is true for a haul_debris action whose fragment carries ore (happy path)', () => {
    const state = createGame({ seed: SEED });
    const fragment = makeFragment(1, 5, 5);
    fragment.oreDensities = { gloomium: 0.1 };
    addBlastFragments(state.logistics, [fragment]);
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });

    expect(haulActionCarriesOre(state, action)).toBe(true);
  });

  it('is false for a haul_debris action whose fragment carries no ore (empty oreDensities)', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]); // default oreDensities: {}
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });

    expect(haulActionCarriesOre(state, action)).toBe(false);
  });

  it('is false for a general_work action even when its payload happens to reference an ore-bearing fragment id', () => {
    const state = createGame({ seed: SEED });
    const fragment = makeFragment(1, 5, 5);
    fragment.oreDensities = { gloomium: 0.1 };
    addBlastFragments(state.logistics, [fragment]);
    const action: PendingAction = {
      id: 1,
      type: 'general_work',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { fragmentId: 1 },
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };

    expect(haulActionCarriesOre(state, action)).toBe(false);
  });

  it('is false for a survey action (another non-haul type) referencing an ore-bearing fragment id', () => {
    const state = createGame({ seed: SEED });
    const fragment = makeFragment(1, 5, 5);
    fragment.oreDensities = { gloomium: 0.1 };
    addBlastFragments(state.logistics, [fragment]);
    const action: PendingAction = {
      id: 1,
      type: 'survey',
      requiredSkill: 'geology',
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { fragmentId: 1 },
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };

    expect(haulActionCarriesOre(state, action)).toBe(false);
  });

  it('is false when the fragment id the action references no longer resolves in state.logistics.fragments (rejection)', () => {
    const state = createGame({ seed: SEED });
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 999 } });

    expect(haulActionCarriesOre(state, action)).toBe(false);
  });

  it('is true for a fragment_debris action too (oversized ore-bearing fragment — breaking work is also ore-aware)', () => {
    const state = createGame({ seed: SEED });
    const fragment = makeOversizedFragment(1, 5, 5);
    fragment.oreDensities = { treranium: 0.15 };
    addBlastFragments(state.logistics, [fragment]);
    const action: PendingAction = {
      id: 1,
      type: 'fragment_debris',
      requiredSkill: null,
      requiredVehicleRole: 'rock_fragmenter',
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { fragmentId: 1 },
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };

    expect(haulActionCarriesOre(state, action)).toBe(true);
  });

  it('is false for a fragment_debris action whose oversized fragment carries no ore', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 5, 5)]); // default oreDensities: {}
    const action: PendingAction = {
      id: 1,
      type: 'fragment_debris',
      requiredSkill: null,
      requiredVehicleRole: 'rock_fragmenter',
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { fragmentId: 1 },
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };

    expect(haulActionCarriesOre(state, action)).toBe(false);
  });
});

// ── syncHaulDispatch/isHaulOrFragmentActionClaimable — GameState fixture sanity ──

describe('syncHaulDispatch — nextPendingActionId bookkeeping', () => {
  it('advances state.nextPendingActionId as it creates actions, keeping every id unique', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [
      makeFragment(1, 1, 1),
      makeFragment(2, 2, 2),
      makeFragment(3, 3, 3),
    ]);

    syncHaulDispatch(state);

    const ids = state.pendingActions.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── createFragmentLookup — one index per dispatch pass ──────────────────────
//
// The claim-time gate used to resolve an action's fragment with a linear
// `find` over logistics.fragments, once per pool action, per idle employee,
// per tick — O(employees × actions × fragments) after a large blast
// (level1-lose-ecology.json: 126 of 137 s in that one `find`). The lookup
// replaces it with one lazily-built index per pass; these pin that it answers
// exactly what `find` answered.

describe('createFragmentLookup — one index per dispatch pass', () => {
  it('resolves the very TrackedFragment object a linear find would return', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5), makeFragment(2, 6, 6), makeFragment(3, 7, 7)]);
    const lookup = createFragmentLookup(state);

    expect(lookup(2)).toBe(state.logistics.fragments.find(f => f.fragment.id === 2));
    expect(lookup(3)).toBe(state.logistics.fragments[2]);
  });

  it('answers undefined for an id nothing tracks', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    expect(createFragmentLookup(state)(99)).toBeUndefined();
    expect(createFragmentLookup(state)(1)).toBeDefined();
  });

  it('keeps the first occurrence when two tracked fragments share an id, exactly like find', () => {
    const state = createGame({ seed: SEED });
    const first = makeFragment(7, 1, 1);
    const second = makeFragment(7, 2, 2);
    addBlastFragments(state.logistics, [first, second]);

    expect(createFragmentLookup(state)(7)?.fragment).toBe(first);
    expect(state.logistics.fragments.find(f => f.fragment.id === 7)?.fragment).toBe(first);
  });

  it('holds live objects: a fragment picked up after the index was built reads as in_transit', () => {
    const state = createGame({ seed: SEED });
    setFreightRoom(state, 5000); // fresh state holds 0 kg until a warehouse syncs capacity (#1369)
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5)]);
    const lookup = createFragmentLookup(state);
    expect(lookup(1)?.state).toBe('on_ground');

    expect(pickupFragment(state.logistics, 1, 'v1', sitesOf(state), 0, 0)).toBe(true);

    expect(lookup(1)?.state).toBe('in_transit');
  });

  it('gives isHaulOrFragmentActionClaimable the same verdicts with the lookup as without it', () => {
    const state = createGame({ seed: SEED });
    setFreightRoomExact(state, 1000);
    state.logistics.storedMassKg = 0;
    addBlastFragments(state.logistics, [
      oreFragment(1, 5, 5, 500),            // haulable, fits
      oreFragment(2, 6, 6, 5000),           // heavier than the room left
      { ...makeOversizedFragment(3, 7, 7, 500), oreDensities: { blingite: 0.5 } }, // oversized ore: fits as haul_debris, and still breakable
      oreFragment(4, 8, 8, 500),            // will be picked up below
    ]);
    pickupFragment(state.logistics, 4, 'v1', sitesOf(state), 0, 0);
    const lookup = createFragmentLookup(state);

    const actions: PendingAction[] = [
      makeHaulAction({ id: 1, payload: { fragmentId: 1 } }),
      makeHaulAction({ id: 2, payload: { fragmentId: 2 } }),
      makeHaulAction({ id: 3, payload: { fragmentId: 3 } }),
      makeHaulAction({ id: 4, type: 'fragment_debris', requiredVehicleRole: 'rock_fragmenter', payload: { fragmentId: 3 } }),
      makeHaulAction({ id: 5, type: 'fragment_debris', requiredVehicleRole: 'rock_fragmenter', payload: { fragmentId: 1 } }),
      makeHaulAction({ id: 6, payload: { fragmentId: 4 } }),
      makeHaulAction({ id: 7, payload: { fragmentId: 42 } }),
    ];

    const verdicts = actions.map(a => isHaulOrFragmentActionClaimable(state, a, lookup));
    expect(verdicts).toEqual(actions.map(a => isHaulOrFragmentActionClaimable(state, a)));
    expect(verdicts).toEqual([true, false, true, true, false, false, false]);
  });

  it('gives haulActionCarriesOre the same verdicts with the lookup as without it', () => {
    const state = createGame({ seed: SEED });
    const ore = makeFragment(1, 5, 5);
    ore.oreDensities = { gloomium: 0.1 };
    addBlastFragments(state.logistics, [ore, makeFragment(2, 6, 6)]);
    const lookup = createFragmentLookup(state);
    const actions = [
      makeHaulAction({ id: 1, payload: { fragmentId: 1 } }),
      makeHaulAction({ id: 2, payload: { fragmentId: 2 } }),
      makeHaulAction({ id: 3, payload: { fragmentId: 3 } }),
    ];

    expect(actions.map(a => haulActionCarriesOre(state, a, lookup)))
      .toEqual(actions.map(a => haulActionCarriesOre(state, a)));
    expect(actions.map(a => haulActionCarriesOre(state, a, lookup))).toEqual([true, false, false]);
  });
});

describe('isAutoDebrisAction (#1302)', () => {
  it('is true for haul_debris and fragment_debris', () => {
    expect(isAutoDebrisAction('haul_debris')).toBe(true);
    expect(isAutoDebrisAction('fragment_debris')).toBe(true);
  });

  it('is false for player-ordered and other action types', () => {
    const others: ActionType[] = ['survey', 'place_building', 'drill_hole', 'charge_hole', 'dig_ramp_segment', 'level_ground'];
    for (const type of others) expect(isAutoDebrisAction(type), type).toBe(false);
  });
});

// ── #1369: freight warehouse gating ─────────────────────────────────────────

function addWarehouse(state: ReturnType<typeof createGame>): void {
  const result = placeBuilding(state.buildings, 'freight_warehouse', 20, 20, 64, 64);
  if (!result.success) throw new Error(`Setup: placeBuilding failed — ${result.error}`);
}

describe('haulBlockedReason (#1369)', () => {
  it('is no_freight_warehouse for a haul_debris action with no active freight_warehouse', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 100)]);
    expect(state.logistics.storageCapacityKg).toBe(0);
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 1 } }))).toBe('no_freight_warehouse');
  });

  it('no_freight_warehouse wins over storage_full when there is no warehouse and no room', () => {
    const state = createGame({ seed: SEED });
    state.logistics.storageCapacityKg = 0;
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 100)]);
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 1 } }))).toBe('no_freight_warehouse');
  });

  it('is null once a freight warehouse exists and the fragment fits', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 1000);
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 400)]);
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 1 } }))).toBeNull();
  });

  it('is null when the fragment mass exactly equals the room left', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 400);
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 400)]);
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 1 } }))).toBeNull();
  });

  it('is storage_full when the on-ground fragment is heavier than the room left', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 300);
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 400)]);
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 1 } }))).toBe('storage_full');
  });

  it('returns the same verdict with a createFragmentLookup index', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 100);
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 400)]);
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });
    expect(haulBlockedReason(state, action, createFragmentLookup(state))).toBe('storage_full');
  });

  it('is null for fragment_debris even with no warehouse', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 5, 5, 400)]);
    const action = makeHaulAction({ id: 1, type: 'fragment_debris', requiredVehicleRole: 'rock_fragmenter', payload: { fragmentId: 1 } });
    expect(haulBlockedReason(state, action)).toBeNull();
  });

  it('is null for a non-haul action type', () => {
    const state = createGame({ seed: SEED });
    const action = makeHaulAction({ id: 1, type: 'survey', payload: { fragmentId: 1 } });
    expect(haulBlockedReason(state, action)).toBeNull();
  });

  it('is null when the referenced fragment is missing (and warehouse exists)', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 10);
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 99 } }))).toBeNull();
  });

  it('is null for a missing fragment or one not on the ground even with no warehouse', () => {
    const state = createGame({ seed: SEED });
    setFreightRoomExact(state, 1000);
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 400)]);
    pickupFragment(state.logistics, 1, 'v1', sitesOf(state), 0, 0);
    state.buildings.buildings.length = 0; // the warehouse is gone
    state.logistics.storageCapacityKg = 0;
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 1 } }))).toBeNull();
    expect(haulBlockedReason(state, makeHaulAction({ id: 2, payload: { fragmentId: 99 } }))).toBeNull();
  });

  it('is null for a fragment that is no longer on_ground, however little room is left', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 1000);
    addBlastFragments(state.logistics, [oreFragment(1, 5, 5, 400)]);
    pickupFragment(state.logistics, 1, 'v1', sitesOf(state), 0, 0);
    setFreightRoomExact(state, 10);
    expect(haulBlockedReason(state, makeHaulAction({ id: 1, payload: { fragmentId: 1 } }))).toBeNull();
  });
});

// ── findNearbyHaulableFragments (#1370) ──────────────────────────────────────

describe('findNearbyHaulableFragments (#1370)', () => {
  function setup(fragments: FragmentData[]) {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, fragments);
    syncHaulDispatch(state);
    const primary = state.logistics.fragments.find(f => f.fragment.id === fragments[0]!.id)!;
    const ids = () => findNearbyHaulableFragments(state, primary, 10).map(t => t.fragment.id);
    return { state, ids };
  }

  it('excludes the primary itself and fragments beyond the radius', () => {
    const { ids } = setup([makeFragment(1, 5, 5), makeFragment(2, 6, 5), makeFragment(3, 40, 5)]);
    expect(ids()).toEqual([2]);
  });

  it('excludes oversized fragments', () => {
    const { ids } = setup([makeFragment(1, 5, 5), makeOversizedFragment(2, 6, 5), makeFragment(3, 7, 5)]);
    expect(ids()).toEqual([3]);
  });

  it('excludes fragments already in transit', () => {
    const { state, ids } = setup([oreFragment(1, 5, 5), oreFragment(2, 6, 5), oreFragment(3, 7, 5)]);
    setFreightRoom(state, 20_000); // fresh state holds 0 kg (#1369)
    expect(pickupFragment(state.logistics, 2, 'v1', sitesOf(state), 0, 0)).toBe(true);
    expect(ids()).toEqual([3]);
  });

  it('excludes fragments whose haul action is claimed', () => {
    const { state, ids } = setup([makeFragment(1, 5, 5), makeFragment(2, 6, 5), makeFragment(3, 7, 5)]);
    const claimed = state.pendingActions.find(a => a.payload['fragmentId'] === 2)!;
    claimed.holderId = 99;
    expect(ids()).toEqual([3]);
  });

  it('excludes fragments whose haul action is not queued', () => {
    const { state, ids } = setup([makeFragment(1, 5, 5), makeFragment(2, 6, 5), makeFragment(3, 7, 5)]);
    state.pendingActions.find(a => a.payload['fragmentId'] === 2)!.status = 'in_progress';
    expect(ids()).toEqual([3]);
  });

  it('excludes fragments with no haul action at all', () => {
    const { state, ids } = setup([makeFragment(1, 5, 5), makeFragment(2, 6, 5), makeFragment(3, 7, 5)]);
    state.pendingActions = state.pendingActions.filter(a => a.payload['fragmentId'] !== 3);
    expect(ids()).toEqual([2]);
  });

  it('orders nearest first, breaking distance ties by lower fragment id', () => {
    const { ids } = setup([makeFragment(1, 5, 5), makeFragment(9, 8, 5), makeFragment(4, 5, 7), makeFragment(7, 5, 3), makeFragment(2, 6, 5)]);
    // dist: 2 -> 1, 7 -> 2, 4 -> 2, 9 -> 3
    expect(ids()).toEqual([2, 4, 7, 9]);
  });
});

// ── #1530: spoil heap routing ───────────────────────────────────────────────

function barren(id: number, x: number, z: number, mass = 400): FragmentData {
  return makeFragment(id, x, z, mass); // oreDensities: {} is barren
}

function ore(id: number, x: number, z: number, mass = 400): FragmentData {
  return { ...makeFragment(id, x, z, mass), oreDensities: { blingite: 0.5 } };
}

function addHeap(state: ReturnType<typeof createGame>, x = 30, z = 30): void {
  const result = placeBuilding(state.buildings, 'spoil_heap', x, z, 64, 64);
  if (!result.success) throw new Error(`Setup: placeBuilding failed — ${result.error}`);
  refreshLogisticsCapacity(state);
}

describe('haulBlockedReason — spoil heap (#1530)', () => {
  const action = () => makeHaulAction({ id: 1, payload: { fragmentId: 1 } });

  it('isHaulBlockedReason accepts no_spoil_heap', () => {
    expect(isHaulBlockedReason('no_spoil_heap')).toBe(true);
    expect(isHaulBlockedReason('target_unreachable')).toBe(false);
  });

  it('a barren fragment with no heap is no_spoil_heap', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 10_000);
    addBlastFragments(state.logistics, [barren(1, 5, 5)]);
    expect(haulBlockedReason(state, action())).toBe('no_spoil_heap');
  });

  it('a barren fragment with no heap and no warehouse is no_spoil_heap, not no_freight_warehouse', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [barren(1, 5, 5)]);
    expect(haulBlockedReason(state, action())).toBe('no_spoil_heap');
  });

  it('a barren fragment is never storage_full: with a heap and a full warehouse it is unblocked', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 0);
    addHeap(state);
    addBlastFragments(state.logistics, [barren(1, 5, 5, 50_000)]);
    expect(haulBlockedReason(state, action())).toBeNull();
  });

  it('a barren fragment with a heap but no warehouse is unblocked', () => {
    const state = createGame({ seed: SEED });
    addHeap(state);
    addBlastFragments(state.logistics, [barren(1, 5, 5)]);
    expect(haulBlockedReason(state, action())).toBeNull();
  });

  it('an ore fragment with no warehouse is still no_freight_warehouse even with a heap', () => {
    const state = createGame({ seed: SEED });
    addHeap(state);
    addBlastFragments(state.logistics, [ore(1, 5, 5)]);
    expect(haulBlockedReason(state, action())).toBe('no_freight_warehouse');
  });

  it('an ore fragment with a warehouse but no heap is unblocked', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    setFreightRoomExact(state, 1000);
    addBlastFragments(state.logistics, [ore(1, 5, 5, 400)]);
    expect(haulBlockedReason(state, action())).toBeNull();
  });

  it('an ore fragment heavier than the room is still storage_full even with a heap', () => {
    const state = createGame({ seed: SEED });
    addWarehouse(state);
    addHeap(state);
    setFreightRoomExact(state, 100);
    addBlastFragments(state.logistics, [ore(1, 5, 5, 400)]);
    expect(haulBlockedReason(state, action())).toBe('storage_full');
  });
});

describe('findNearbyHaulableFragments — never mixes barren and ore (#1530)', () => {
  function setup(fragments: FragmentData[]) {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, fragments);
    syncHaulDispatch(state);
    const primary = state.logistics.fragments.find(f => f.fragment.id === fragments[0]!.id)!;
    return () => findNearbyHaulableFragments(state, primary, 10).map(t => t.fragment.id);
  }

  it('a barren primary only gets barren extras', () => {
    expect(setup([barren(1, 5, 5), ore(2, 6, 5), barren(3, 7, 5)])()).toEqual([3]);
  });

  it('an ore primary only gets ore extras', () => {
    expect(setup([ore(1, 5, 5), barren(2, 6, 5), ore(3, 7, 5)])()).toEqual([3]);
  });
});
