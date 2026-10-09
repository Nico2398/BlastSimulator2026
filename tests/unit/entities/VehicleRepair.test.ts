// BlastSimulator2026 — Tests for VehicleRepair.ts (issue #1393)
//
// Pure rules for repairing a damaged vehicle: who is repairable, the per-tick
// hp pacing and the parts bill. Red phase: the module is a stub.

import { describe, it, expect } from 'vitest';
import { isRepairable, repairHpThisTick, repairPartsCost } from '../../../src/core/entities/VehicleRepair.js';
import { getVehicleDefByTier, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { REPAIR_PARTS_COST_PER_HP } from '../../../src/core/config/balance.js';

const MAX_HP = getVehicleDefByTier('debris_hauler', 1).maxHp;

function makeVehicle(hp: number, overrides: Partial<Vehicle> = {}): Vehicle {
  return { id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp, cargo: [], occupantIds: [], ...overrides };
}

describe('isRepairable', () => {
  it('is true for a damaged vehicle (0 < hp < maxHp)', () => {
    expect(isRepairable(makeVehicle(MAX_HP / 2))).toBe(true);
  });

  it('is true one hp below max and one hp above zero (boundaries)', () => {
    expect(isRepairable(makeVehicle(MAX_HP - 1))).toBe(true);
    expect(isRepairable(makeVehicle(1))).toBe(true);
  });

  it('is false for a healthy vehicle (hp === maxHp)', () => {
    expect(isRepairable(makeVehicle(MAX_HP))).toBe(false);
  });

  it('is false for a wrecked vehicle (hp <= 0)', () => {
    expect(isRepairable(makeVehicle(0))).toBe(false);
    expect(isRepairable(makeVehicle(-5))).toBe(false);
  });

  it('uses the vehicle tier max hp, not the tier-1 one', () => {
    const t3Max = getVehicleDefByTier('debris_hauler', 3).maxHp;
    expect(t3Max).toBeGreaterThan(MAX_HP);
    expect(isRepairable(makeVehicle(MAX_HP, { tier: 3 }))).toBe(true);
    expect(isRepairable(makeVehicle(t3Max, { tier: 3 }))).toBe(false);
  });
});

describe('repairHpThisTick', () => {
  it('restores a positive amount on a damaged vehicle', () => {
    expect(repairHpThisTick(makeVehicle(MAX_HP / 2), 10)).toBeGreaterThan(0);
  });

  it('never restores more than the missing hp', () => {
    const v = makeVehicle(MAX_HP - 1);
    for (const ticks of [1, 2, 5, 50]) {
      expect(repairHpThisTick(v, ticks)).toBeLessThanOrEqual(1);
    }
  });

  it('restores everything still missing on the last tick', () => {
    const v = makeVehicle(MAX_HP / 4);
    expect(repairHpThisTick(v, 1)).toBeCloseTo(MAX_HP - v.hp, 6);
  });

  it('restores nothing on a healthy vehicle', () => {
    expect(repairHpThisTick(makeVehicle(MAX_HP), 5)).toBe(0);
  });

  it('applying it each tick as ticksRemaining counts down ends exactly at maxHp', () => {
    const v = makeVehicle(MAX_HP / 3);
    const total = 12;
    for (let remaining = total; remaining >= 1; remaining--) {
      v.hp = Math.min(MAX_HP, v.hp + repairHpThisTick(v, remaining));
    }
    expect(v.hp).toBeCloseTo(MAX_HP, 6);
  });

  it('a shorter remaining time restores at least as much per tick as a longer one', () => {
    const v = makeVehicle(MAX_HP / 2);
    expect(repairHpThisTick(v, 4)).toBeGreaterThanOrEqual(repairHpThisTick(v, 40));
  });
});

describe('repairPartsCost', () => {
  it('charges REPAIR_PARTS_COST_PER_HP per hp restored', () => {
    expect(repairPartsCost(1)).toBe(REPAIR_PARTS_COST_PER_HP);
    expect(repairPartsCost(10)).toBe(10 * REPAIR_PARTS_COST_PER_HP);
  });

  it('is zero for zero hp', () => {
    expect(repairPartsCost(0)).toBe(0);
  });

  it('is linear: cost(a + b) === cost(a) + cost(b)', () => {
    expect(repairPartsCost(7 + 13)).toBeCloseTo(repairPartsCost(7) + repairPartsCost(13), 6);
  });

  it('scales to a full-vehicle repair', () => {
    expect(repairPartsCost(MAX_HP)).toBeCloseTo(MAX_HP * REPAIR_PARTS_COST_PER_HP, 6);
  });
});
