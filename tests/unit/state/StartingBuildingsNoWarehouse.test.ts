// BlastSimulator2026 — No starting kit or site holds an explosive warehouse; safety is not pulled below neutral by one (#2154)

import { describe, it, expect } from 'vitest';
import { SANDBOX_STARTING_SITES } from '../../../src/core/config/balance.js';
import * as balance from '../../../src/core/config/balance.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { getBuildingScoreEffects } from '../../../src/core/entities/Building.js';
import { createScoreState, updateScores, safetyTarget } from '../../../src/core/scores/ScoreManager.js';

const GONE = 'explosive_warehouse';

describe('starting compositions hold no explosive warehouse (#2154)', () => {
  it.each(['digger', 'full'] as const)('the %s sandbox kit has no explosive_warehouse slot', (kit) => {
    for (const slot of SANDBOX_STARTING_SITES[kit].buildings) {
      expect(slot.type as string).not.toBe(GONE);
    }
  });

  it('every exported StartingSiteComposition in balance.ts names no explosive_warehouse', () => {
    for (const [name, value] of Object.entries(balance)) {
      if (value && typeof value === 'object' && 'buildings' in (value as object) && 'employees' in (value as object)) {
        const buildings = (value as { buildings: ReadonlyArray<{ type: string }> }).buildings;
        for (const slot of buildings) expect(slot.type, name).not.toBe(GONE);
      }
    }
  });

  it('both sandbox kits keep the freight warehouse and spoil heap', () => {
    for (const kit of ['digger', 'full'] as const) {
      const types = SANDBOX_STARTING_SITES[kit].buildings.map((b) => b.type as string);
      expect(types, kit).toContain('freight_warehouse');
      expect(types, kit).toContain('spoil_heap');
    }
  });
});

describe('fresh games start with no explosive warehouse (#2154)', () => {
  it('createGame places none', () => {
    const state = createGame({ seed: 42 });
    expect(state.buildings.buildings.filter((b) => (b.type as string) === GONE)).toEqual([]);
  });

  it.each(['digger', 'full'] as const)('sandbox start kit:%s places none', (kit) => {
    const { runner, ctx } = createRunner();
    expect(runner.run(`sandbox start biome:desert_badlands kit:${kit} seed:42`).success).toBe(true);
    const types = ctx.state!.buildings.buildings.map((b) => b.type as string);
    expect(types).not.toContain(GONE);
    expect(types).toContain('freight_warehouse');
  });

  it('the tutorial level starts with none', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    expect(ctx.state!.buildings.buildings.filter((b) => (b.type as string) === GONE)).toEqual([]);
  });

  it('the console refuses to build the removed type', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    const before = ctx.state!.buildings.buildings.length;
    expect(runner.run(`build ${GONE} at:7,11`).success).toBe(false);
    expect(ctx.state!.buildings.buildings.length).toBe(before);
  });
});

describe('the default sandbox site lowers no safety target (#2154)', () => {
  const NEUTRAL_TARGET_FLOOR = 38; // base 50 - 12 * one tier-1 magazine

  it('the starting buildings sum to a non-negative safety effect', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    expect(getBuildingScoreEffects(ctx.state!.buildings).safety).toBeGreaterThanOrEqual(0);
  });

  it('the safety target of the starting site is above 38', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    const effects = getBuildingScoreEffects(ctx.state!.buildings);
    expect(safetyTarget(effects.safety, false)).toBeGreaterThan(NEUTRAL_TARGET_FLOOR);
  });

  it('safety settles above 38 when the starting site is left alone', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    const buildings = ctx.state!.buildings;
    const scores = createScoreState();
    for (let i = 0; i < 5000; i++) {
      updateScores(scores, {
        buildings, avgMorale: 50, recentAccidents: 0, hasSafetyEquipment: false, maxRecentVibration: 0,
        employeeCount: 0, looseRockKg: 0, bedCapacity: 0, crewFatigueStrain: 0,
      });
    }
    expect(scores.safety).toBeGreaterThan(NEUTRAL_TARGET_FLOOR);
  });
});
