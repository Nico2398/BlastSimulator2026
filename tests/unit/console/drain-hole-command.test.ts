// BlastSimulator2026 — drain_hole console command + weather override (#1350)

import { describe, it, expect } from 'vitest';
import { drainHoleCommand, weatherCommand } from '../../../src/console/commands/mining.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { HOLE_DRAIN_COST_PER_HOLE } from '../../../src/core/config/balance.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

function ctxWithHoles(): MiningContext {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
  const s = ctx.state!;
  s.cash = 1000;
  s.drillHoles = ['hole_1', 'hole_2', 'hole_3'].map(id => ({ id, x: 0, z: 0, depth: 8, diameter: 0.15 }));
  s.holeWater = {
    hole_1: { level: 0.9, porosity: 0.03 },
    hole_2: { level: 0.9, porosity: 0.35 },
    hole_3: { level: 0, porosity: 0.03 },
  };
  return ctx;
}

describe('drain_hole', () => {
  it('requires a game and a hole argument', () => {
    expect(drainHoleCommand(makeEmptyGameContext(), [], { hole: 'hole_1' }).success).toBe(false);
    expect(drainHoleCommand(ctxWithHoles(), [], {}).success).toBe(false);
  });

  it('drains one wet hole and charges the cost', () => {
    const ctx = ctxWithHoles();
    const r = drainHoleCommand(ctx, [], { hole: 'hole_1' });
    expect(r.success).toBe(true);
    expect(ctx.state!.holeWater['hole_1']!.level).toBe(0);
    expect(ctx.state!.cash).toBe(1000 - HOLE_DRAIN_COST_PER_HOLE);
    expect(r.output).not.toMatch(/mining\.drain/);
  });

  it('accepts a bare numeric id', () => {
    const ctx = ctxWithHoles();
    expect(drainHoleCommand(ctx, [], { hole: '1' }).success).toBe(true);
  });

  it('refuses a single dry, porous or unknown hole with a localized message', () => {
    const ctx = ctxWithHoles();
    for (const hole of ['hole_3', 'hole_2', 'hole_99']) {
      const r = drainHoleCommand(ctx, [], { hole });
      expect(r.success).toBe(false);
      expect(r.output).not.toMatch(/mining\.drain/);
      expect(r.output.length).toBeGreaterThan(0);
    }
    expect(ctx.state!.cash).toBe(1000);
  });

  it('batch drains the drainable wet holes and names the blocked ones', () => {
    const ctx = ctxWithHoles();
    const r = drainHoleCommand(ctx, [], { hole: '*' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('hole_1');
    expect(r.output).toContain('hole_2');
    expect(ctx.state!.holeWater['hole_1']!.level).toBe(0);
    expect(ctx.state!.holeWater['hole_2']!.level).toBe(0.9);
  });

  it('batch with nothing wet fails', () => {
    const ctx = ctxWithHoles();
    ctx.state!.holeWater = {};
    expect(drainHoleCommand(ctx, [], { hole: '*' }).success).toBe(false);
  });
});

describe('weather set and standing water', () => {
  it('forcing weather changes the weather but never wipes standing water or ground wetness', () => {
    const ctx = ctxWithHoles();
    ctx.state!.groundWetness = 0.8;
    weatherCommand(ctx, ['set', 'storm'], {});
    expect(ctx.state!.holeWater['hole_1']!.level).toBe(0.9);
    weatherCommand(ctx, ['set', 'sunny'], {});
    expect(ctx.state!.weather.current).toBe('sunny');
    expect(ctx.state!.holeWater['hole_1']!.level).toBe(0.9);
    expect(ctx.state!.holeWater['hole_2']!.level).toBe(0.9);
    expect(ctx.state!.groundWetness).toBe(0.8);
  });
});
