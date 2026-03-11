import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createContractState,
  generateContracts,
} from '../../../src/core/economy/Contract.js';
import { negotiateContract } from '../../../src/core/economy/Negotiation.js';

function setupContracts(seed: number) {
  const state = createContractState();
  const rng = new Random(seed);
  generateContracts(state, rng, 0);
  return { state, rng };
}

describe('Contract negotiation', () => {
  it('negotiation with fixed seed produces deterministic outcome', () => {
    const { state: s1, rng: r1 } = setupContracts(42);
    const { state: s2, rng: r2 } = setupContracts(42);

    const id = s1.available[0]!.id;
    const result1 = negotiateContract(s1, id, 0, r1);
    const result2 = negotiateContract(s2, id, 0, r2);

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.success).toBe(result2!.success);
    expect(result1!.changes).toEqual(result2!.changes);
  });

  it('successful negotiation improves at least one contract term', () => {
    // Run many seeds to find a success
    for (let seed = 0; seed < 100; seed++) {
      const { state, rng } = setupContracts(seed);
      const contract = state.available[0]!;
      const origPrice = contract.pricePerKg;
      const origDeadline = contract.deadlineTicks;
      const origPenalty = contract.penaltyAmount;

      const result = negotiateContract(state, contract.id, 50, rng); // High reputation for success
      if (result && result.success) {
        const improved = (
          contract.pricePerKg > origPrice ||
          contract.deadlineTicks > origDeadline ||
          contract.penaltyAmount < origPenalty
        );
        expect(improved).toBe(true);
        expect(result.changes.length).toBeGreaterThan(0);
        return;
      }
    }
    // With 50 reputation, success rate is ~100%, so this should always find one
    expect.unreachable('No successful negotiation found in 100 seeds');
  });

  it('failed negotiation can worsen terms', () => {
    // Use negative reputation to increase failure chance
    for (let seed = 0; seed < 100; seed++) {
      const { state, rng } = setupContracts(seed);
      const contract = state.available[0]!;
      const origPrice = contract.pricePerKg;
      const origDeadline = contract.deadlineTicks;
      const origPenalty = contract.penaltyAmount;

      const result = negotiateContract(state, contract.id, -40, rng); // Low reputation for failure
      if (result && !result.success) {
        const worsened = (
          contract.pricePerKg < origPrice ||
          contract.deadlineTicks < origDeadline ||
          contract.penaltyAmount > origPenalty
        );
        expect(worsened).toBe(true);
        expect(result.changes.length).toBeGreaterThan(0);
        return;
      }
    }
    expect.unreachable('No failed negotiation found in 100 seeds');
  });

  it('probability of success is influenced by relevant scores', () => {
    // Run many trials with high vs low reputation
    let highRepSuccesses = 0;
    let lowRepSuccesses = 0;
    const trials = 50;

    for (let seed = 0; seed < trials; seed++) {
      const { state: s1, rng: r1 } = setupContracts(seed * 100);
      const { state: s2, rng: r2 } = setupContracts(seed * 100);

      const id = s1.available[0]!.id;
      const r1result = negotiateContract(s1, id, 30, r1);
      const r2result = negotiateContract(s2, id, -30, r2);

      if (r1result?.success) highRepSuccesses++;
      if (r2result?.success) lowRepSuccesses++;
    }

    // High reputation should win more often
    expect(highRepSuccesses).toBeGreaterThan(lowRepSuccesses);
  });
});
