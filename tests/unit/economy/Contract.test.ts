import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createContractState,
  generateContracts,
  acceptContract,
  deliverMaterials,
  checkDeadlines,
  findContract,
  hasFillableOreSaleOffer,
  hasFillableSaleOffer,
  isFillableSaleOffer,
  hasRubbleDisposalOffer,
} from '../../../src/core/economy/Contract.js';
import {
  CONTRACT_REFRESH_INTERVAL,
  CONTRACTS_PER_REFRESH,
  MAX_AVAILABLE_CONTRACTS,
} from '../../../src/core/config/balance.js';
import type { Contract } from '../../../src/core/economy/Contract.js';

/** A minimal offered contract — only the fields hasFillableOreSaleOffer reads carry meaning. */
function offer(overrides: Partial<Contract>): Contract {
  return {
    id: 1, type: 'ore_sale', materialId: 'dirtite', description: '', quantityKg: 100,
    deliveredKg: 0, pricePerKg: 3, deadlineTicks: 50, acceptedAtTick: 0,
    penaltyAmount: 0, earlyBonus: 0, completed: false, expired: false,
    ...overrides,
  };
}

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

    it('ANDs id with the other selector fields: matching type finds it, mismatching type is null', () => {
      const pool = [
        { id: 1, type: 'ore_sale' as const, materialId: 'rustite' } as never,
        { id: 2, type: 'supply' as const, materialId: 'dirtite' } as never,
      ];
      expect(findContract(pool, { id: 2, type: 'supply' })).toBe(pool[1]);
      expect(findContract(pool, { id: 2, type: 'ore_sale' })).toBeNull();
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

    describe('fillable (#1338)', () => {
      const offer = (id: number, materialId: string, quantityKg: number, type = 'ore_sale' as const) =>
        ({ id, type, materialId, quantityKg } as never);

      it('prefers the ore_sale offer collectedOre already covers over an earlier uncovered one', () => {
        const pool = [offer(1, 'rustite', 500), offer(2, 'dirtite', 100)];
        expect(findContract(pool, { type: 'ore_sale', fillable: true }, { rustite: 100, dirtite: 150 })).toBe(pool[1]);
      });

      it('treats stock exactly equal to quantityKg as covered', () => {
        const pool = [offer(1, 'rustite', 200)];
        expect(findContract(pool, { type: 'ore_sale', fillable: true }, { rustite: 200 })).toBe(pool[0]);
      });

      it('just under quantityKg is not covered', () => {
        const pool = [offer(1, 'rustite', 200)];
        expect(findContract(pool, { type: 'ore_sale', fillable: true }, { rustite: 199.9 })).toBeNull();
      });

      it('returns null when no offer is covered, even though a plain match exists', () => {
        const pool = [offer(1, 'rustite', 500), offer(2, 'dirtite', 100)];
        expect(findContract(pool, { type: 'ore_sale' }, {})).toBe(pool[0]);
        expect(findContract(pool, { type: 'ore_sale', fillable: true }, { rustite: 1 })).toBeNull();
      });

      it('ignores non-ore_sale offers even when stock covers their quantity', () => {
        const pool = [offer(1, 'rustite', 10, 'supply' as never)];
        expect(findContract(pool, { fillable: true, materialId: 'rustite' }, { rustite: 999 })).toBeNull();
      });

      it('combines with materialId: only that material may be the covered one', () => {
        const pool = [offer(1, 'rustite', 100), offer(2, 'dirtite', 100)];
        expect(findContract(pool, { materialId: 'dirtite', fillable: true }, { rustite: 500 })).toBeNull();
        expect(findContract(pool, { materialId: 'dirtite', fillable: true }, { rustite: 500, dirtite: 100 })).toBe(pool[1]);
      });

      it('absent or false flag leaves selection unchanged', () => {
        const pool = [offer(1, 'rustite', 500), offer(2, 'dirtite', 100)];
        expect(findContract(pool, { type: 'ore_sale' }, { dirtite: 999 })).toBe(pool[0]);
        expect(findContract(pool, { type: 'ore_sale', fillable: false }, { dirtite: 999 })).toBe(pool[0]);
      });
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

  describe('hasFillableOreSaleOffer', () => {
    it('is true when storage covers an offered ore_sale in full', () => {
      expect(hasFillableOreSaleOffer([offer({ quantityKg: 100 })], { dirtite: 100 })).toBe(true);
    });

    it('is false one kilogram short — a part delivery completes no contract', () => {
      expect(hasFillableOreSaleOffer([offer({ quantityKg: 100 })], { dirtite: 99 })).toBe(false);
    });

    it('is false for an ore the site holds none of', () => {
      expect(hasFillableOreSaleOffer([offer({ materialId: 'gloomium' })], { dirtite: 5000 })).toBe(false);
    });

    it('ignores offers that are not ore_sale, however well covered', () => {
      const rubble = offer({ type: 'rubble_disposal', materialId: '', quantityKg: 1 });
      expect(hasFillableOreSaleOffer([rubble], { '': 5000 })).toBe(false);
    });

    it('is false on an empty pool', () => {
      expect(hasFillableOreSaleOffer([], { dirtite: 5000 })).toBe(false);
    });

    it('is true when any one of several offers is fillable', () => {
      const pool = [
        offer({ id: 1, materialId: 'gloomium', quantityKg: 500 }),
        offer({ id: 2, materialId: 'dirtite', quantityKg: 50 }),
      ];
      expect(hasFillableOreSaleOffer(pool, { dirtite: 60 })).toBe(true);
    });
  });

  describe('hasRubbleDisposalOffer', () => {
    it('is true when the pool holds a rubble_disposal offer', () => {
      const rubble = offer({ type: 'rubble_disposal', materialId: '', quantityKg: 120 });
      expect(hasRubbleDisposalOffer([rubble])).toBe(true);
    });

    it('is false on an empty pool', () => {
      expect(hasRubbleDisposalOffer([])).toBe(false);
    });

    it('is false when the pool holds only other contract types', () => {
      const pool = [offer({ type: 'ore_sale' }), offer({ id: 2, type: 'supply' })];
      expect(hasRubbleDisposalOffer(pool)).toBe(false);
    });

    it('is true when any one of several offers is rubble_disposal', () => {
      const pool = [
        offer({ id: 1, type: 'ore_sale' }),
        offer({ id: 2, type: 'rubble_disposal', materialId: '', quantityKg: 50 }),
        offer({ id: 3, type: 'supply' }),
      ];
      expect(hasRubbleDisposalOffer(pool)).toBe(true);
    });
  });

  // ── Refresh batch size (#1365) ──────────────────────────────────────────
  // Every refresh must add exactly CONTRACTS_PER_REFRESH offers, evicting the
  // oldest first on overflow. Old behaviour evicted one when full, so new
  // offers per refresh went 3,3,2,1,1,1.
  describe('refresh batch size (#1365)', () => {
    const ids = (s: { available: Contract[] }) => s.available.map(c => c.id);

    it('uses the documented tunables', () => {
      expect(CONTRACTS_PER_REFRESH).toBe(3);
      expect(MAX_AVAILABLE_CONTRACTS).toBe(8);
      expect(CONTRACT_REFRESH_INTERVAL).toBe(20);
    });

    it('first refresh on an empty board yields exactly 3 offers', () => {
      const state = createContractState();
      generateContracts(state, new Random(42), 0);
      expect(state.available).toHaveLength(3);
    });

    it('a full board (8) evicts exactly the 3 oldest, keeps the 5 newest in order, appends 3 new ids', () => {
      const state = createContractState();
      state.available = Array.from({ length: 8 }, (_, i) => offer({ id: i + 1 }));
      state.nextId = 9;
      state.lastRefreshTick = 0;
      generateContracts(state, new Random(42), CONTRACT_REFRESH_INTERVAL);
      expect(ids(state)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('a partially full board (6) ends at 8, evicting only 1', () => {
      const state = createContractState();
      state.available = Array.from({ length: 6 }, (_, i) => offer({ id: i + 1 }));
      state.nextId = 7;
      state.lastRefreshTick = 0;
      generateContracts(state, new Random(42), CONTRACT_REFRESH_INTERVAL);
      expect(ids(state)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('a board with room for the whole batch (5) evicts nothing', () => {
      const state = createContractState();
      state.available = Array.from({ length: 5 }, (_, i) => offer({ id: i + 1 }));
      state.nextId = 6;
      state.lastRefreshTick = 0;
      generateContracts(state, new Random(42), CONTRACT_REFRESH_INTERVAL);
      expect(ids(state)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('7 consecutive refreshes each add exactly 3 new ids and the board never exceeds 8', () => {
      const state = createContractState();
      const rng = new Random(42);
      for (let n = 0; n < 7; n++) {
        const before = new Set(ids(state));
        generateContracts(state, rng, n * CONTRACT_REFRESH_INTERVAL);
        const added = ids(state).filter(id => !before.has(id));
        expect(added, `refresh ${n}`).toHaveLength(3);
        expect(state.available.length).toBeLessThanOrEqual(MAX_AVAILABLE_CONTRACTS);
      }
      expect(state.available).toHaveLength(8);
    });

    it('refresh before the interval elapsed on a non-empty board is a no-op', () => {
      const state = createContractState();
      const rng = new Random(42);
      generateContracts(state, rng, 0);
      const before = ids(state);
      generateContracts(state, rng, CONTRACT_REFRESH_INTERVAL - 1);
      expect(ids(state)).toEqual(before);
      expect(state.nextId).toBe(4);
    });

    it('ore_sale prices stay in the x0.8-1.3 band of base (gloomium base $80)', () => {
      const base: Record<string, number> = { gloomium: 80, dirtite: 3, rustite: 12, blingite: 35 };
      let sawGloomium = false;
      for (let seed = 1; seed <= 60; seed++) {
        const state = createContractState();
        const rng = new Random(seed);
        for (let n = 0; n < 8; n++) generateContracts(state, rng, n * CONTRACT_REFRESH_INTERVAL);
        for (const c of state.available.filter(o => o.type === 'ore_sale')) {
          const b = base[c.materialId];
          if (b === undefined) continue;
          if (c.materialId === 'gloomium') {
            sawGloomium = true;
            expect(c.pricePerKg).toBeGreaterThanOrEqual(80 * 0.8);
            expect(c.pricePerKg).toBeLessThanOrEqual(80 * 1.3);
          }
          expect(c.pricePerKg).toBeGreaterThanOrEqual(b * 0.8);
          expect(c.pricePerKg).toBeLessThanOrEqual(b * 1.3);
        }
      }
      expect(sawGloomium).toBe(true);
    });

    it('rubble_disposal prices stay within 0.5-2.0', () => {
      let saw = false;
      for (let seed = 1; seed <= 30; seed++) {
        const state = createContractState();
        const rng = new Random(seed);
        for (let n = 0; n < 8; n++) generateContracts(state, rng, n * CONTRACT_REFRESH_INTERVAL);
        for (const c of state.available.filter(o => o.type === 'rubble_disposal')) {
          saw = true;
          expect(c.pricePerKg).toBeGreaterThanOrEqual(0.5);
          expect(c.pricePerKg).toBeLessThanOrEqual(2.0);
        }
      }
      expect(saw).toBe(true);
    });
  });
});

describe('fillable sale offers: ore_sale or rubble_disposal (#1338)', () => {
  it('an ore_sale is fillable when its ore is covered, exactly equal included', () => {
    expect(isFillableSaleOffer(offer({ quantityKg: 100 }), { dirtite: 100 }, 0)).toBe(true);
    expect(isFillableSaleOffer(offer({ quantityKg: 100 }), { dirtite: 99.9 }, 5000)).toBe(false);
  });

  it('a rubble_disposal is judged against stored mass, not ore', () => {
    const rubble = offer({ type: 'rubble_disposal', materialId: '', quantityKg: 300 });
    expect(isFillableSaleOffer(rubble, { dirtite: 5000 }, 300)).toBe(true);
    expect(isFillableSaleOffer(rubble, {}, 299)).toBe(false);
  });

  it('a supply contract is never a one-click sale', () => {
    expect(isFillableSaleOffer(offer({ type: 'supply', quantityKg: 10 }), { dirtite: 999 }, 999)).toBe(false);
  });

  it('hasFillableSaleOffer is true when only the rubble offer is covered', () => {
    const pool = [offer({ quantityKg: 500 }), offer({ id: 2, type: 'rubble_disposal', materialId: '', quantityKg: 200 })];
    expect(hasFillableSaleOffer(pool, {}, 200)).toBe(true);
    expect(hasFillableSaleOffer(pool, {}, 100)).toBe(false);
    expect(hasFillableSaleOffer([], { dirtite: 999 }, 999)).toBe(false);
  });

  it('findContract fillable resolves a covered rubble offer once stored mass is passed', () => {
    const pool = [offer({ id: 1, quantityKg: 500 }), offer({ id: 2, type: 'rubble_disposal', materialId: '', quantityKg: 200 })];
    expect(findContract(pool, { fillable: true }, {}, 250)).toBe(pool[1]);
    expect(findContract(pool, { fillable: true }, {})).toBeNull();
  });
});
