// BlastSimulator2026 — automatic delivery of stored ore to active contracts (#1367)

import { describe, it, expect } from 'vitest';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { createLogisticsState, type LogisticsState } from '../../../src/core/economy/Logistics.js';
import {
  checkDeadlines,
  createContractState,
  type Contract,
  type ContractState,
} from '../../../src/core/economy/Contract.js';
import {
  autoDeliverContracts,
  deliverStoredOre,
  bookDeliveryCashflow,
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

/** Add a barren stored fragment (no ore) of `mass` kg to `stock`. */
function addBarren(stock: Stock, id: number, mass: number): void {
  const f: FragmentData = { ...oreFragment(id, 1), volume: mass / 2500, mass, oreDensities: {} };
  stock.logistics.fragments.push({ fragment: f, state: 'stored', vehicleId: null, warehouseId: null });
  stock.logistics.storedMassKg += mass;
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

  it('rubble_disposal draws barren stored mass, never ore-bearing (#1871)', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const stock = stockWith(100); // 500 kg of ore-bearing mass
    addBarren(stock, 2, 250);
    const { logistics, collectedOre } = stock;
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 200, 10, []);
    expect(r.success && r.data.kg).toBeCloseTo(200, 6);
    expect(r.success && r.data.payment).toBeCloseTo(400, 6);
    expect(collectedOre['blingite']).toBe(100);
    expect(logistics.fragments.find(f => f.fragment.id === 1)!.fragment.mass).toBe(500);
  });

  it('rubble_disposal on ore-only stock delivers nothing and leaves the ore ledger alone (#1871)', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const { logistics, collectedOre } = stockWith(100);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 200, 10, []);
    expect(r.success).toBe(false);
    expect(contracts.active[0]!.deliveredKg).toBe(0);
    expect(collectedOre['blingite']).toBe(100);
    expect(logistics.storedMassKg).toBe(500);
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

  it('delivers rubble_disposal contracts from barren stored mass and spoil heap only (#1871)', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const stock = stockWith(100); // 500 kg ore-bearing, off limits
    addBarren(stock, 2, 120);
    const { logistics, collectedOre } = stock;
    const heap = { type: 'spoil_heap' as const, tier: 1 as const, storedSpoilKg: 100 };
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 5, [heap]);
    expect(out).toHaveLength(1);
    expect(out[0]!.payment).toBeCloseTo(400, 6);
    expect(heap.storedSpoilKg).toBe(0);
    expect(logistics.fragments.find(f => f.fragment.id === 2)!.fragment.mass).toBe(20);
    expect(collectedOre['blingite']).toBe(100);
    expect(logistics.fragments.find(f => f.fragment.id === 1)!.fragment.mass).toBe(500);
  });

  it('delivers rubble_disposal partially up to the barren stock (#1871)', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const stock = stockWith(100);
    addBarren(stock, 2, 60);
    const out = autoDeliverContracts(contracts, stock.logistics, stock.collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.completed).toBe(false);
    expect(contracts.active[0]!.deliveredKg).toBeCloseTo(60, 6);
    expect(out[0]!.payment).toBeCloseTo(120, 6);
    expect(stock.collectedOre['blingite']).toBe(100);
  });

  it('does not deliver rubble_disposal from ore-bearing stock alone (#1871)', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const { logistics, collectedOre } = stockWith(100);
    expect(autoDeliverContracts(contracts, logistics, collectedOre, 5, [])).toEqual([]);
    expect(contracts.active[0]!.deliveredKg).toBe(0);
    expect(collectedOre['blingite']).toBe(100);
    expect(logistics.storedMassKg).toBe(500);
  });

  it('ore_sale still delivers while barren rock sits beside the ore (#1871)', () => {
    const contracts = stateWith(contract({ quantityKg: 50 }));
    const stock = stockWith(100);
    addBarren(stock, 2, 300);
    const out = autoDeliverContracts(contracts, stock.logistics, stock.collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.completed).toBe(true);
    expect(stock.collectedOre['blingite']).toBeCloseTo(50, 6);
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

describe('paid clearances (#1892)', () => {
  const paidRubble = () => contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 0.5, playerPays: true, penaltyAmount: 0, earlyBonus: 0 });

  it('deliverStoredOre marks the outcome as a fee for a paid clearance', () => {
    const contracts = stateWith(paidRubble());
    const stock = stockWith(0);
    addBarren(stock, 2, 300);
    const r = deliverStoredOre(contracts, stock.logistics, stock.collectedOre, 1, 200, 10, []);
    expect(r.success && r.data.fee).toBe(true);
    expect(r.success && r.data.payment).toBeCloseTo(100, 6);
  });

  it('deliverStoredOre marks a cheap clearance and an ore sale as income, not fee', () => {
    const cheap = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2 }));
    const stock = stockWith(0);
    addBarren(stock, 2, 300);
    const r = deliverStoredOre(cheap, stock.logistics, stock.collectedOre, 1, 200, 10, []);
    expect(r.success && r.data.fee).toBe(false);
    const sale = stateWith(contract({ quantityKg: 50 }));
    const s2 = stockWith(100);
    const r2 = deliverStoredOre(sale, s2.logistics, s2.collectedOre, 1, 50, 10, []);
    expect(r2.success && r2.data.fee).toBe(false);
  });

  it('autoDeliverContracts reports the fee flag of a paid clearance', () => {
    const contracts = stateWith(paidRubble());
    const stock = stockWith(0);
    addBarren(stock, 2, 80);
    const out = autoDeliverContracts(contracts, stock.logistics, stock.collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.fee).toBe(true);
  });

  it('a rubble contract with too little rubble delivers what exists and never fines', () => {
    const contracts = stateWith(contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2, deadlineTicks: 10, penaltyAmount: 0 }));
    const stock = stockWith(0);
    addBarren(stock, 2, 60);
    autoDeliverContracts(contracts, stock.logistics, stock.collectedOre, 5, []);
    const [expired] = checkDeadlines(contracts, 1_000);
    expect(expired!.penalty).toBe(0);
  });
});

