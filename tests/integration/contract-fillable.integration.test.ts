// BlastSimulator2026 — `contract accept|deliver ... fillable:true` (#1338).
// Selects the ore_sale offer that stored ore already covers; refuses clearly otherwise.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { contractCommand } from '../../src/console/commands/economy.js';
import type { Contract } from '../../src/core/economy/Contract.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { makeGameContext } from '../helpers/gameContext.js';

function addOffer(ctx: GameContext, materialId: string, quantityKg: number): Contract {
  const state = ctx.state!.contracts;
  const c: Contract = {
    id: state.nextId++,
    type: 'ore_sale',
    materialId,
    description: `[fixture] ${quantityKg} kg ${materialId}`,
    quantityKg,
    deliveredKg: 0,
    pricePerKg: 10,
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
  ctx.state!.logistics.fragments.push({ fragment, state: 'stored', vehicleId: null });
  ctx.state!.logistics.storedMassKg += kg;
}

describe('contract fillable:true (#1338)', () => {
  let ctx: GameContext;
  beforeEach(() => {
    ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    ctx.state!.contracts.available = [];
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
});
