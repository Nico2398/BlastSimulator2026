// BlastSimulator2026 — automatic delivery of stored ore to active contracts (#1367)

import { describe, it, expect } from 'vitest';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { createLogisticsState, type LogisticsState } from '../../../src/core/economy/Logistics.js';
import {
  createContractState,
  type Contract,
  type ContractState,
} from '../../../src/core/economy/Contract.js';
import {
  autoDeliverContracts,
  deliverStoredOre,
} from '../../../src/core/economy/ContractFulfilment.js';

/** Ore kg of a stored fragment = volume x density x 2500, so kg/2500 volume at density 1 gives `kg`. */
function oreFragment(id: number, kg: number, material = 'blingite'): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: kg / 2500,
    mass: kg * 5,
    rockId: 'sandite',
    oreDensities: { [material]: 1.0 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
    shapeSeed: id,
    origin: { x: 0, y: 0, z: 0 },
  };
}

interface Stock {
  logistics: LogisticsState;
  collectedOre: Record<string, number>;
}

function stockWith(kg: number, material = 'blingite'): Stock {
  const logistics = createLogisticsState(1_000_000);
  const collectedOre: Record<string, number> = {};
  if (kg > 0) {
    const f = oreFragment(1, kg, material);
    logistics.fragments.push({ fragment: f, state: 'stored', vehicleId: null, warehouseId: null });
    logistics.storedMassKg += f.mass;
    collectedOre[material] = kg;
  }
  return { logistics, collectedOre };
}

function contract(overrides: Partial<Contract>): Contract {
  return {
    id: 1, type: 'ore_sale', materialId: 'blingite', description: 'fixture',
    quantityKg: 100, deliveredKg: 0, pricePerKg: 10, deadlineTicks: 500, acceptedAtTick: 0,
    penaltyAmount: 300, earlyBonus: 150, completed: false, expired: false,
    ...overrides,
  };
}

function stateWith(...active: Contract[]): ContractState {
  const s = createContractState();
  s.active.push(...active);
  return s;
}

describe('deliverStoredOre', () => {
  it('delivers the requested kg, draws storage down and reports the payment', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(300);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 60, 10, []);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.kg).toBe(60);
    expect(r.data.payment).toBe(600);
    expect(r.data.bonus).toBe(0);
    expect(r.data.completed).toBe(false);
    expect(contracts.active[0]!.deliveredKg).toBe(60);
    expect(collectedOre['blingite']).toBeCloseTo(240, 6);
  });

  it('records the payment on the contract as paidTotal', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(300);
    deliverStoredOre(contracts, logistics, collectedOre, 1, 40, 10, []);
    deliverStoredOre(contracts, logistics, collectedOre, 1, 25, 11, []);
    expect(contracts.active[0]!.paidTotal).toBeCloseTo(650, 6);
  });

  it('completes the contract and adds the early bonus when finished before 50% of the deadline', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(300);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 100, 10, []);
    expect(r.success && r.data.completed).toBe(true);
    expect(r.success && r.data.bonus).toBe(150);
    expect(contracts.active).toHaveLength(0);
    expect(contracts.completedHistory[0]!.id).toBe(1);
  });

  it('pays no bonus when completed after 50% of the deadline', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(300);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 100, 250, []);
    expect(r.success && r.data.completed).toBe(true);
    expect(r.success && r.data.bonus).toBe(0);
  });

  it('caps the request at what the contract still needs', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(300);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 1000, 10, []);
    expect(r.success && r.data.kg).toBe(100);
    expect(collectedOre['blingite']).toBeCloseTo(200, 6);
  });

  it('caps the request at what storage holds (partial delivery)', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(30);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 100, 10, []);
    expect(r.success && r.data.kg).toBeCloseTo(30, 6);
    expect(contracts.active[0]!.deliveredKg).toBeCloseTo(30, 6);
    expect(contracts.active[0]!.completed).toBe(false);
  });

  it('rubble_disposal draws raw stored mass', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const { logistics, collectedOre } = stockWith(100); // 500 kg mass
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 200, 10, []);
    expect(r.success && r.data.kg).toBeCloseTo(200, 6);
    expect(r.success && r.data.payment).toBeCloseTo(400, 6);
  });

  it('fails for an unknown contract id and leaves storage alone', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(100);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 99, 10, 10, []);
    expect(r.success).toBe(false);
    expect(collectedOre['blingite']).toBe(100);
  });

  it('fails when storage holds none of the material', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(0);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 50, 10, []);
    expect(r.success).toBe(false);
    expect(contracts.active[0]!.deliveredKg).toBe(0);
  });

  it('fails for a non-positive request', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(100);
    expect(deliverStoredOre(contracts, logistics, collectedOre, 1, 0, 10, []).success).toBe(false);
    expect(deliverStoredOre(contracts, logistics, collectedOre, 1, -5, 10, []).success).toBe(false);
  });
});

