import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createContractState,
  generateContracts,
  acceptContract,
  deliverMaterials,
  checkDeadlines,
  findContract,
  storedForContract,
  hasStockedOffer,
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

  // ── priceMultiplier (#959) ──────────────────────────────────────────────
  // tutorial_pit declares contractPriceMultiplier: 16.0 (Level.ts) so its own
  // narrower economy can still close a deficit through contract income, but
  // no call site ever threads it through — generateContracts/
  // generateOneContract accept the parameter today but generateOneContract's
  // own copy is prefixed `_priceMultiplier` (unused, no-op).
  describe('priceMultiplier', () => {
    it('scales every generated contract\'s pricePerKg by the given multiplier, relative to the unmultiplied baseline', () => {
      const baseline = createContractState();
      generateContracts(baseline, new Random(42), 0);

      const multiplied = createContractState();
      generateContracts(multiplied, new Random(42), 0, 1.5);

      expect(multiplied.available.length).toBe(baseline.available.length);
      for (let i = 0; i < baseline.available.length; i++) {
        const base = baseline.available[i]!;
        const scaled = multiplied.available[i]!;
        // Same contract shape (same seed/roll sequence) — only price moves.
        expect(scaled.type).toBe(base.type);
        expect(scaled.materialId).toBe(base.materialId);
        expect(scaled.quantityKg).toBe(base.quantityKg);
        expect(scaled.pricePerKg).toBeCloseTo(base.pricePerKg * 1.5, 6);
      }
    });

    it('a multiplier of 1 (the default) reproduces the unmultiplied baseline exactly', () => {
      const baseline = createContractState();
      generateContracts(baseline, new Random(42), 0);

      const explicit = createContractState();
      generateContracts(explicit, new Random(42), 0, 1);

      expect(explicit.available).toEqual(baseline.available);
    });

    it('leaves the missed-deadline penalty on the unmultiplied base price, while the early-delivery bonus scales (#959)', () => {
      const baseline = createContractState();
      generateContracts(baseline, new Random(42), 0);

      const multiplied = createContractState();
      generateContracts(multiplied, new Random(42), 0, 16);

      expect(multiplied.available.length).toBe(baseline.available.length);
      for (let i = 0; i < baseline.available.length; i++) {
        const base = baseline.available[i]!;
        const scaled = multiplied.available[i]!;
        // The fine for missing a deadline is what the buyer is owed, not a bet
        // scaled by the lever a level pulls to make its own economy closeable:
        // tutorial_pit runs at 16.0 precisely because it cannot be won at
        // market rate, and a 16x fine on one unfillable contract would end the
        // level the tutorial exists to teach.
        expect(scaled.penaltyAmount).toBe(base.penaltyAmount);
        // The bonus rides on the price, so it does scale.
        expect(scaled.earlyBonus).toBe(Math.round(base.quantityKg * base.pricePerKg * 16 * 0.15));
      }
    });

    it('a sub-1 multiplier (a tight, lowball market) scales prices down, not just up', () => {
      const baseline = createContractState();
      generateContracts(baseline, new Random(42), 0);

      const discounted = createContractState();
      generateContracts(discounted, new Random(42), 0, 0.85);

      for (let i = 0; i < baseline.available.length; i++) {
        expect(discounted.available[i]!.pricePerKg).toBeCloseTo(baseline.available[i]!.pricePerKg * 0.85, 6);
      }
    });
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
  // `storedForContract`/`hasStockedOffer` (#1048 follow-up): which ore an offer
  // asks for is a plain `rng.pick(CONTRACT_ORES)` in `generateOneContract`,
  // owing nothing to what a given pit's rock contains — so "an offer this site
  // can actually fill" is a property of the offer/storage pair. The Contracts
  // panel's Deliver button, its `data-contract-stocked` attribute and the
  // scenario state dump's `hasStockedOreSaleOffer` all read these, so a
  // scenario that waits on the field and then clicks the marked card is
  // waiting on the same rule the card was marked by.
  describe('storedForContract', () => {
    it('reads collected ore by material id', () => {
      expect(storedForContract('dirtite', { dirtite: 625, rustite: 30 }, 1021)).toBe(625);
    });

    it("reads raw stored mass for rubble's empty material id", () => {
      expect(storedForContract('', { dirtite: 625 }, 1021)).toBe(1021);
    });

    it('is 0 for a material the site holds none of', () => {
      expect(storedForContract('absurdium', { dirtite: 625 }, 1021)).toBe(0);
    });
  });

  describe('hasStockedOffer', () => {
    const pool = [
      { id: 1, type: 'ore_sale' as const, materialId: 'absurdium' } as never,
      { id: 2, type: 'ore_sale' as const, materialId: 'dirtite' } as never,
      { id: 3, type: 'supply' as const, materialId: 'gloomium' } as never,
    ];

    it('is true when an offer of that type asks for a material in storage', () => {
      expect(hasStockedOffer(pool, 'ore_sale', { dirtite: 625 }, 0)).toBe(true);
    });

    it('is false when every offer of that type asks for a material the site lacks', () => {
      expect(hasStockedOffer(pool, 'ore_sale', { rustite: 30 }, 0)).toBe(false);
    });

    it('does not count an offer of a different type, however well stocked', () => {
      expect(hasStockedOffer(pool, 'ore_sale', { gloomium: 5000 }, 0)).toBe(false);
    });

    it('counts a rubble_disposal offer against raw stored mass', () => {
      const rubble = [{ id: 4, type: 'rubble_disposal' as const, materialId: '' } as never];
      expect(hasStockedOffer(rubble, 'rubble_disposal', {}, 1021)).toBe(true);
      expect(hasStockedOffer(rubble, 'rubble_disposal', {}, 0)).toBe(false);
    });

    it('is false on an empty pool', () => {
      expect(hasStockedOffer([], 'ore_sale', { dirtite: 625 }, 1021)).toBe(false);
    });
  });
});
