import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createContractState,
  generateContracts,
  acceptContract,
  deliverMaterials,
  checkDeadlines,
  findContract,
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

  // ── findContract — stable selection across offer-pool rotation (#597) ──

  describe('findContract', () => {
    it('finds a contract by id', () => {
      const state = createContractState();
      generateContracts(state, new Random(42), 0);
      const target = state.available[1]!;

      expect(findContract(state.available, { id: target.id })).toBe(target);
    });

    it('finds the first contract matching type and materialId', () => {
      const pool = [
        { id: 1, type: 'ore_sale' as const, materialId: 'rustite' } as never,
        { id: 2, type: 'ore_sale' as const, materialId: 'dirtite' } as never,
        { id: 3, type: 'supply' as const, materialId: 'dirtite' } as never,
      ];
      const found = findContract(pool, { type: 'ore_sale', materialId: 'dirtite' });
      expect(found).toBe(pool[1]);
    });

    it('finds the first contract matching materialId alone, regardless of type', () => {
      const pool = [
        { id: 1, type: 'ore_sale' as const, materialId: 'rustite' } as never,
        { id: 2, type: 'supply' as const, materialId: 'dirtite' } as never,
      ];
      expect(findContract(pool, { materialId: 'dirtite' })).toBe(pool[1]);
    });

    it('finds the first contract matching type alone, regardless of materialId', () => {
      const pool = [
        { id: 1, type: 'rubble_disposal' as const, materialId: '' } as never,
        { id: 2, type: 'ore_sale' as const, materialId: 'rustite' } as never,
      ];
      expect(findContract(pool, { type: 'ore_sale' })).toBe(pool[1]);
    });

    it('returns null when no selector field is set — nothing to search for', () => {
      const state = createContractState();
      generateContracts(state, new Random(42), 0);
      expect(findContract(state.available, {})).toBeNull();
    });

    it('returns null when nothing in the pool matches', () => {
      const pool = [{ id: 1, type: 'ore_sale' as const, materialId: 'rustite' } as never];
      expect(findContract(pool, { type: 'ore_sale', materialId: 'absurdium' })).toBeNull();
    });

    it('an id that has rotated out of the available pool is no longer resolvable, but a type/materialId selector still is if a matching contract is still offered', () => {
      const state = createContractState();
      generateContracts(state, new Random(42), 0);
      const evictedId = state.available[0]!.id;
      const survivingType = state.available[0]!.type;
      const survivingMaterial = state.available[0]!.materialId;

      // Force the pool to fill and rotate the original entries out, the way
      // MAX_AVAILABLE_CONTRACTS + repeated refreshes does over a scenario's
      // real running time.
      let tick = 0;
      while (state.available.some(c => c.id === evictedId)) {
        tick += 20;
        generateContracts(state, new Random(42 + tick), tick);
      }

      expect(findContract(state.available, { id: evictedId })).toBeNull();
      // A same-kind contract may or may not still be offered depending on
      // what rotated in — but if one is, the selector finds it without ever
      // having to know its (now different) id.
      const stillOffered = state.available.find(c => c.type === survivingType && c.materialId === survivingMaterial);
      if (stillOffered) {
        expect(findContract(state.available, { type: survivingType, materialId: survivingMaterial })).toBe(stillOffered);
      }
    });

    it('accepting by a material/type selector resolves the same contract accepting by its id would', () => {
      const state = createContractState();
      generateContracts(state, new Random(42), 0);
      const target = state.available[0]!;

      const byId = findContract(state.available, { id: target.id });
      const bySelector = findContract(state.available, { type: target.type, materialId: target.materialId });

      expect(byId).toBe(target);
      expect(bySelector).toBe(target);
    });
  });
});