describe('bookDeliveryCashflow (#1892)', () => {
  const account = () => ({ cash: 1_000, finances: createFinanceState(1_000) });

  it('credits income for a paying delivery: payment, then early bonus', () => {
    const a = account();
    bookDeliveryCashflow(a, 1, { payment: 50, bonus: 10, fee: false }, 7);
    expect(a.cash).toBe(1_060);
    expect(a.finances.cash).toBe(1_060);
    expect(a.finances.transactions.every(tx => tx.type === 'income')).toBe(true);
    expect(a.finances.transactions.map(tx => tx.amount)).toEqual([50, 10]);
  });

  it('debits cash and logs one expense for a fee', () => {
    const a = account();
    bookDeliveryCashflow(a, 3, { payment: 120, bonus: 0, fee: true }, 9);
    expect(a.cash).toBe(880);
    expect(a.finances.cash).toBe(880);
    expect(a.finances.transactions).toHaveLength(1);
    expect(a.finances.transactions[0]).toMatchObject({ type: 'expense', amount: 120, tick: 9 });
  });

  it('a fee never credits a bonus', () => {
    const a = account();
    bookDeliveryCashflow(a, 3, { payment: 100, bonus: 40, fee: true }, 9);
    expect(a.cash).toBe(900);
    expect(a.finances.transactions.some(tx => tx.type === 'income')).toBe(false);
  });

  it('a zero fee changes nothing', () => {
    const a = account();
    bookDeliveryCashflow(a, 3, { payment: 0, bonus: 0, fee: true }, 9);
    expect(a.cash).toBe(1_000);
    expect(a.finances.transactions).toEqual([]);
  });
});

// ── settleDelivery: ore saturation (#1930) ──────────────────────────────────

import { createGame } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { settleDelivery, type AutoDelivery } from '../../../src/core/economy/ContractFulfilment.js';
import { saturationAt } from '../../../src/core/economy/OreSaturation.js';

function delivery(overrides: Partial<AutoDelivery> = {}): AutoDelivery {
  return {
    contractId: 1, kg: 10_000, materialId: 'dirtite', contractType: 'ore_sale',
    payment: 100, bonus: 0, completed: false, fee: false, ...overrides,
  };
}

