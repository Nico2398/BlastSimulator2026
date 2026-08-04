// BlastSimulator2026 — build command unit tests (CH1.7)
// Tests tier placement, upgrade, and demolish-with-cost behaviour.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { buildCommand } from '../../../src/console/commands/entities.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  // These tests exercise tier placement/upgrade mechanics directly, not the
  // research gate — pre-unlock every tier so placement isn't blocked.
  ctx.state!.buildings.unlockedTiers.management_office = 3;
  return ctx;
}

describe('build command — tier placement', () => {
  it('places a T1 building by default', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('T1');
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
  });

  it('places a T2 building when tier:2 is supplied', () => {
    const ctx = makeCtx();
    // #410: tier 2+ placement is gated on Research Center unlock — pre-unlock so
    // this test still exercises tier placement, not the research gate itself.
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    const result = buildCommand(ctx, ['management_office'], { at: '0,0', tier: '2' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('T2');
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(2);
  });

  it('places a T3 building when tier:3 is supplied', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    const result = buildCommand(ctx, ['management_office'], { at: '0,0', tier: '3' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('T3');
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(3);
  });

  it('deducts the correct construction cost for the chosen tier', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    const cashBefore = ctx.state!.cash;
    buildCommand(ctx, ['management_office'], { at: '0,0', tier: '2' });
    const def = getBuildingDef('management_office', 2);
    expect(ctx.state!.cash).toBe(cashBefore - def.constructionCost);
  });

  it('treats an invalid tier param as tier 1', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: '0,0', tier: '9' });
    expect(result.success).toBe(true);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
  });
});

describe('build command — upgrade', () => {
  let ctx: MiningContext;
  beforeEach(() => {
    ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '0,0' });
  });

  it('upgrades a T1 building to T2 and returns a new ID', () => {
    // #410: research-gated — unlock tier 2 for management_office before upgrading.
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    const originalId = ctx.state!.buildings.buildings[0]!.id;
    const result = buildCommand(ctx, ['upgrade', String(originalId)], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('T2');
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(2);
  });

  it('deducts demolish + construction cost on upgrade', () => {
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    const b = ctx.state!.buildings.buildings[0]!;
    const cashBefore = ctx.state!.cash;
    const oldDef = getBuildingDef(b.type, b.tier);
    const newDef = getBuildingDef(b.type, 2);
    buildCommand(ctx, ['upgrade', String(b.id)], {});
    expect(ctx.state!.cash).toBe(cashBefore - (oldDef.demolishCost + newDef.constructionCost));
  });

  it('rejects upgrade of a T3 building', () => {
    // Research-gated: unlock tiers 2 and 3 so the setup upgrades (T1→T2→T3)
    // succeed, leaving only the max-tier rejection under test.
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    // upgrade to T2 then T3
    const id1 = ctx.state!.buildings.buildings[0]!.id;
    buildCommand(ctx, ['upgrade', String(id1)], {});
    const id2 = ctx.state!.buildings.buildings[0]!.id;
    buildCommand(ctx, ['upgrade', String(id2)], {});
    const id3 = ctx.state!.buildings.buildings[0]!.id;
    const result = buildCommand(ctx, ['upgrade', String(id3)], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('T3');
  });

  it('returns error for unknown building ID on upgrade', () => {
    const result = buildCommand(ctx, ['upgrade', '9999'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });
});

// ── build command — research gate (#410) ──────────────────────────────────

describe('build command — research gate', () => {
  it('rejects direct T2 placement when the tier has not been researched', () => {
    const ctx = makeCtx();
    // makeCtx() pre-unlocks every tier for the other suites; re-lock here so
    // this test exercises the unresearched state it claims to.
    ctx.state!.buildings.unlockedTiers.management_office = 1;
    const result = buildCommand(ctx, ['management_office'], { at: '0,0', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('rejects upgrade past T1 when the tier has not been researched', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers.management_office = 1;
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    const id = ctx.state!.buildings.buildings[0]!.id;

    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
  });
});

describe('build command — demolish with cost', () => {
  it('deducts demolish cost and removes the building', () => {
    const ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    const b = ctx.state!.buildings.buildings[0]!;
    const cashBefore = ctx.state!.cash;
    const def = getBuildingDef(b.type, b.tier);
    const result = buildCommand(ctx, ['destroy', String(b.id)], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('demolished');
    expect(ctx.state!.buildings.buildings.length).toBe(0);
    expect(ctx.state!.cash).toBe(cashBefore - def.demolishCost);
  });

  it('returns error for unknown building ID on destroy', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['destroy', '9999'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });
});
