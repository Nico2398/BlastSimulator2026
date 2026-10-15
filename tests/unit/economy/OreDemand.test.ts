// BlastSimulator2026 — Unit tests: ore demand haul urgency (#1817)
import { describe, it, expect } from 'vitest';
import { oreHaulUrgency, fragmentHaulUrgency } from '../../../src/core/economy/OreDemand.js';
import type { Contract, ContractType } from '../../../src/core/economy/Contract.js';

let nextId = 1;
function contract(type: ContractType, materialId: string, quantityKg: number, extra: Partial<Contract> = {}): Contract {
  return {
    id: nextId++, type, materialId, description: '', quantityKg, deliveredKg: 0, pricePerKg: 10,
    deadlineTicks: 5000, acceptedAtTick: 0, penaltyAmount: 0, earlyBonus: 0, completed: false, expired: false,
    ...extra,
  };
}

describe('oreHaulUrgency (#1817)', () => {
  it('is 0 for an ore whose stock covers the open offer', () => {
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], [], { rustite: 1000 });
    expect(u.get('rustite') ?? 0).toBe(0);
  });

  it('is 1 for an ore with an open offer and no stock', () => {
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], [], {});
    expect(u.get('rustite')).toBe(1);
  });

  it('is 1 - stock/need when stock covers part of the offer', () => {
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], [], { rustite: 250 });
    expect(u.get('rustite')).toBeCloseTo(0.75, 10);
  });

  it('uses the smallest open offer as the need', () => {
    const u = oreHaulUrgency(
      [contract('ore_sale', 'rustite', 4000), contract('ore_sale', 'rustite', 1000)], [], { rustite: 500 },
    );
    expect(u.get('rustite')).toBeCloseTo(0.5, 10);
  });

  it('has no urgency for an ore with no open offer, however empty its stock', () => {
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], [], {});
    expect(u.get('dirtite') ?? 0).toBe(0);
  });

  it('scores each ore on its own stock', () => {
    const u = oreHaulUrgency(
      [contract('ore_sale', 'rustite', 1000), contract('ore_sale', 'dirtite', 1000)], [], { dirtite: 800 },
    );
    expect(u.get('rustite')).toBe(1);
    expect(u.get('dirtite')).toBeCloseTo(0.2, 10);
  });

  it('ignores rubble_disposal offers', () => {
    const u = oreHaulUrgency([contract('rubble_disposal', '', 1000), contract('rubble_disposal', 'rustite', 1000)], [], {});
    expect(u.get('rustite') ?? 0).toBe(0);
    expect(u.get('') ?? 0).toBe(0);
  });

  it('adds the remaining kg of an active ore_sale to the need', () => {
    const active = [contract('ore_sale', 'rustite', 500, { deliveredKg: 200, acceptedAtTick: 10 })];
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], active, { rustite: 650 });
    // need = 1000 + 300 = 1300
    expect(u.get('rustite')).toBeCloseTo(1 - 650 / 1300, 10);
  });

  it('adds the remaining kg of an active supply contract to the need', () => {
    const active = [contract('supply', 'rustite', 1000, { deliveredKg: 0, acceptedAtTick: 10 })];
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], active, { rustite: 1000 });
    expect(u.get('rustite')).toBeCloseTo(0.5, 10);
  });

  it('ignores a held active contract', () => {
    const active = [contract('ore_sale', 'rustite', 1000, { held: true, acceptedAtTick: 10 })];
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], active, { rustite: 1000 });
    expect(u.get('rustite') ?? 0).toBe(0);
  });

  it('ignores a rubble_disposal active contract', () => {
    const active = [contract('rubble_disposal', 'rustite', 1000, { acceptedAtTick: 10 })];
    const u = oreHaulUrgency([contract('ore_sale', 'rustite', 1000)], active, { rustite: 1000 });
    expect(u.get('rustite') ?? 0).toBe(0);
  });

  it('is empty on an empty board', () => {
    expect(oreHaulUrgency([], [], { rustite: 5 }).size).toBe(0);
  });
});

describe('fragmentHaulUrgency (#1817)', () => {
  const urgency = new Map([['rustite', 0.8], ['dirtite', 0.3]]);

  it('is the highest urgency among the ores the fragment carries', () => {
    expect(fragmentHaulUrgency({ dirtite: 0.2, rustite: 0.1 }, urgency)).toBeCloseTo(0.8, 10);
  });

  it('counts only ores with density above zero', () => {
    expect(fragmentHaulUrgency({ dirtite: 0.2, rustite: 0 }, urgency)).toBeCloseTo(0.3, 10);
  });

  it('is 0 for a barren fragment', () => {
    expect(fragmentHaulUrgency({}, urgency)).toBe(0);
  });

  it('is 0 for an ore with no urgency entry', () => {
    expect(fragmentHaulUrgency({ blingite: 0.5 }, urgency)).toBe(0);
  });
});