function progressionGame() {
  const state = createGame({ seed: 42 });
  state.grade = createGradeState();
  return state;
}

function glutEvents(emitter: EventEmitter): { oreId: string; saturation: number }[] {
  const seen: { oreId: string; saturation: number }[] = [];
  emitter.on('progression:ore_glut', p => seen.push(p));
  return seen;
}

describe('deliverStoredOre carries the material (#1930)', () => {
  it('reports the ore delivered', () => {
    const contracts = stateWith(contract({ materialId: 'blingite' }));
    const { logistics, collectedOre } = stockWith(300);
    const r = deliverStoredOre(contracts, logistics, collectedOre, 1, 50, 10, []);
    expect(r.success && r.data.materialId).toBe('blingite');
  });

  it('autoDeliverContracts tags each delivery with its material', () => {
    const contracts = stateWith(contract({ materialId: 'blingite' }));
    const { logistics, collectedOre } = stockWith(300);
    const out = autoDeliverContracts(contracts, logistics, collectedOre, 10, []);
    expect(out[0]!.materialId).toBe('blingite');
  });
});

describe('settleDelivery saturation (#1930)', () => {
  it('records an ore_sale delivery, creating the state lazily', () => {
    const state = progressionGame();
    expect(state.saturation).toBeUndefined();
    settleDelivery(state, delivery(), 40);
    expect(saturationAt(state.saturation!['dirtite'], 40)).toBeCloseTo(0.5, 9);
  });

  it('records a supply delivery', () => {
    const state = progressionGame();
    settleDelivery(state, delivery({ contractType: 'supply', kg: 4_000 }), 5);
    expect(saturationAt(state.saturation!['dirtite'], 5)).toBeCloseTo(0.2, 9);
  });

  it('ignores rubble disposal', () => {
    const state = progressionGame();
    settleDelivery(state, delivery({ contractType: 'rubble_disposal', materialId: '', kg: 50_000 }), 5);
    expect(state.saturation).toBeUndefined();
  });

  it('records nothing without a grade state (non-progression site)', () => {
    const state = createGame({ seed: 42 });
    settleDelivery(state, delivery(), 5);
    expect(state.saturation).toBeUndefined();
  });

  it('uses the grade for market depth', () => {
    const state = progressionGame();
    state.grade!.grade = 1;
    settleDelivery(state, delivery(), 0);
    expect(state.saturation!['dirtite']!.level).toBeCloseTo(0.25, 9);
  });

  it('still books cashflow and ore counters', () => {
    const state = progressionGame();
    const cash = state.cash;
    settleDelivery(state, delivery({ payment: 250 }), 5);
    expect(state.cash).toBe(cash + 250);
    expect(state.grade!.oreDeliveredKg).toBe(10_000);
  });

  it('emits progression:ore_glut once when crossing 50%', () => {
    const state = progressionGame();
    const emitter = new EventEmitter();
    const seen = glutEvents(emitter);
    settleDelivery(state, delivery({ kg: 8_000 }), 0, emitter);
    expect(seen).toHaveLength(0);
    settleDelivery(state, delivery({ kg: 4_000 }), 0, emitter);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.oreId).toBe('dirtite');
    expect(seen[0]!.saturation).toBeCloseTo(0.6, 9);
    settleDelivery(state, delivery({ kg: 1_000 }), 0, emitter);
    expect(seen).toHaveLength(1);
  });

  it('emits nothing on a non-progression site or for rubble', () => {
    const emitter = new EventEmitter();
    const seen = glutEvents(emitter);
    settleDelivery(createGame({ seed: 42 }), delivery({ kg: 50_000 }), 0, emitter);
    settleDelivery(progressionGame(), delivery({ contractType: 'rubble_disposal', materialId: '', kg: 50_000 }), 0, emitter);
    expect(seen).toHaveLength(0);
  });

  it('works without an emitter', () => {
    const state = progressionGame();
    expect(() => settleDelivery(state, delivery({ kg: 50_000 }), 0)).not.toThrow();
  });
});

