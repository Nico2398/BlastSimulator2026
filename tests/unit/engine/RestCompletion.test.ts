// BlastSimulator2026 — Tests for tickGeneralRestCompletion: completion path
// for fatigue rests created by tickCollapse, tickNeedRestoration, and
// autoInsertNeedTasks (relocated from GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickGeneralRestCompletion, type GeneralRestCompletionResult } from '../../../src/core/engine/RestCompletion.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import {
  NEED_REST_COSTS,
  MAX_NEED_GAUGE,
  NEED_REST_NO_BUILDING_CAP,
} from '../../../src/core/config/balance.js';

describe('tickGeneralRestCompletion', () => {
  const SEED = 42;

  // ── Test 1: Happy path ────────────────────────────────────────────────────
  it('completes rest: replenishes gauge, deducts cost, clears collapsing and rest state', () => {
    const state = createGame({ seed: SEED });
    state.cash = 1000;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 10;
    employee.collapsing = true;
    employee.restTicksRemaining = 1; // one more tick → completes this call
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'fatigue';
    state.pendingActions.push({
      id: actionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: { needKey: 'fatigue' },
      targetEmployeeId: employee.id,
      status: 'in_progress',
      holderId: employee.id,
      queuedAtTick: 0,
    });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result: GeneralRestCompletionResult = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'fatigue' }]);
    expect(employee.fatigue).toBeGreaterThan(10);
    expect(employee.collapsing).toBe(false);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull();
    expect(employee.restNeedKey).toBeNull();
    expect(state.cash).toBe(1000 - NEED_REST_COSTS.fatigue);
    expect(state.pendingActions.find(a => a.id === actionId)).toBeUndefined();
  });

  // ── Test 2: Boundary — resting with no building tops out at the no-building cap ──
  // A full restore here would make an empty site better than a Tier 1 living_quarters.
  it('caps the gauge at NEED_REST_NO_BUILDING_CAP when no living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 5;
    employee.restTicksRemaining = 1;
    employee.activeActionId = 42;
    employee.restNeedKey = 'fatigue';
    // No living_quarters building placed at all.

    const result = tickGeneralRestCompletion(state);

    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP);
    expect(employee.fatigue).toBeLessThan(MAX_NEED_GAUGE);
    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'fatigue' }]);
  });

  // ── Test 2b: Rejection — a gauge above the cap is not pulled down to it ──
  it('leaves a gauge already above the no-building cap untouched', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = NEED_REST_NO_BUILDING_CAP + 15;
    employee.restTicksRemaining = 1;
    employee.activeActionId = 42;
    employee.restNeedKey = 'fatigue';

    tickGeneralRestCompletion(state);

    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP + 15);
  });

  // ── Test 3: Not double-processed — owned by completeRestTick (Tier-2+ shift rest) instead ──
  it('does not process an employee owned by the Tier-2+ shift-cycle rest path', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.restTicksRemaining = 1;
    employee.activeActionId = 99;
    employee.restNeedKey = null; // no rest need key → shift-cycle rest, not general rest
    employee.fatigue = 5;

    const result = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([]);
    expect(employee.restTicksRemaining).toBe(1); // untouched — still owned by processShiftCycle
    expect(employee.fatigue).toBe(5);
  });

  // ── Test 4: Injury does not block rest completion (finding #8) ──
  it('completes rest for an employee who became injured mid-rest', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.fatigue = 10;
    employee.restTicksRemaining = 1;
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'fatigue';

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'fatigue' }]);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  // ── Test 5: record + ghost both vanish on completion (#547) ────────────────
  // A rest action's own pendingActions record now outlives its claim just like
  // any other action, so completion must clean up both the record and any
  // ghost preview sharing its id — the same completePendingAction contract
  // TaskDispatch.ts exposes for the dispatch/claim path.
  it('removes both the pendingActions record and any ghost preview sharing the completed rest action\'s id', () => {
    const state = createGame({ seed: SEED });
    state.cash = 1000;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 10;
    employee.restTicksRemaining = 1;
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'fatigue';
    state.pendingActions.push({
      id: actionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: { needKey: 'fatigue' },
      targetEmployeeId: employee.id,
      status: 'in_progress',
      holderId: employee.id,
      queuedAtTick: 0,
    });
    state.ghostPreviews.push({ id: actionId, type: 'rest', targetX: 5, targetZ: 5, targetY: 0, claimed: true });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    tickGeneralRestCompletion(state);

    expect(state.pendingActions.find(a => a.id === actionId)).toBeUndefined();
    expect(state.ghostPreviews.find(g => g.id === actionId)).toBeUndefined();
  });
});

