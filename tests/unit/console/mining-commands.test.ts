import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import {
  blastPlanCommand,
  buySoftwareCommand,
  drillPlanCommand,
} from '../../../src/console/commands/mining.js';
import { createTubingState } from '../../../src/core/mining/Tubing.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';

function makeMiningContext(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    softwareTier: 0,
    tubingState: createTubingState(),
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  return ctx;
}

beforeEach(() => resetHoleIds());

// ── blast_plan list ──────────────────────────────────────────────────────────

describe('blast_plan list', () => {
  it('returns "No saved plans." when no plans have been saved', () => {
    const ctx = makeMiningContext();
    const result = blastPlanCommand(ctx, ['list'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe('No saved plans.');
  });

  it('lists plan names after saving one', () => {
    const ctx = makeMiningContext();
    // Create a minimal drill plan so save has something to store
    drillPlanCommand(ctx, ['grid'], { rows: '2', cols: '2', spacing: '3', depth: '6' });
    blastPlanCommand(ctx, ['save'], { name: 'alpha' });

    const result = blastPlanCommand(ctx, ['list'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Saved plans:');
    expect(result.output).toContain('  alpha');
  });

  it('lists multiple saved plan names', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '2', cols: '2', spacing: '3', depth: '6' });
    blastPlanCommand(ctx, ['save'], { name: 'plan-a' });
    blastPlanCommand(ctx, ['save'], { name: 'plan-b' });

    const result = blastPlanCommand(ctx, ['list'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('  plan-a');
    expect(result.output).toContain('  plan-b');
  });

  it('usage error mentions list subcommand', () => {
    const ctx = makeMiningContext();
    const result = blastPlanCommand(ctx, ['unknown'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('list');
  });
});

// ── buy_software tier validation ─────────────────────────────────────────────

describe('buy_software tier validation', () => {
  it('no tier arg buys the next tier (tier 0 → tier 1)', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('tier 1');
    expect(ctx.softwareTier).toBe(1);
  });

  it('tier:1 when at tier 0 succeeds', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], { tier: '1' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('tier 1');
    expect(ctx.softwareTier).toBe(1);
  });

  it('tier:2 when at tier 0 returns error "Must purchase tier 1 first"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], { tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Must purchase tier 1 first');
  });

  it('tier:4 when at tier 0 returns error "Must purchase tier 1 first"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], { tier: '4' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Must purchase tier 1 first');
  });

  it('tier:1 when already at tier 1 returns error "Already at tier 1 or higher"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    ctx.softwareTier = 1;
    const result = buySoftwareCommand(ctx, [], { tier: '1' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Already at tier 1 or higher');
  });

  it('tier:0 when at tier 1 returns error "Already at tier 0 or higher"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    ctx.softwareTier = 1;
    const result = buySoftwareCommand(ctx, [], { tier: '0' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Already at tier');
  });
});
