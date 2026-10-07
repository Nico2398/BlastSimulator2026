import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createContractState,
  generateContracts,
  computeEarlyBonus,
} from '../../../src/core/economy/Contract.js';
import {
  negotiateContract,
  negotiateContractAtTick,
  negotiationStreamSeed,
  canNegotiate,
  type NegotiationResult,
} from '../../../src/core/economy/Negotiation.js';
import { NEGOTIATION_EARLY_BONUS_RATE, NEGOTIATION_MAX_ATTEMPTS_PER_OFFER } from '../../../src/core/config/balance.js';

function setupContracts(seed: number) {
  const state = createContractState();
  const rng = new Random(seed);
  generateContracts(state, rng, 0);
  return { state, rng };
}

/** Narrow a negotiateContract outcome to a performed negotiation, or null if refused/not found. */
function performed(r: ReturnType<typeof negotiateContract>): NegotiationResult | null {
  return r && 'success' in r ? r : null;
}

describe('Contract negotiation', () => {
  it('negotiation with fixed seed produces deterministic outcome', () => {
    const { state: s1, rng: r1 } = setupContracts(42);
    const { state: s2, rng: r2 } = setupContracts(42);

    const id = s1.available[0]!.id;
    const result1 = performed(negotiateContract(s1, id, 0, r1, 1));
    const result2 = performed(negotiateContract(s2, id, 0, r2, 1));

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

      const result = performed(negotiateContract(state, contract.id, 50, rng, 1)); // High reputation for success
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

      const result = performed(negotiateContract(state, contract.id, -40, rng, 1)); // Low reputation for failure
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
      const r1result = performed(negotiateContract(s1, id, 30, r1, 1));
      const r2result = performed(negotiateContract(s2, id, -30, r2, 1));

      if (r1result?.success) highRepSuccesses++;
      if (r2result?.success) lowRepSuccesses++;
    }

    // High reputation should win more often
    expect(highRepSuccesses).toBeGreaterThan(lowRepSuccesses);
  });
});

describe('one negotiation per offer (#1366)', () => {
  it('first call counts as attempt 1 and mutates terms, success or failure', () => {
    for (const rep of [50, -40]) {
      const { state, rng } = setupContracts(7);
      const c = state.available[0]!;
      const before = { p: c.pricePerKg, d: c.deadlineTicks, pen: c.penaltyAmount };
      const result = negotiateContract(state, c.id, rep, rng, 1);
      expect(result).not.toBeNull();
      expect('refused' in result!).toBe(false);
      expect(c.negotiationAttempts).toBe(1);
      const changed = c.pricePerKg !== before.p || c.deadlineTicks !== before.d || c.penaltyAmount !== before.pen;
      expect(changed).toBe(true);
    }
  });

  it('second call is refused, leaves every term untouched and draws nothing from the rng', () => {
    const { state, rng } = setupContracts(11);
    const c = state.available[0]!;
    negotiateContract(state, c.id, 0, rng, 1);
    const snap = { p: c.pricePerKg, d: c.deadlineTicks, pen: c.penaltyAmount, b: c.earlyBonus };
    const probe = new Random(999);
    const expectedNext = new Random(999).nextFloat(0, 1);
    const second = negotiateContract(state, c.id, 0, probe, 1);
    expect(second).toEqual({ refused: 'already_negotiated' });
    expect(c.pricePerKg).toBe(snap.p);
    expect(c.deadlineTicks).toBe(snap.d);
    expect(c.penaltyAmount).toBe(snap.pen);
    expect(c.earlyBonus).toBe(snap.b);
    expect(c.negotiationAttempts).toBe(1);
    expect(probe.nextFloat(0, 1)).toBe(expectedNext);
  });

  it('unknown id returns null', () => {
    const { state, rng } = setupContracts(3);
    expect(negotiateContract(state, 9999, 0, rng, 1)).toBeNull();
  });

  it('negotiating one offer does not block another', () => {
    const { state, rng } = setupContracts(5);
    const [a, b] = state.available;
    negotiateContract(state, a!.id, 0, rng, 1);
    const r = negotiateContract(state, b!.id, 0, rng, 1);
    expect(r).not.toBeNull();
    expect('refused' in r!).toBe(false);
    expect(b!.negotiationAttempts).toBe(1);
  });
});

describe('canNegotiate (#1366)', () => {
  it('is true for an offer with no attempts (field absent)', () => {
    const { state } = setupContracts(1);
    expect(canNegotiate(state.available[0]!)).toBe(true);
  });

  it('is false once attempts reach NEGOTIATION_MAX_ATTEMPTS_PER_OFFER', () => {
    const { state } = setupContracts(1);
    const c = state.available[0]!;
    c.negotiationAttempts = NEGOTIATION_MAX_ATTEMPTS_PER_OFFER - 1;
    expect(canNegotiate(c)).toBe(true);
    c.negotiationAttempts = NEGOTIATION_MAX_ATTEMPTS_PER_OFFER;
    expect(canNegotiate(c)).toBe(false);
    c.negotiationAttempts = NEGOTIATION_MAX_ATTEMPTS_PER_OFFER + 3;
    expect(canNegotiate(c)).toBe(false);
  });
});

