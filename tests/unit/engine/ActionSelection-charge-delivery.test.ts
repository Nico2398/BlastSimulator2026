// BlastSimulator2026 — Unit tests: a charge order is claimable once its hole is drilled and its cash part is covered (#2143, was the #1895 delivery gate)

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

function stateAt(tick: number, cash = 10_000): GameState {
  const state = createGame({ seed: 42, startingCash: cash });
  state.cash = cash;
  state.tickCount = tick;
  return state;
}

const PAYLOAD = { holeId: 'H1', explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };

describe('isHoleOrderClaimable without a delivery gate (#2143)', () => {
  it('is true at tick 0 on an empty warehouse', () => {
    expect(isHoleOrderClaimable(stateAt(0), chargeAction(PAYLOAD))).toBe(true);
  });

  it('ignores a leftover deliveryArrivalTick stamp in the payload', () => {
    expect(isHoleOrderClaimable(stateAt(5), chargeAction({ ...PAYLOAD, deliveryArrivalTick: 400 }))).toBe(true);
  });

  it('is true at any later tick', () => {
    expect(isHoleOrderClaimable(stateAt(900), chargeAction(PAYLOAD))).toBe(true);
  });

  it('is false when the cash part of the load exceeds cash', () => {
    expect(isHoleOrderClaimable(stateAt(0, 59), chargeAction(PAYLOAD))).toBe(false);
  });

  it('is true when cash equals the cost exactly (boundary)', () => {
    expect(isHoleOrderClaimable(stateAt(0, 60), chargeAction(PAYLOAD))).toBe(true);
  });

  it('is false while the hole is still waiting to be drilled, whatever the cash', () => {
    const state = stateAt(0);
    state.plannedDrillHoles.push({ id: 'H1', x: 5, z: 5, depth: 8, diameter: 0.089 } as GameState['plannedDrillHoles'][number]);
    expect(isHoleOrderClaimable(state, chargeAction(PAYLOAD))).toBe(false);
  });
});
