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
    employee.hunger = 10;
    employee.collapsing = true;
    employee.restTicksRemaining = 1; // one more tick → completes this call
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'hunger';
    state.pendingActions.push({
      id: actionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: { needKey: 'hunger' },
      targetEmployeeId: employee.id,
      status: 'in_progress',
      holderId: employee.id,
    });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result: GeneralRestCompletionResult = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'hunger' }]);
    expect(employee.hunger).toBeGreaterThan(10);
    expect(employee.collapsing).toBe(false);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull();
    expect(employee.restNeedKey).toBeNull();
    expect(state.cash).toBe(1000 - NEED_REST_COSTS.hunger);
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
    employee.hunger = 10;
    employee.restTicksRemaining = 1;
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'hunger';

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'hunger' }]);
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
    employee.hunger = 10;
    employee.restTicksRemaining = 1;
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'hunger';
    state.pendingActions.push({
      id: actionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: { needKey: 'hunger' },
      targetEmployeeId: employee.id,
      status: 'in_progress',
      holderId: employee.id,
    });
    state.ghostPreviews.push({ id: actionId, type: 'rest', targetX: 5, targetZ: 5, targetY: 0, claimed: true });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    tickGeneralRestCompletion(state);

    expect(state.pendingActions.find(a => a.id === actionId)).toBeUndefined();
    expect(state.ghostPreviews.find(g => g.id === actionId)).toBeUndefined();
  });
});
