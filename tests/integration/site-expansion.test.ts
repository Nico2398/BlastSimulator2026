// Site expansion through the console commands (#473 P2) — an off-site action
// either grows the site or says why it cannot, and never silently no-ops.

import { describe, it, expect, beforeEach } from 'vitest';
import { newGameCommand, type GameContext } from '../../src/console/commands/world.js';
import { drillPlanCommand, buildRampCommand, type MiningContext } from '../../src/console/commands/mining.js';
import { buildCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { createTubingState } from '../../src/core/mining/Tubing.js';

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null, grid: null, landscape: null, playableArea: null,
    softwareTier: 0, tubingState: createTubingState(), emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32', cash: '500000' });
  return ctx;
}

describe('site expansion — drill plans', () => {
  let ctx: MiningContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('claims the chunk under a hole added past the east edge', () => {
    const result = drillPlanCommand(ctx, ['add'], { x: '34', z: '10' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(34, 10)).toBe(true);
    expect(ctx.grid!.maxX).toBe(48);
  });

  it('claims westward, giving the site a negative origin', () => {
    const result = drillPlanCommand(ctx, ['add'], { x: '-4', z: '10' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.minX).toBe(-16);
    expect(ctx.state!.world!.minX).toBe(-16);
    expect(ctx.state!.world!.sizeX).toBe(48);
  });

  it('rebuilds the navgrid over the site\'s new bounding box', () => {
    drillPlanCommand(ctx, ['add'], { x: '-4', z: '10' });
    const nav = ctx.state!.navGrid!;
    expect(nav.originX).toBe(-16);
    expect(nav.width).toBe(48);
    expect(nav.cellAt(-4, 10)).toBeDefined();
    expect(nav.cellAt(-4, 10)!.type).not.toBe('void');
  });

  it('leaves the generation datum alone, so later chunks match the level', () => {
    drillPlanCommand(ctx, ['add'], { x: '34', z: '10' });
    expect(ctx.state!.world!.baseSizeX).toBe(32);
    expect(ctx.state!.world!.baseSizeZ).toBe(32);
  });

  it('refuses a grid plan that reaches ground touching no part of the site', () => {
    const result = drillPlanCommand(ctx, ['grid'], { origin: '400,400', rows: '2', cols: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot drill');
    expect(ctx.state!.drillHoles).toHaveLength(0);
  });

  it('leaves the plan untouched when the claim is refused', () => {
    drillPlanCommand(ctx, ['grid'], { origin: '4,4', rows: '2', cols: '2' });
    const before = ctx.state!.drillHoles.length;
    drillPlanCommand(ctx, ['grid'], { origin: '400,400', rows: '2', cols: '2' });
    expect(ctx.state!.drillHoles).toHaveLength(before);
  });
});

describe('site expansion — buildings and ramps', () => {
  let ctx: MiningContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('claims the ground a building straddling the edge needs', () => {
    // A 2x2 footprint at x=31 reaches x=32, one metre past the 32 m site.
    const result = buildCommand(ctx, ['management_office'], { at: '31,10' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(32, 10)).toBe(true);
  });

  it('places a building on freshly claimed ground', () => {
    const result = buildCommand(ctx, ['management_office'], { at: '34,10' });
    expect(result.success).toBe(true);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    expect(ctx.grid!.maxX).toBe(48);
  });

  it('claims the ground a ramp runs onto before cutting it', () => {
    const result = buildRampCommand(ctx, [], { origin: '30,10', direction: 'east', length: '8' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(38, 10)).toBe(true);
  });
});

describe('site expansion — the site keeps its shape after growing', () => {
  it('grows only in the direction play asked for', () => {
    const ctx = makeCtx();
    drillPlanCommand(ctx, ['add'], { x: '34', z: '10' });

    // One chunk east, nothing north or west.
    expect(ctx.grid!.minX).toBe(0);
    expect(ctx.grid!.minZ).toBe(0);
    expect(ctx.grid!.maxX).toBe(48);
    expect(ctx.grid!.maxZ).toBe(32);
    expect(ctx.grid!.chunkCount).toBe(5);
  });

  it('marks columns inside the bounding box but outside the claimed set as void', () => {
    const ctx = makeCtx();
    // Claim (2, 0) only — (2, 1) stays unclaimed inside the squared-off box.
    drillPlanCommand(ctx, ['add'], { x: '34', z: '4' });

    expect(ctx.grid!.containsColumn(34, 20)).toBe(false);
    expect(ctx.state!.navGrid!.cellAt(34, 20)!.type).toBe('void');
  });
});