describe('autoDeliverContracts', () => {
  it('delivers a matching ore_sale contract in full and tags the result with its id', () => {
    const contracts = stateWith(contract({ id: 4 }));
    const { logistics, collectedOre } = stockWith(100);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ contractId: 4, payment: 1000, bonus: 150, completed: true });
    expect(out[0]!.kg).toBeCloseTo(100, 6);
  });

  it('serves the nearest deadline first when stock is short', () => {
    const late = contract({ id: 1, deadlineTicks: 500 });
    const soon = contract({ id: 2, deadlineTicks: 300 });
    const contracts = stateWith(late, soon);
    const { logistics, collectedOre } = stockWith(100);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);
    expect(out.map(o => o.contractId)).toEqual([2]);
    expect(soon.completed).toBe(true);
    expect(late.deliveredKg).toBe(0);
  });

  it('breaks a deadline tie with the lowest id', () => {
    const a = contract({ id: 8 });
    const b = contract({ id: 3 });
    const contracts = stateWith(a, b);
    const { logistics, collectedOre } = stockWith(100);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);
    expect(out.map(o => o.contractId)).toEqual([3]);
  });

  it('spills leftover stock to the next contract in deadline order', () => {
    const first = contract({ id: 1, quantityKg: 60, deadlineTicks: 100 });
    const second = contract({ id: 2, quantityKg: 100, deadlineTicks: 200 });
    const contracts = stateWith(second, first);
    const { logistics, collectedOre } = stockWith(100);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);
    expect(out.map(o => o.contractId)).toEqual([1, 2]);
    expect(out[0]!.completed).toBe(true);
    expect(out[1]!.kg).toBeCloseTo(40, 6);
    expect(second.completed).toBe(false);
    expect(second.deliveredKg).toBeCloseTo(40, 6);
  });

  it('delivers partially and keeps the contract active when stock is short', () => {
    const c = contract({});
    const contracts = stateWith(c);
    const { logistics, collectedOre } = stockWith(40);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.completed).toBe(false);
    expect(out[0]!.kg).toBeCloseTo(40, 6);
    expect(contracts.active).toHaveLength(1);
  });

  it('skips a held contract', () => {
    const c = contract({ held: true });
    const contracts = stateWith(c);
    const { logistics, collectedOre } = stockWith(100);
    expect(autoDeliverContracts(contracts, logistics, collectedOre, 5, [])).toEqual([]);
    expect(c.deliveredKg).toBe(0);
    expect(collectedOre['blingite']).toBe(100);
  });

  it('delivers to an unheld contract while skipping a held one of the same ore', () => {
    const held = contract({ id: 1, held: true, deadlineTicks: 100 });
    const free = contract({ id: 2, deadlineTicks: 400 });
    const contracts = stateWith(held, free);
    const { logistics, collectedOre } = stockWith(100);
    expect(autoDeliverContracts(contracts, logistics, collectedOre, 5, []).map(o => o.contractId)).toEqual([2]);
  });

  it('delivers supply contracts', () => {
    const contracts = stateWith(contract({ type: 'supply', quantityKg: 50 }));
    const { logistics, collectedOre } = stockWith(100);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.completed).toBe(true);
  });

  it('delivers rubble_disposal contracts from raw stored mass', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const { logistics, collectedOre } = stockWith(100);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.payment).toBeCloseTo(400, 6);
  });

  it('does nothing when storage is empty', () => {
    const contracts = stateWith(contract({}));
    const { logistics, collectedOre } = stockWith(0);
    expect(autoDeliverContracts(contracts, logistics, collectedOre, 5, [])).toEqual([]);
    expect(contracts.active[0]!.deliveredKg).toBe(0);
  });

  it('does nothing when only another ore is stored', () => {
    const contracts = stateWith(contract({ materialId: 'blingite' }));
    const { logistics, collectedOre } = stockWith(100, 'dirtite');
    expect(autoDeliverContracts(contracts, logistics, collectedOre, 5, [])).toEqual([]);
  });

  it('does nothing without active contracts', () => {
    const { logistics, collectedOre } = stockWith(100);
    expect(autoDeliverContracts(createContractState(), logistics, collectedOre, 5, [])).toEqual([]);
  });
});

// ── ore sale keeps the other ores of shared fragments (#1371) ────────────────

/** One mixed fragment (400kg rustite + 400kg dirtite) and a pure dirtite one (400kg). */
function mixedStock(): Stock {
  const logistics = createLogisticsState(1_000_000);
  const mixed: FragmentData = { ...oreFragment(1, 800), oreDensities: { rustite: 0.5, dirtite: 0.5 }, volume: 0.32, mass: 1000 };
  const pure: FragmentData = { ...oreFragment(2, 400, 'dirtite'), mass: 500 };
  for (const f of [mixed, pure]) {
    logistics.fragments.push({ fragment: f, state: 'stored', vehicleId: null, warehouseId: null });
    logistics.storedMassKg += f.mass;
  }
  return { logistics, collectedOre: { rustite: 400, dirtite: 800 } };
}

describe('mixed fragments shared by several contracts (#1371)', () => {
  it('a second contract for the other ore is fully delivered after a mixed sale', () => {
    const contracts = stateWith(
      contract({ id: 1, materialId: 'rustite', quantityKg: 400 }),
      contract({ id: 2, materialId: 'dirtite', quantityKg: 800 }),
    );
    const { logistics, collectedOre } = mixedStock();

    const first = deliverStoredOre(contracts, logistics, collectedOre, 1, 400, 10, []);
    expect(first.success).toBe(true);
    const second = deliverStoredOre(contracts, logistics, collectedOre, 2, 800, 10, []);

    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.kg).toBeCloseTo(800, 6);
    expect(second.data.completed).toBe(true);
    expect(collectedOre['dirtite']).toBeCloseTo(0, 6);
  });

  it('autoDeliverContracts completes two ore contracts that share fragments', () => {
    const contracts = stateWith(
      contract({ id: 1, materialId: 'rustite', quantityKg: 400, deadlineTicks: 100 }),
      contract({ id: 2, materialId: 'dirtite', quantityKg: 800, deadlineTicks: 200 }),
    );
    const { logistics, collectedOre } = mixedStock();

    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, []);

    expect(out.map(o => o.contractId).sort()).toEqual([1, 2]);
    expect(out.find(o => o.contractId === 1)!.kg).toBeCloseTo(400, 6);
    expect(out.find(o => o.contractId === 2)!.kg).toBeCloseTo(800, 6);
    expect(out.every(o => o.completed)).toBe(true);
    expect(contracts.active).toHaveLength(0);
  });
});
