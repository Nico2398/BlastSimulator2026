// BlastSimulator2026 — `contract accept|deliver ... fillable:true` (#1338).
// Selects the ore_sale offer that stored ore already covers; refuses clearly otherwise.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { contractCommand } from '../../src/console/commands/economy.js';
import type { Contract } from '../../src/core/economy/Contract.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { ORE_DENSITY_KG_M3 } from '../../src/core/config/balance.js';
import { ensureFreightWarehouse } from '../helpers/freightWarehouse.js';
import { getProfitShortfall } from '../../src/core/campaign/LevelObjective.js';

function addOffer(ctx: GameContext, materialId: string, quantityKg: number, pricePerKg = 10): Contract {
  const state = ctx.state!.contracts;
  const c: Contract = {
    id: state.nextId++,
    type: 'ore_sale',
    materialId,
    description: `[fixture] ${quantityKg} kg ${materialId}`,
    quantityKg,
    deliveredKg: 0,
    pricePerKg,
    deadlineTicks: 500,
    acceptedAtTick: 0,
    penaltyAmount: 100,
    earlyBonus: 50,
    completed: false,
    expired: false,
  };
  state.available.push(c);
  return c;
}

function store(ctx: GameContext, materialId: string, kg: number): void {
  ctx.state!.collectedOre[materialId] = kg;
  const fragment: FragmentData = {
    id: 9000 + Math.floor(kg),
    position: { x: 0, y: 0, z: 0 },
    volume: 0.04,
    mass: kg,
    rockId: 'sandite',
    oreDensities: { [materialId]: 1.0 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
    shapeSeed: 1,
    origin: { x: 0, y: 0, z: 0 },
  };
  ctx.state!.logistics.fragments.push({ fragment, state: 'stored', vehicleId: null, warehouseId: ensureFreightWarehouse(ctx) });
  ctx.state!.logistics.storedMassKg += kg;
}

describe('contract fillable:true (#1338)', () => {
  let ctx: GameContext;
  beforeEach(() => {
    ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    ctx.state!.contracts.available = [];
    ensureFreightWarehouse(ctx);
  });

  it('accept picks the covered offer, skipping an earlier uncovered one', () => {
    const big = addOffer(ctx, 'blingite', 5000);
    const small = addOffer(ctx, 'blingite', 100);
    store(ctx, 'blingite', 150);
    const r = contractCommand(ctx, ['accept'], { type: 'ore_sale', fillable: 'true' });
    expect(r.success).toBe(true);
    expect(ctx.state!.contracts.active.map(c => c.id)).toEqual([small.id]);
    expect(ctx.state!.contracts.available.some(c => c.id === big.id)).toBe(true);
  });

  it('accept accepts an offer exactly equal to stock', () => {
    const c = addOffer(ctx, 'blingite', 150);
    store(ctx, 'blingite', 150);
    expect(contractCommand(ctx, ['accept'], { type: 'ore_sale', fillable: 'true' }).success).toBe(true);
    expect(ctx.state!.contracts.active[0]!.id).toBe(c.id);
  });

  it('accept refuses with a clear message when no offer is covered', () => {
    addOffer(ctx, 'blingite', 5000);
    store(ctx, 'blingite', 10);
    const r = contractCommand(ctx, ['accept'], { type: 'ore_sale', fillable: 'true' });
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('fillable');
    expect(ctx.state!.contracts.active).toHaveLength(0);
  });

  it('accept without the flag still takes the first match', () => {
    const big = addOffer(ctx, 'blingite', 5000);
    addOffer(ctx, 'blingite', 100);
    store(ctx, 'blingite', 150);
    expect(contractCommand(ctx, ['accept'], { type: 'ore_sale' }).success).toBe(true);
    expect(ctx.state!.contracts.active[0]!.id).toBe(big.id);
  });

  it('deliver fillable:true delivers to the covered active contract', () => {
    addOffer(ctx, 'blingite', 5000);
    const small = addOffer(ctx, 'blingite', 100);
    store(ctx, 'blingite', 150);
    expect(contractCommand(ctx, ['accept'], { type: 'ore_sale', fillable: 'true' }).success).toBe(true);
    const r = contractCommand(ctx, ['deliver'], { type: 'ore_sale', fillable: 'true', amount: '100' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('COMPLETED');
    expect(ctx.state!.contracts.active.find(c => c.id === small.id)?.completed ?? true).toBe(true);
  });

  it('deliver fillable:true refuses with a clear message when no active contract is covered', () => {
    const c = addOffer(ctx, 'blingite', 5000);
    expect(contractCommand(ctx, ['accept', String(c.id)], {}).success).toBe(true);
    store(ctx, 'blingite', 10);
    const r = contractCommand(ctx, ['deliver'], { type: 'ore_sale', fillable: 'true', amount: '10' });
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('fillable');
  });

  it('an ore_sale offer covered only by ore in a fragment whose densities sum above 1 is accepted and delivered in full (#1786)', () => {
    // Rescaled mixed fragment: dirtite 2.85 + rustite 1.0, V=0.075, 157.5 kg.
    const volume = 0.075;
    const dirtiteKg = volume * 2.85 * ORE_DENSITY_KG_M3;
    const rustiteKg = volume * 1.0 * ORE_DENSITY_KG_M3;
    const fragment: FragmentData = {
      id: 9786,
      position: { x: 0, y: 0, z: 0 },
      volume,
      mass: 157.5,
      rockId: 'sandite',
      oreDensities: { dirtite: 2.85, rustite: 1.0 },
      initialVelocity: { x: 0, y: 0, z: 0 },
      isProjection: false,
      halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
      shapeSeed: 1,
      origin: { x: 0, y: 0, z: 0 },
    };
    ctx.state!.logistics.fragments.push({ fragment, state: 'stored', vehicleId: null, warehouseId: ensureFreightWarehouse(ctx) });
    ctx.state!.logistics.storedMassKg += fragment.mass;
    ctx.state!.collectedOre['dirtite'] = dirtiteKg;
    ctx.state!.collectedOre['rustite'] = rustiteKg;
    const offer = addOffer(ctx, 'dirtite', Math.floor(dirtiteKg));

    const accept = contractCommand(ctx, ['accept'], { type: 'ore_sale', fillable: 'true' });
    expect(accept.success).toBe(true);
    expect(ctx.state!.contracts.active.map(c => c.id)).toEqual([offer.id]);

    const deliver = contractCommand(ctx, ['deliver'], { type: 'ore_sale', fillable: 'true', amount: String(offer.quantityKg) });
    expect(deliver.success).toBe(true);
    expect(deliver.output).toContain('COMPLETED');
    expect(offer.deliveredKg).toBeCloseTo(offer.quantityKg, 6);
    expect(ctx.state!.collectedOre['dirtite']).toBeCloseTo(dirtiteKg - offer.quantityKg, 6);
    expect(ctx.state!.collectedOre['rustite']).toBeCloseTo(rustiteKg, 6);
  });

  describe('rubble_disposal offers count barren stock only (#1871)', () => {
    function addRubbleOffer(quantityKg: number): Contract {
      const c = addOffer(ctx, '', quantityKg);
      c.type = 'rubble_disposal';
      return c;
    }

    function storeBarren(kg: number): void {
      const fragment: FragmentData = {
        id: 9500 + Math.floor(kg),
        position: { x: 0, y: 0, z: 0 },
        volume: kg / 2500,
        mass: kg,
        rockId: 'sandite',
        oreDensities: {},
        initialVelocity: { x: 0, y: 0, z: 0 },
        isProjection: false,
        halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
        shapeSeed: 1,
        origin: { x: 0, y: 0, z: 0 },
      };
      ctx.state!.logistics.fragments.push({ fragment, state: 'stored', vehicleId: null, warehouseId: ensureFreightWarehouse(ctx) });
      ctx.state!.logistics.storedMassKg += kg;
    }

    it('accepts a rubble offer covered by barren stored rock', () => {
      const c = addRubbleOffer(100);
      storeBarren(150);
      expect(contractCommand(ctx, ['accept'], { type: 'rubble_disposal', fillable: 'true' }).success).toBe(true);
      expect(ctx.state!.contracts.active.map(a => a.id)).toEqual([c.id]);
    });

    it('does not count ore-bearing stored mass toward a rubble offer', () => {
      addRubbleOffer(100);
      store(ctx, 'blingite', 5000);
      const r = contractCommand(ctx, ['accept'], { type: 'rubble_disposal', fillable: 'true' });
      expect(r.success).toBe(false);
      expect(r.output.toLowerCase()).toContain('fillable');
      expect(ctx.state!.contracts.active).toHaveLength(0);
    });

    it('counts only the barren part of a mixed stock', () => {
      const big = addRubbleOffer(1000);
      const small = addRubbleOffer(100);
      store(ctx, 'blingite', 5000);
      storeBarren(150);
      expect(contractCommand(ctx, ['accept'], { type: 'rubble_disposal', fillable: 'true' }).success).toBe(true);
      expect(ctx.state!.contracts.active.map(a => a.id)).toEqual([small.id]);
      expect(ctx.state!.contracts.available.some(a => a.id === big.id)).toBe(true);
    });

    it('deliver refuses an amount only ore-bearing stock could cover, leaving the ore ledger alone', () => {
      const c = addRubbleOffer(100);
      expect(contractCommand(ctx, ['accept', String(c.id)], {}).success).toBe(true);
      store(ctx, 'blingite', 5000);
      const r = contractCommand(ctx, ['deliver', String(c.id)], { amount: '100' });
      expect(r.success).toBe(false);
      expect(ctx.state!.collectedOre['blingite']).toBe(5000);
      expect(ctx.state!.logistics.storedMassKg).toBe(5000);
    });
  });
});

describe('contract accept wins:true', () => {
  let ctx: GameContext;
  let shortfall: number;
  beforeEach(() => {
    ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    ctx.state!.contracts.available = [];
    ensureFreightWarehouse(ctx);
    ctx.state!.campaign.activeLevelId = 'tutorial_pit';
    shortfall = getProfitShortfall('tutorial_pit', ctx.state!.finances);
  });

  it('has a finite profit shortfall to cover on a campaign level', () => {
    expect(shortfall).toBeGreaterThan(0);
    expect(Number.isFinite(shortfall)).toBe(true);
  });

  it('accepts the fillable offer that covers the shortfall, skipping an earlier fillable one that does not', () => {
    const small = addOffer(ctx, 'rustite', 100, (shortfall / 100) * 0.5);
    const winner = addOffer(ctx, 'rustite', 200, shortfall / 200);
    store(ctx, 'rustite', 300);
    const r = contractCommand(ctx, ['accept'], { type: 'ore_sale', material: 'rustite', fillable: 'true', wins: 'true' });
    expect(r.success).toBe(true);
    expect(ctx.state!.contracts.active.map(c => c.id)).toEqual([winner.id]);
    expect(ctx.state!.contracts.available.some(c => c.id === small.id)).toBe(true);
  });

  it('refuses with a clear message when no fillable offer covers the shortfall', () => {
    addOffer(ctx, 'rustite', 100, (shortfall / 100) * 0.5);
    store(ctx, 'rustite', 300);
    const r = contractCommand(ctx, ['accept'], { type: 'ore_sale', wins: 'true' });
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('winning');
    expect(ctx.state!.contracts.active).toHaveLength(0);
  });
});
