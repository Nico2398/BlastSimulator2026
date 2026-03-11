import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createContractState,
  generateContracts,
  acceptContract,
  deliverMaterials,
  checkDeadlines,
} from '../../../src/core/economy/Contract.js';

describe('Contract system', () => {
  it('generated contracts have valid fields within expected ranges', () => {
    const state = createContractState();
    const rng = new Random(42);
    generateContracts(state, rng, 0);

    expect(state.available.length).toBeGreaterThan(0);
    for (const c of state.available) {
      expect(c.quantityKg).toBeGreaterThan(0);
      expect(c.pricePerKg).toBeGreaterThan(0);
      expect(c.deadlineTicks).toBeGreaterThan(0);
      expect(c.penaltyAmount).toBeGreaterThan(0);
      expect(['ore_sale', 'rubble_disposal', 'supply']).toContain(c.type);
    }
  });

  it('contract list refreshes periodically (new contracts appear)', () => {
    const state = createContractState();
    const rng = new Random(42);
    generateContracts(state, rng, 0);
    const initialCount = state.available.length;

    // Refresh too early — no change
    generateContracts(state, rng, 5);
    expect(state.available.length).toBe(initialCount);

    // After refresh interval — new contracts added
    generateContracts(state, rng, 25);
    expect(state.available.length).toBeGreaterThan(initialCount);
  });

  it('accepting a contract adds it to active contracts', () => {
    const state = createContractState();
    const rng = new Random(42);
    generateContracts(state, rng, 0);

    const contractId = state.available[0]!.id;
    const contract = acceptContract(state, contractId, 10);

    expect(contract).not.toBeNull();
    expect(contract!.acceptedAtTick).toBe(10);
    expect(state.active.length).toBe(1);
    expect(state.available.find(c => c.id === contractId)).toBeUndefined();
  });

  it('delivering materials against a contract updates progress', () => {
    const state = createContractState();
    const rng = new Random(42);
    generateContracts(state, rng, 0);

    const contractId = state.available[0]!.id;
    const quantity = state.available[0]!.quantityKg;
    acceptContract(state, contractId, 0);

    const result = deliverMaterials(state, contractId, quantity / 2, 5);
    expect(result.payment).toBeGreaterThan(0);
    expect(result.completed).toBe(false);

    const active = state.active.find(c => c.id === contractId);
    expect(active!.deliveredKg).toBeCloseTo(quantity / 2);
  });

  it('completing a contract credits payment', () => {
    const state = createContractState();
    const rng = new Random(42);
    generateContracts(state, rng, 0);

    const contractId = state.available[0]!.id;
    const quantity = state.available[0]!.quantityKg;
    acceptContract(state, contractId, 0);

    const result = deliverMaterials(state, contractId, quantity, 5);
    expect(result.payment).toBeGreaterThan(0);
    expect(result.completed).toBe(true);
    expect(state.completedHistory.length).toBe(1);
    expect(state.active.length).toBe(0);
  });

  it('missing a deadline triggers penalty deduction', () => {
    const state = createContractState();
    const rng = new Random(42);
    generateContracts(state, rng, 0);

    const contract = state.available[0]!;
    const deadline = contract.deadlineTicks;
    acceptContract(state, contract.id, 0);

    // Check before deadline — no penalties
    const earlyPenalties = checkDeadlines(state, deadline - 1);
    expect(earlyPenalties.length).toBe(0);

    // Check after deadline — penalty triggered
    const latePenalties = checkDeadlines(state, deadline + 1);
    expect(latePenalties.length).toBe(1);
    expect(latePenalties[0]!.penalty).toBeGreaterThan(0);
    expect(state.active.length).toBe(0);
  });
});
