// BlastSimulator2026 — Unit tests: a charge order is not claimable until its explosives arrive (#1895)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { isHoleOrderClaimable } from '../../../src/core/engine/ActionSelection.js';

function chargeAction(payload: Record<string, unknown>): PendingAction {
  return {
    id: 1, type: 'charge_hole', requiredSkill: 'blasting', requiredVehicleRole: 'charging_truck',
    targetX: 5, targetZ: 5, targetY: 0, payload, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
  } as PendingAction;
}

function stateAt(tick: number): GameState {
  const state = createGame({ seed: 42, startingCash: 10_000 });
  state.tickCount = tick;
  return state;
}

describe('isHoleOrderClaimable delivery gate (#1895)', () => {
  it('is false before the arrival tick', () => {
    expect(isHoleOrderClaimable(stateAt(399), chargeAction({ holeId: 'H1', deliveryArrivalTick: 400 }))).toBe(false);
  });

  it('is true at the arrival tick', () => {
    expect(isHoleOrderClaimable(stateAt(400), chargeAction({ holeId: 'H1', deliveryArrivalTick: 400 }))).toBe(true);
  });

  it('is true after the arrival tick', () => {
    expect(isHoleOrderClaimable(stateAt(900), chargeAction({ holeId: 'H1', deliveryArrivalTick: 400 }))).toBe(true);
  });

  it('is true at once with no arrival stamp', () => {
    expect(isHoleOrderClaimable(stateAt(0), chargeAction({ holeId: 'H1' }))).toBe(true);
  });

  it('old actions without the field stay claimable', () => {
    expect(isHoleOrderClaimable(stateAt(0), chargeAction({}))).toBe(true);
  });

  it('is false while in transit even without a holeId', () => {
    expect(isHoleOrderClaimable(stateAt(5), chargeAction({ deliveryArrivalTick: 400 }))).toBe(false);
  });
});