// ── Automatic ore sale and rubble clearance (#2145) ─────────────────────────

import {
  autoSellUnclaimedOre,
  autoAcceptRubbleClearances,
} from '../../../src/core/economy/ContractFulfilment.js';
import { AUTO_SALE_DWELL_TICKS, AUTO_SALE_PRICE_FACTOR } from '../../../src/core/config/balance.js';
import { oreValuePerKg } from '../../../src/core/economy/Market.js';
import { saturationFactor } from '../../../src/core/economy/OreSaturation.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { createBoardState } from '../../../src/core/economy/Board.js';

/** A game whose warehouse holds the given kg of each ore, as stored fragments plus the ledger. */
function gameWithOre(stock: Record<string, number>, opts: { grade?: boolean } = {}): GameState {
  const state = createGame({ seed: 42 });
  if (opts.grade) state.grade = createGradeState();
  state.logistics = createLogisticsState(1_000_000);
  state.collectedOre = {};
  let id = 1;
  for (const [ore, kg] of Object.entries(stock)) {
    if (!(kg > 0)) continue;
    const f = oreFragment(id++, kg, ore);
    state.logistics.fragments.push({ fragment: f, state: 'stored', vehicleId: null, warehouseId: null });
    state.logistics.storedMassKg += f.mass;
    state.collectedOre[ore] = kg;
  }
  return state;
}

/** Pretend the ore has already sat unclaimed since tick 0. */
function dwelled(state: GameState, ...ores: string[]): GameState {
  state.contracts.autoSaleSince = Object.fromEntries(ores.map(o => [o, 0]));
  return state;
}

const DWELLED_TICK = AUTO_SALE_DWELL_TICKS + 1;
const autoSaleIncome = (state: GameState) =>
  state.finances.transactions.filter(tx => tx.type === 'income' && tx.category === 'sales');

describe('autoSellUnclaimedOre: the sale (#2145)', () => {
  it('sells unclaimed ore after the dwell at the discounted market price and books it', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }), 'blingite');
    const cash = state.cash;
    const sales = autoSellUnclaimedOre(state, DWELLED_TICK);
    const price = AUTO_SALE_PRICE_FACTOR * oreValuePerKg('blingite', state.contracts.market) * saturationFactor(0);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.oreId).toBe('blingite');
    expect(sales[0]!.kg).toBeCloseTo(300, 6);
    expect(sales[0]!.payment).toBeCloseTo(300 * price, 6);
    expect(state.cash).toBeCloseTo(cash + 300 * price, 6);
  });

  it('draws the ore out of storage', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }), 'blingite');
    autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(state.collectedOre['blingite'] ?? 0).toBeCloseTo(0, 6);
  });

  it('books one sales income transaction labelled "Auto sale: <oreId>"', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }), 'blingite');
    autoSellUnclaimedOre(state, DWELLED_TICK);
    const income = autoSaleIncome(state);
    expect(income).toHaveLength(1);
    expect(income[0]!.description).toBe('Auto sale: blingite');
    expect(income[0]!.amount).toBeCloseTo(300 * AUTO_SALE_PRICE_FACTOR * oreValuePerKg('blingite', state.contracts.market), 6);
  });

  it('sells every unclaimed ore separately, each at its own price', () => {
    const state = dwelled(gameWithOre({ blingite: 100, dirtite: 200 }), 'blingite', 'dirtite');
    const sales = autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(sales.map(s => s.oreId).sort()).toEqual(['blingite', 'dirtite']);
    const market = state.contracts.market;
    expect(sales.find(s => s.oreId === 'blingite')!.payment).toBeCloseTo(100 * AUTO_SALE_PRICE_FACTOR * oreValuePerKg('blingite', market), 6);
    expect(sales.find(s => s.oreId === 'dirtite')!.payment).toBeCloseTo(200 * AUTO_SALE_PRICE_FACTOR * oreValuePerKg('dirtite', market), 6);
    expect(autoSaleIncome(state).map(tx => tx.description).sort()).toEqual(['Auto sale: blingite', 'Auto sale: dirtite']);
  });

  it('cuts the price by the ore\'s current saturation', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }, { grade: true }), 'blingite');
    state.saturation = { blingite: { level: 0.8, tick: DWELLED_TICK } };
    const sales = autoSellUnclaimedOre(state, DWELLED_TICK);
    const price = AUTO_SALE_PRICE_FACTOR * oreValuePerKg('blingite', state.contracts.market) * saturationFactor(0.8);
    expect(sales[0]!.payment).toBeCloseTo(300 * price, 6);
  });

  it('sells nothing and returns an empty list when storage holds no ore', () => {
    const state = gameWithOre({});
    const cash = state.cash;
    expect(autoSellUnclaimedOre(state, DWELLED_TICK)).toEqual([]);
    expect(state.cash).toBe(cash);
    expect(state.finances.transactions).toEqual([]);
  });
});