describe('earlyBonus follows price (#1366)', () => {
  it('computeEarlyBonus uses the 0.15 rate rounded', () => {
    expect(NEGOTIATION_EARLY_BONUS_RATE).toBe(0.15);
    expect(computeEarlyBonus(100, 3)).toBe(Math.round(100 * 3 * 0.15));
    expect(computeEarlyBonus(0, 3)).toBe(0);
    expect(computeEarlyBonus(333, 1.37)).toBe(Math.round(333 * 1.37 * NEGOTIATION_EARLY_BONUS_RATE));
  });

  it('matches generated offers', () => {
    for (const mult of [1, 4]) {
      const state = createContractState();
      generateContracts(state, new Random(21), 0, mult);
      for (const c of state.available) {
        expect(c.earlyBonus).toBe(computeEarlyBonus(c.quantityKg, c.pricePerKg));
      }
    }
  });

  it('is recomputed after a price change, on success and on failure', () => {
    for (const rep of [50, -40]) {
      let priceChanges = 0;
      for (let seed = 0; seed < 60; seed++) {
        const { state, rng } = setupContracts(seed);
        const c = state.available[0]!;
        const origPrice = c.pricePerKg;
        negotiateContract(state, c.id, rep, rng, 1);
        if (c.pricePerKg !== origPrice) {
          priceChanges++;
          expect(c.earlyBonus).toBe(computeEarlyBonus(c.quantityKg, c.pricePerKg));
        }
      }
      expect(priceChanges).toBeGreaterThan(0);
    }
  });

  it('is left alone when only deadline or penalty changed', () => {
    let seen = 0;
    for (let seed = 0; seed < 60; seed++) {
      const { state, rng } = setupContracts(seed);
      const c = state.available[0]!;
      const origPrice = c.pricePerKg;
      const origBonus = c.earlyBonus;
      negotiateContract(state, c.id, -40, rng, 1);
      if (c.pricePerKg === origPrice) {
        seen++;
        expect(c.earlyBonus).toBe(origBonus);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('negotiationStreamSeed (#1366)', () => {
  it('is deterministic and a 32-bit integer', () => {
    const a = negotiationStreamSeed(42, 10, 3, 0);
    expect(negotiationStreamSeed(42, 10, 3, 0)).toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(a).toBeLessThanOrEqual(2 ** 31 - 1);
  });

  it('differs across contract id and attempt for the same seed and tick', () => {
    const base = negotiationStreamSeed(42, 10, 3, 0);
    expect(negotiationStreamSeed(42, 10, 4, 0)).not.toBe(base);
    expect(negotiationStreamSeed(42, 11, 3, 0)).not.toBe(base);
    expect(negotiationStreamSeed(43, 10, 3, 0)).not.toBe(base);
    expect(negotiationStreamSeed(42, 10, 3, 1)).not.toBe(base);
  });
});

describe('negotiateContractAtTick (#1366)', () => {
  it('is deterministic for equal inputs', () => {
    const { state: s1 } = setupContracts(42);
    const { state: s2 } = setupContracts(42);
    const id = s1.available[0]!.id;
    const r1 = negotiateContractAtTick(s1, id, 0, 42, 5, 1);
    const r2 = negotiateContractAtTick(s2, id, 0, 42, 5, 1);
    expect('refused' in r1).toBe(false);
    expect((r1 as { success: boolean }).success).toBe((r2 as { success: boolean }).success);
    expect((r1 as { changes: unknown }).changes).toEqual((r2 as { changes: unknown }).changes);
  });

  it('refuses a repeat and reports unknown ids', () => {
    const { state } = setupContracts(42);
    const id = state.available[0]!.id;
    negotiateContractAtTick(state, id, 0, 42, 5, 1);
    expect(negotiateContractAtTick(state, id, 0, 42, 5, 1)).toEqual({ refused: 'already_negotiated' });
    expect(negotiateContractAtTick(state, 9999, 0, 42, 5, 1)).toEqual({ refused: 'not_found' });
  });

  it('two offers negotiated at the same tick do not roll identically', () => {
    let differing = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { state } = setupContracts(seed);
      const [a, b] = state.available;
      const ra = negotiateContractAtTick(state, a!.id, 0, seed, 7, 1) as { success: boolean; changes: unknown[] };
      const rb = negotiateContractAtTick(state, b!.id, 0, seed, 7, 1) as { success: boolean; changes: unknown[] };
      if (ra.success !== rb.success || JSON.stringify(ra.changes) !== JSON.stringify(rb.changes)) differing++;
    }
    expect(differing).toBeGreaterThan(0);
  });
});
