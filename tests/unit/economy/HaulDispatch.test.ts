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

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';
import { syncHaulDispatch, isHaulOrFragmentActionClaimable } from '../../../src/core/economy/HaulDispatch.js';

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
  };
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
      // roster-wide "does anyone qualify" scan (GameLoop.ts) flag this action
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
    state.logistics.storageCapacityKg = 100;
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
    };

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });
});

describe('isHaulOrFragmentActionClaimable — haul_debris storage gate', () => {
  it('is false when the fragment mass exceeds the remaining free storage capacity', () => {
    const state = createGame({ seed: SEED });
    state.logistics.storageCapacityKg = 1000;
    state.logistics.storedMassKg = 900; // 100 kg free
    const fragment = makeFragment(1, 5, 5, 500); // exceeds the 100 kg free room
    addBlastFragments(state.logistics, [fragment]);
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);
  });

  it('becomes true once capacity frees up enough to fit the fragment', () => {
    const state = createGame({ seed: SEED });
    state.logistics.storageCapacityKg = 1000;
    state.logistics.storedMassKg = 900;
    const fragment = makeFragment(1, 5, 5, 500);
    addBlastFragments(state.logistics, [fragment]);
    const action = makeHaulAction({ id: 1, payload: { fragmentId: 1 } });
    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(false);

    state.logistics.storedMassKg = 0; // full 1000 kg free now

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
  });

  it('is true (boundary) when the fragment mass exactly equals the remaining free capacity', () => {
    const state = createGame({ seed: SEED });
    state.logistics.storageCapacityKg = 1000;
    state.logistics.storedMassKg = 500; // 500 kg free
    const fragment = makeFragment(1, 5, 5, 500); // exactly fits
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
    const fragment = makeFragment(1, 5, 5, 100);
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
    state.logistics.storageCapacityKg = 100;
    state.logistics.storedMassKg = 100; // full
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 5, 5, 50_000)]); // far heavier than any free room
    const action = makeFragmentDebrisAction({ id: 1, payload: { fragmentId: 1 } });

    expect(isHaulOrFragmentActionClaimable(state, action)).toBe(true);
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