describe('autoSellUnclaimedOre: claims (#2145)', () => {
  it('never sells ore an active contract claims in full', () => {
    const state = dwelled(gameWithOre({ blingite: 100 }), 'blingite');
    state.contracts.active.push(contract({ quantityKg: 100 }));
    const cash = state.cash;
    expect(autoSellUnclaimedOre(state, DWELLED_TICK)).toEqual([]);
    expect(state.cash).toBe(cash);
    expect(state.collectedOre['blingite']).toBeCloseTo(100, 6);
  });

  it('sells only the unclaimed remainder of part-claimed ore', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }), 'blingite');
    state.contracts.active.push(contract({ quantityKg: 100 }));
    const sales = autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.kg).toBeCloseTo(200, 6);
    expect(state.collectedOre['blingite']).toBeCloseTo(100, 6);
  });

  it('claims only what the contract still needs: delivered kg no longer claims stock', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }), 'blingite');
    state.contracts.active.push(contract({ quantityKg: 100, deliveredKg: 60 }));
    const sales = autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(sales[0]!.kg).toBeCloseTo(260, 6);
    expect(state.collectedOre['blingite']).toBeCloseTo(40, 6);
  });

  it('a held contract still claims its ore', () => {
    const state = dwelled(gameWithOre({ blingite: 100 }), 'blingite');
    state.contracts.active.push(contract({ quantityKg: 100, held: true }));
    expect(autoSellUnclaimedOre(state, DWELLED_TICK)).toEqual([]);
    expect(state.collectedOre['blingite']).toBeCloseTo(100, 6);
  });

  it('claims of several contracts for one ore add up', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }), 'blingite');
    state.contracts.active.push(contract({ id: 1, quantityKg: 100 }), contract({ id: 2, type: 'supply', quantityKg: 150 }));
    const sales = autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(sales[0]!.kg).toBeCloseTo(50, 6);
  });

  it('a claim larger than the stock sells nothing', () => {
    const state = dwelled(gameWithOre({ blingite: 100 }), 'blingite');
    state.contracts.active.push(contract({ quantityKg: 500 }));
    expect(autoSellUnclaimedOre(state, DWELLED_TICK)).toEqual([]);
  });

  it('a contract for another ore does not protect this one', () => {
    const state = dwelled(gameWithOre({ blingite: 100, dirtite: 100 }), 'blingite', 'dirtite');
    state.contracts.active.push(contract({ materialId: 'dirtite', quantityKg: 100 }));
    const sales = autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(sales.map(s => s.oreId)).toEqual(['blingite']);
    expect(state.collectedOre['dirtite']).toBeCloseTo(100, 6);
  });
});