// #1204: completion must read the completed rest action's OWN named building
// (payload.buildingId, via RestActionHelpers.ts's resolveRestBuildingId) for
// both the full-vs-capped restore decision and the exit ring cell — not
// whichever living_quarters happens to be nearest the employee's position at
// completion time. Before #1204, completeRestForEmployee always re-derived
// the building via a fresh nearest-by-position search, which is wrong the
// moment a second living_quarters exists closer to wherever the employee
// happens to be standing when their OWN rest completes.
describe('tickGeneralRestCompletion — buildingId threading (#1204)', () => {
  const SEED = 42;

  it("uses the rest action's own named building (payload.buildingId), not whichever living_quarters is nearest the employee's position at completion time", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    employee.fatigue = 10;
    employee.restTicksRemaining = 1;
    employee.restNeedKey = 'fatigue';

    // The named building: placed, then demolished — simulates it having been
    // removed mid-rest. The named-but-missing building must still win over a
    // real, active alternative sitting right at the employee's own position.
    const named = placeBuilding(state.buildings, 'living_quarters', 200, 200, 300, 300, 1);
    expect(named.success).toBe(true);
    const namedId = named.building!.id;
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id !== namedId);

    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    state.pendingActions.push({
      id: actionId, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: 5, targetZ: 5, targetY: 0,
      payload: { needKey: 'fatigue', buildingId: namedId },
      targetEmployeeId: employee.id, status: 'in_progress', holderId: employee.id, queuedAtTick: 0,
    });

    // A DIFFERENT, still-active living_quarters placed right at the
    // employee's own completion-time position — nearest-by-position search
    // would find THIS one and grant a full restore; the fix must not use it.
    const closer = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);
    expect(closer.success).toBe(true);

    tickGeneralRestCompletion(state);

    // Correct (#1204): the NAMED building no longer exists -> degraded,
    // capped rest. Buggy (pre-#1204): nearest-by-position finds `closer` ->
    // full MAX_NEED_GAUGE restore.
    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP);
  });

  // #1204: an employee actually inside the building (locomotion {kind:
  // 'inside', buildingId}) must be put back out onto its ring via
  // leaveBuildingIfInside on completion — mirrors #1203's own tickTraining
  // exit. Before #1204, completion never touched locomotion/occupancy at
  // all, since nobody ever went inside for a rest in the first place.
  it("exits the building on completion when locomotion is {kind:'inside', buildingId} — leaves via leaveBuildingIfInside, no longer 'inside'", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    const placed = placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100, 1);
    expect(placed.success).toBe(true);
    const building = placed.building!;
    building.occupantIds = [employee.id];
    employee.locomotion = { kind: 'inside', buildingId: building.id };
    employee.fatigue = 10;
    employee.restTicksRemaining = 1;
    employee.restNeedKey = 'fatigue';

    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    state.pendingActions.push({
      id: actionId, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: employee.x, targetZ: employee.z, targetY: 0,
      payload: { needKey: 'fatigue', buildingId: building.id },
      targetEmployeeId: employee.id, status: 'in_progress', holderId: employee.id, queuedAtTick: 0,
    });

    tickGeneralRestCompletion(state);

    expect(employee.locomotion.kind).not.toBe('inside');
    expect(building.occupantIds).not.toContain(employee.id);
  });
});
