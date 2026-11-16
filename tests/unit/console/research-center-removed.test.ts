// BlastSimulator2026 — The Research Center is gone from the console, the tick and the code surface (#2283 C5)

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { createRunner } from '../../../src/console/createRunner.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { Random } from '../../../src/core/math/Random.js';
import * as Building from '../../../src/core/entities/Building.js';
import * as Balance from '../../../src/core/config/balance.js';
import * as ActiveModifiers from '../../../src/core/events/ActiveModifiers.js';

const ROOT = join(import.meta.dirname, '../../..');

describe('the research console command is unknown (#2283 C5)', () => {
  it.each([
    'research status',
    'research queue type:management_office tier:2',
    'research',
  ])('"%s" is refused as an unknown command', (line) => {
    const { runner } = createRunner();
    expect(runner.run('new_game mine_type:desert seed:42').success).toBe(true);
    const r = runner.run(line);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/unknown command/i);
  });

  it('help does not list a research command', () => {
    const { runner } = createRunner();
    expect(runner.run('help').output).not.toMatch(/^\s*research\b/im);
  });

  it('build types lists no research_center, and ordering one is refused', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game mine_type:desert seed:42').success).toBe(true);
    expect(runner.run('build types').output).not.toContain('research_center');
    const cash = ctx.state!.cash;
    const r = runner.run('build research_center at:6,9');
    expect(r.success).toBe(false);
    expect(ctx.state!.cash).toBe(cash);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
  });
});

describe('the tick pipeline no longer runs research (#2283 C5)', () => {
  it('the tick report carries no researchCancelled field', () => {
    const state = createGame({ seed: 42, mineType: 'desert' });
    const report = runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
    expect('researchCancelled' in report).toBe(false);
  });

  it('a building state holds only buildings, the id counter and the unlocked tiers', () => {
    expect(Object.keys(createGame({ seed: 42, mineType: 'desert' }).buildings).sort()).toEqual(['buildings', 'nextId', 'unlockedTiers']);
  });
});

describe('the research code surface is deleted (#2283 C5)', () => {
  it('BuildingResearch.ts no longer exists', () => {
    expect(existsSync(join(ROOT, 'src/core/entities/BuildingResearch.ts'))).toBe(false);
  });

  it('Building exports nothing about research', () => {
    expect(Object.keys(Building).filter(k => /research/i.test(k))).toEqual([]);
  });

  it('balance keeps only the refund table of the old Research Center', () => {
    const names = Object.keys(Balance).filter(k => /research/i.test(k));
    expect(names).toEqual(['RESEARCH_CENTER_REFUND_BY_TIER']);
  });

  it('the refund table holds the three construction costs the migration pays back', () => {
    expect(Balance.RESEARCH_CENTER_REFUND_BY_TIER).toEqual({ 1: 25000, 2: 60000, 3: 120000 });
  });

  it('active modifiers no longer scale a research price', () => {
    expect(Object.keys(ActiveModifiers).filter(k => /research/i.test(k))).toEqual([]);
  });
});