describe('autoSellUnclaimedOre: dwell (#2145)', () => {
  it('records the tick an ore was first seen unclaimed, and sells nothing yet', () => {
    const state = gameWithOre({ blingite: 300 });
    expect(autoSellUnclaimedOre(state, 7)).toEqual([]);
    expect(state.contracts.autoSaleSince!['blingite']).toBe(7);
    expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
  });

  it('keeps the first-seen tick on later calls', () => {
    const state = gameWithOre({ blingite: 300 });
    autoSellUnclaimedOre(state, 7);
    autoSellUnclaimedOre(state, 9);
    expect(state.contracts.autoSaleSince!['blingite']).toBe(7);
  });

  it('sells nothing before the dwell has elapsed', () => {
    const state = gameWithOre({ blingite: 300 });
    autoSellUnclaimedOre(state, 100);
    const cash = state.cash;
    expect(autoSellUnclaimedOre(state, 100 + AUTO_SALE_DWELL_TICKS - 1)).toEqual([]);
    expect(state.cash).toBe(cash);
    expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
  });

  it('sells once the dwell has elapsed since the first sighting', () => {
    const state = gameWithOre({ blingite: 300 });
    autoSellUnclaimedOre(state, 100);
    const sales = autoSellUnclaimedOre(state, 100 + AUTO_SALE_DWELL_TICKS + 1);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.kg).toBeCloseTo(300, 6);
  });

  it('claiming all the stock resets the dwell', () => {
    const state = gameWithOre({ blingite: 100 });
    autoSellUnclaimedOre(state, 0);
    state.contracts.active.push(contract({ quantityKg: 100 }));
    expect(autoSellUnclaimedOre(state, 10)).toEqual([]);
    state.contracts.active.length = 0; // contract gone: the ore is unclaimed again, but its clock restarts
    expect(autoSellUnclaimedOre(state, 11)).toEqual([]);
    expect(autoSellUnclaimedOre(state, 11 + AUTO_SALE_DWELL_TICKS - 1)).toEqual([]);
    expect(autoSellUnclaimedOre(state, 11 + AUTO_SALE_DWELL_TICKS + 1)).toHaveLength(1);
  });

  it('an empty store resets the dwell', () => {
    const state = gameWithOre({ blingite: 100 });
    autoSellUnclaimedOre(state, 0);
    state.collectedOre['blingite'] = 0;
    state.logistics.fragments.length = 0;
    expect(autoSellUnclaimedOre(state, 10)).toEqual([]);
    const restocked = gameWithOre({ blingite: 100 });
    state.logistics = restocked.logistics;
    state.collectedOre = restocked.collectedOre;
    expect(autoSellUnclaimedOre(state, 11)).toEqual([]);
    expect(autoSellUnclaimedOre(state, 11 + AUTO_SALE_DWELL_TICKS - 1)).toEqual([]);
    expect(autoSellUnclaimedOre(state, 11 + AUTO_SALE_DWELL_TICKS + 1)).toHaveLength(1);
  });

  it('ores keep separate dwell clocks', () => {
    const state = gameWithOre({ blingite: 100 });
    autoSellUnclaimedOre(state, 0);
    const extra = gameWithOre({ dirtite: 50 });
    state.logistics.fragments.push(...extra.logistics.fragments);
    state.logistics.storedMassKg += extra.logistics.storedMassKg;
    state.collectedOre['dirtite'] = 50;
    autoSellUnclaimedOre(state, 15);
    const sales = autoSellUnclaimedOre(state, AUTO_SALE_DWELL_TICKS + 1);
    expect(sales.map(s => s.oreId)).toEqual(['blingite']);
    expect(state.collectedOre['dirtite']).toBeCloseTo(50, 6);
  });
});

describe('autoSellUnclaimedOre: saturation and grade (#2145)', () => {
  it('records the sale against the ore\'s market saturation', () => {
    const state = dwelled(gameWithOre({ dirtite: 10_000 }, { grade: true }), 'dirtite');
    expect(state.saturation).toBeUndefined();
    autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(saturationAt(state.saturation!['dirtite'], DWELLED_TICK)).toBeGreaterThan(0);
  });

  it('counts the kg toward mine grade ore delivered', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }, { grade: true }), 'blingite');
    autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(state.grade!.oreDeliveredKg).toBeCloseTo(300, 6);
  });

  it('counts the kg toward the board\'s ore tally', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }, { grade: true }), 'blingite');
    state.board = createBoardState({ quarterTicks: 1000, oreTargetT: 10, profitTarget: 1000 }, 0);
    autoSellUnclaimedOre(state, DWELLED_TICK);
    expect(state.board.oreDeliveredKg).toBeCloseTo(300, 6);
  });

  it('a second sale of the same ore pays less than the first', () => {
    const state = dwelled(gameWithOre({ dirtite: 10_000 }, { grade: true }), 'dirtite');
    const first = autoSellUnclaimedOre(state, DWELLED_TICK)[0]!;
    const more = gameWithOre({ dirtite: 10_000 });
    state.logistics = more.logistics;
    state.collectedOre = more.collectedOre;
    state.contracts.autoSaleSince = { dirtite: 0 };
    const second = autoSellUnclaimedOre(state, DWELLED_TICK)[0]!;
    expect(second.payment / second.kg).toBeLessThan(first.payment / first.kg);
  });
});

