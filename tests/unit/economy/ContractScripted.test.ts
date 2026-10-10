// BlastSimulator2026 — Scripted ore-sale offer (#1600)

import { describe, it, expect } from 'vitest';
import {
  createContractState,
  ensureScriptedOreSale,
  hasFillableOreSaleOffer,
  type Contract,
  type ContractState,
} from '../../../src/core/economy/Contract.js';
import {
  MAX_AVAILABLE_CONTRACTS,
  ORE_PRICES,
  TUTORIAL_ORE_SALE_OFFER,
  type ScriptedOreSaleOffer,
} from '../../../src/core/config/balance.js';

const OFFER: ScriptedOreSaleOffer = { materialId: 'rustite', quantityKg: 400, priceFactor: 1.5, deadlineTicks: 300 };
const MULT = 80;

function filler(id: number): Contract {
  return {
    id, type: 'rubble_disposal', materialId: '', description: 'Dispose of rubble',
    quantityKg: 100, deliveredKg: 0, pricePerKg: 1, deadlineTicks: 100, acceptedAtTick: 0,
    penaltyAmount: 0, earlyBonus: 0, completed: false, expired: false,
  };
}

function scripted(state: ContractState, offer: ScriptedOreSaleOffer = OFFER): Contract[] {
  return state.available.filter(c =>
    c.type === 'ore_sale' && c.materialId === offer.materialId
    && c.quantityKg === offer.quantityKg && c.deadlineTicks === offer.deadlineTicks);
}

function fullBoard(): ContractState {
  const s = createContractState();
  for (let i = 0; i < MAX_AVAILABLE_CONTRACTS; i++) s.available.push(filler(100 + i));
  s.nextId = 200;
  return s;
}

describe('ensureScriptedOreSale (#1600)', () => {
  it('is a no-op for an undefined offer', () => {
    const s = fullBoard();
    const before = structuredClone(s);
    ensureScriptedOreSale(s, undefined, MULT);
    expect(s).toEqual(before);
  });

  it('is a no-op on an empty state for an undefined offer', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, undefined, MULT);
    expect(s.available).toEqual([]);
    expect(s.nextId).toBe(1);
  });

  it('adds one fillable ore_sale offer with the scripted terms', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s.available).toHaveLength(1);
    const c = s.available[0]!;
    expect(c.type).toBe('ore_sale');
    expect(c.materialId).toBe('rustite');
    expect(c.quantityKg).toBe(400);
    expect(c.deadlineTicks).toBe(300);
    expect(c.deliveredKg).toBe(0);
    expect(c.completed).toBe(false);
    expect(c.expired).toBe(false);
    expect(hasFillableOreSaleOffer(s.available, { rustite: 400 })).toBe(true);
    expect(hasFillableOreSaleOffer(s.available, { rustite: 399 })).toBe(false);
  });

  it('prices at ORE_PRICES[material] * priceFactor * multiplier', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s.available[0]!.pricePerKg).toBeCloseTo(ORE_PRICES.rustite * 1.5 * MULT, 6);
  });

  it('prices the real tutorial offer the same way', () => {
    const s = createContractState();
    const o = TUTORIAL_ORE_SALE_OFFER;
    ensureScriptedOreSale(s, o, 80);
    const price = (ORE_PRICES as Record<string, number>)[o.materialId]! * o.priceFactor * 80;
    expect(s.available[0]!.pricePerKg).toBeCloseTo(price, 6);
    expect(s.available[0]!.quantityKg).toBe(o.quantityKg);
  });

  it('assigns a fresh unique id and advances nextId', () => {
    const s = createContractState();
    s.nextId = 7;
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s.available[0]!.id).toBe(7);
    expect(s.nextId).toBe(8);
  });

  it('is idempotent: repeated calls leave a single offer and the same state', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, OFFER, MULT);
    const after = structuredClone(s);
    ensureScriptedOreSale(s, OFFER, MULT);
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(scripted(s)).toHaveLength(1);
    expect(s).toEqual(after);
  });

  it('evicts the oldest non-scripted offer when the board is full', () => {
    const s = fullBoard();
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s.available).toHaveLength(MAX_AVAILABLE_CONTRACTS);
    expect(scripted(s)).toHaveLength(1);
    expect(s.available.some(c => c.id === 100)).toBe(false);
    expect(s.available.some(c => c.id === 101)).toBe(true);
  });

  it('never evicts the scripted offer itself when the board is full and the offer is already there', () => {
    const s = fullBoard();
    ensureScriptedOreSale(s, OFFER, MULT);
    const snapshot = structuredClone(s);
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s).toEqual(snapshot);
  });

  it('re-adds the offer after a refresh pushed it off the board', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, OFFER, MULT);
    s.available = [filler(50), filler(51), filler(52)];
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(scripted(s)).toHaveLength(1);
    expect(s.available).toHaveLength(4);
  });

  it('does not re-add when a matching contract is active', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, OFFER, MULT);
    s.active.push({ ...s.available.shift()!, acceptedAtTick: 3 });
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s.available).toEqual([]);
  });

  it('does not re-add when a matching contract is completed', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, OFFER, MULT);
    s.completedHistory.push({ ...s.available.shift()!, acceptedAtTick: 3, completed: true, deliveredKg: 400 });
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s.available).toEqual([]);
  });

  it('does not re-add when a matching contract expired into history', () => {
    const s = createContractState();
    ensureScriptedOreSale(s, OFFER, MULT);
    s.completedHistory.push({ ...s.available.shift()!, acceptedAtTick: 3, expired: true });
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(s.available).toEqual([]);
  });

  it('keeps unrelated active ore sales from suppressing the offer', () => {
    const s = createContractState();
    s.active.push({ ...filler(9), type: 'ore_sale', materialId: 'dirtite', quantityKg: 5, acceptedAtTick: 1 });
    ensureScriptedOreSale(s, OFFER, MULT);
    expect(scripted(s)).toHaveLength(1);
  });

});
