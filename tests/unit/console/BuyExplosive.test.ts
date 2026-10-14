// BlastSimulator2026 — `buy explosive:<id> kg:<n>` console command (#1678)

import { describe, it, expect } from 'vitest';
import { buyCommand } from '../../../src/console/commands/mining.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { getExplosivesInStock } from '../../../src/core/entities/BuildingWarehouse.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

function ctxWithWarehouse(cash = 100_000): MiningContext {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
  const s = ctx.state!;
  s.cash = cash;
  placeBuilding(s.buildings, 'explosive_warehouse', 10, 10, 32, 32);
  return ctx;
}

describe('buy explosive:<id> kg:<n>', () => {
  it('buys into stock at the bulk price and reports success', () => {
    const ctx = ctxWithWarehouse();
    const r = buyCommand(ctx, [], { explosive: 'boomite', kg: '100' });
    expect(r.success).toBe(true);
    expect(ctx.state!.cash).toBeCloseTo(100_000 - 840, 6);
    expect(getExplosivesInStock(ctx.state!.buildings, 'boomite')).toBe(100);
    expect(r.output).not.toMatch(/mining\./);
    expect(r.output).toContain('100');
  });

  it('prints usage and changes nothing without kg', () => {
    const ctx = ctxWithWarehouse();
    const r = buyCommand(ctx, [], { explosive: 'boomite' });
    expect(r.success).toBe(false);
    expect(r.output).not.toMatch(/^mining\./);
    expect(r.output.length).toBeGreaterThan(0);
    expect(ctx.state!.cash).toBe(100_000);
  });

  it('refuses a non-numeric kg', () => {
    const ctx = ctxWithWarehouse();
    expect(buyCommand(ctx, [], { explosive: 'boomite', kg: 'lots' }).success).toBe(false);
    expect(ctx.state!.cash).toBe(100_000);
  });

  it('refuses with no warehouse', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
    const cash = ctx.state!.cash;
    const r = buyCommand(ctx, [], { explosive: 'boomite', kg: '10' });
    expect(r.success).toBe(false);
    expect(r.output).not.toMatch(/mining\./);
    expect(ctx.state!.cash).toBe(cash);
  });

  it('refuses beyond capacity', () => {
    const ctx = ctxWithWarehouse(1_000_000);
    const r = buyCommand(ctx, [], { explosive: 'boomite', kg: '501' });
    expect(r.success).toBe(false);
    expect(ctx.state!.cash).toBe(1_000_000);
    expect(getExplosivesInStock(ctx.state!.buildings)).toBe(0);
  });

  it('refuses on insufficient funds', () => {
    const ctx = ctxWithWarehouse(10);
    expect(buyCommand(ctx, [], { explosive: 'boomite', kg: '100' }).success).toBe(false);
    expect(ctx.state!.cash).toBe(10);
  });

  it('refuses an unknown explosive', () => {
    const ctx = ctxWithWarehouse();
    const r = buyCommand(ctx, [], { explosive: 'nope', kg: '10' });
    expect(r.success).toBe(false);
    expect(r.output).not.toMatch(/^mining\./);
  });

  it('refuses without a game', () => {
    expect(buyCommand(makeEmptyGameContext(), [], { explosive: 'boomite', kg: '10' }).success).toBe(false);
  });
});

describe('buy amount:<n> still buys tubing', () => {
  it('adds tubing inventory and charges tubing price, not stock', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
    const s = ctx.state!;
    const cash = s.cash;
    const r = buyCommand(ctx, [], { amount: '5' });
    expect(r.success).toBe(true);
    expect(s.tubingState.inventory).toBe(5);
    expect(s.cash).toBeLessThan(cash);
  });

  it('is unaffected by an existing warehouse', () => {
    const ctx = ctxWithWarehouse();
    buyCommand(ctx, [], { amount: '5' });
    expect(ctx.state!.tubingState.inventory).toBe(5);
    expect(getExplosivesInStock(ctx.state!.buildings)).toBe(0);
  });
});