describe('autoSellUnclaimedOre: switch (#2145)', () => {
  it('sells nothing with autoSell false, however long the ore has waited', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }, { grade: true }), 'blingite');
    state.contracts.autoSell = false;
    const cash = state.cash;
    expect(autoSellUnclaimedOre(state, DWELLED_TICK + 1000)).toEqual([]);
    expect(state.cash).toBe(cash);
    expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
    expect(state.finances.transactions).toEqual([]);
    expect(state.saturation).toBeUndefined();
  });

  it('sells with autoSell explicitly true', () => {
    const state = dwelled(gameWithOre({ blingite: 300 }), 'blingite');
    state.contracts.autoSell = true;
    expect(autoSellUnclaimedOre(state, DWELLED_TICK)).toHaveLength(1);
  });
});

describe('autoAcceptRubbleClearances (#2145)', () => {
  const rubbleOffer = (overrides: Partial<Contract> = {}) =>
    contract({ type: 'rubble_disposal', materialId: '', quantityKg: 400, pricePerKg: 2, ...overrides });
  const board = (...offers: Contract[]): ContractState => {
    const s = createContractState();
    s.available.push(...offers);
    return s;
  };

  it('accepts a paying rubble offer that fits the stock, flagged and moved to active', () => {
    const contracts = board(rubbleOffer({ id: 5 }));
    const accepted = autoAcceptRubbleClearances(contracts, 1_000, 33);
    expect(accepted.map(c => c.id)).toEqual([5]);
    expect(accepted[0]!.autoAccepted).toBe(true);
    expect(accepted[0]!.acceptedAtTick).toBe(33);
    expect(contracts.available).toHaveLength(0);
    expect(contracts.active.map(c => c.id)).toEqual([5]);
    expect(contracts.active[0]!.autoAccepted).toBe(true);
  });

  it('accepts an offer exactly as large as the stock', () => {
    const contracts = board(rubbleOffer({ quantityKg: 1_000 }));
    expect(autoAcceptRubbleClearances(contracts, 1_000, 0)).toHaveLength(1);
  });

  it('never accepts a paid clearance', () => {
    const contracts = board(rubbleOffer({ playerPays: true }));
    expect(autoAcceptRubbleClearances(contracts, 10_000, 0)).toEqual([]);
    expect(contracts.available).toHaveLength(1);
    expect(contracts.active).toHaveLength(0);
  });

  it('leaves an offer larger than the barren stock alone', () => {
    const contracts = board(rubbleOffer({ quantityKg: 1_001 }));
    expect(autoAcceptRubbleClearances(contracts, 1_000, 0)).toEqual([]);
    expect(contracts.available).toHaveLength(1);
  });

  it('accepts nothing when there is no barren stock', () => {
    const contracts = board(rubbleOffer());
    expect(autoAcceptRubbleClearances(contracts, 0, 0)).toEqual([]);
    expect(contracts.active).toHaveLength(0);
  });

  it('shares the stock across the offers it accepts', () => {
    const contracts = board(rubbleOffer({ id: 1, quantityKg: 600 }), rubbleOffer({ id: 2, quantityKg: 600 }));
    const accepted = autoAcceptRubbleClearances(contracts, 1_000, 0);
    expect(accepted).toHaveLength(1);
    expect(contracts.available).toHaveLength(1);
    expect(contracts.active).toHaveLength(1);
  });

  it('accepts several offers that fit together', () => {
    const contracts = board(rubbleOffer({ id: 1, quantityKg: 600 }), rubbleOffer({ id: 2, quantityKg: 400 }));
    const accepted = autoAcceptRubbleClearances(contracts, 1_000, 0);
    expect(accepted.map(c => c.id).sort()).toEqual([1, 2]);
    expect(contracts.available).toHaveLength(0);
  });

  it('takes the paying offer and leaves the paid one beside it', () => {
    const contracts = board(rubbleOffer({ id: 1, playerPays: true }), rubbleOffer({ id: 2 }));
    const accepted = autoAcceptRubbleClearances(contracts, 1_000, 0);
    expect(accepted.map(c => c.id)).toEqual([2]);
    expect(contracts.available.map(c => c.id)).toEqual([1]);
  });

  it('never accepts ore sale or supply offers', () => {
    const contracts = board(contract({ id: 1, quantityKg: 10 }), contract({ id: 2, type: 'supply', quantityKg: 10 }));
    expect(autoAcceptRubbleClearances(contracts, 1_000_000, 0)).toEqual([]);
    expect(contracts.available).toHaveLength(2);
  });

  it('accepts nothing with autoClearRubble false', () => {
    const contracts = board(rubbleOffer());
    contracts.autoClearRubble = false;
    expect(autoAcceptRubbleClearances(contracts, 1_000_000, 0)).toEqual([]);
    expect(contracts.available).toHaveLength(1);
    expect(contracts.active).toHaveLength(0);
  });

  it('an empty board accepts nothing', () => {
    expect(autoAcceptRubbleClearances(createContractState(), 1_000, 0)).toEqual([]);
  });
});

describe('auto-accepted contract delivery (#2145)', () => {
  const rubble = (overrides: Partial<Contract> = {}) =>
    contract({ type: 'rubble_disposal', materialId: '', quantityKg: 200, pricePerKg: 2, penaltyAmount: 0, earlyBonus: 0, ...overrides });

  it('autoDeliverContracts flags the delivery of an auto-accepted contract', () => {
    const contracts = stateWith(rubble({ autoAccepted: true }));
    const stock = stockWith(0);
    addBarren(stock, 2, 300);
    const out = autoDeliverContracts(contracts, stock.logistics, stock.collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.auto).toBe(true);
  });

  it('autoDeliverContracts does not flag a contract the player accepted', () => {
    const contracts = stateWith(rubble());
    const stock = stockWith(0);
    addBarren(stock, 2, 300);
    const out = autoDeliverContracts(contracts, stock.logistics, stock.collectedOre, 5, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.auto).toBeFalsy();
  });

  it('bookDeliveryCashflow labels an auto delivery "Auto rubble clearance #<id>" under contracts', () => {
    const a = { cash: 1_000, finances: createFinanceState(1_000) };
    const outcome = delivery({ contractId: 9, payment: 120, bonus: 0, fee: false, auto: true });
    bookDeliveryCashflow(a, 9, outcome, 4);
    expect(a.cash).toBe(1_120);
    expect(a.finances.transactions).toHaveLength(1);
    expect(a.finances.transactions[0]).toMatchObject({ type: 'income', category: 'contracts', amount: 120, description: 'Auto rubble clearance #9' });
  });

  it('bookDeliveryCashflow keeps the ordinary label when the outcome is not auto', () => {
    const a = { cash: 1_000, finances: createFinanceState(1_000) };
    bookDeliveryCashflow(a, 9, delivery({ contractId: 9, payment: 120, bonus: 0, fee: false }), 4);
    expect(a.finances.transactions[0]!.description).toBe('Contract #9 delivery');
  });

  it('settleDelivery books an auto delivery under the auto label', () => {
    const state = progressionGame();
    settleDelivery(state, delivery({ contractId: 3, contractType: 'rubble_disposal', materialId: '', kg: 100, payment: 80, auto: true }), 6);
    expect(state.finances.transactions.some(tx => tx.description === 'Auto rubble clearance #3')).toBe(true);
  });
});
