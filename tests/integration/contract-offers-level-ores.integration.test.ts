// BlastSimulator2026 — Integration: contract offers only ask for ores the active level's rocks can yield (#1364),
// and on a progression site only for the current grade's ores (#2278).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { getOre } from '../../src/core/world/OreCatalog.js';
import { resolveContractOres } from '../../src/core/campaign/Level.js';

const LEVEL1_ORES = ['dirtite', 'rustite', 'blingite'];
const OUT_OF_LEVEL_ORES = ['gloomium', 'sparkium', 'craktonite', 'absurdium', 'treranium'];

describe('contract offers are limited to the level ores (#1364)', () => {
  // Seed 1234 is excluded: new_game's 64-wide desert climate there generates volcanic_flats
  // terrain, whose rocks genuinely host sparkium, so offering it is correct (drift lock, Level.test.ts).
  for (const seed of [1, 7, 42, 99]) {
    it(`fresh Level 1 new_game seed ${seed}: contract list shows no out-of-level ore`, () => {
      const { runner, ctx } = createRunner();
      expect(runner.run(`new_game seed:${seed}`).success).toBe(true);
      const listed = runner.run('contract list');
      expect(listed.success).toBe(true);
      for (const ore of OUT_OF_LEVEL_ORES) expect(listed.output).not.toContain(ore);
      for (const c of ctx.state!.contracts.available) {
        if (c.type !== 'rubble_disposal') expect(LEVEL1_ORES).toContain(c.materialId);
      }
    });
  }

  it('no sparkium after many refresh cycles on Level 1', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    for (let i = 0; i < 40; i++) {
      runner.run('tick 50');
      const listed = runner.run('contract list');
      expect(listed.output).not.toContain('sparkium');
      for (const c of ctx.state!.contracts.available) {
        if (c.type !== 'rubble_disposal') expect(LEVEL1_ORES).toContain(c.materialId);
      }
    }
  });

  it('campaign start level:tutorial_pit offers only level-1 ores', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    const offers = ctx.state!.contracts.available;
    expect(offers.length).toBeGreaterThan(0);
    for (const c of offers) {
      if (c.type !== 'rubble_disposal') expect(LEVEL1_ORES).toContain(c.materialId);
    }
  });

  it('campaign start level:dusty_hollow offers only desert ores', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    expect(runner.run('campaign start level:dusty_hollow staffed:false').success).toBe(true);
    for (const c of ctx.state!.contracts.available) {
      if (c.type !== 'rubble_disposal') expect(LEVEL1_ORES).toContain(c.materialId);
    }
  });
});

describe('contract offers follow the current grade on a sandbox site (#2278)', () => {
  const SANDBOX = 'sandbox start biome:desert_badlands kit:full seed:42';

  function offeredOres(grade: number): { ores: Set<string>; site: readonly string[] } {
    const { runner, ctx } = createRunner();
    expect(runner.run(`${SANDBOX} grade:${grade}`).success).toBe(true);
    ctx.state!.events.eventFreqMultiplier = 0; // a pending event halts `tick`
    const ores = new Set<string>();
    for (let i = 0; i < 40; i++) {
      runner.run('tick 25');
      for (const c of ctx.state!.contracts.available) if (c.type !== 'rubble_disposal') ores.add(c.materialId);
    }
    return { ores, site: resolveContractOres(ctx.state!) };
  }

  it('grade 0 offers only G0 ores, across many refreshes', () => {
    const { ores } = offeredOres(0);
    expect(ores.size).toBeGreaterThan(0);
    for (const ore of ores) expect(getOre(ore)!.permitGrade, ore).toBe(0);
  });

  it('grade 1 offers only G1 ores: rustite and dirtite no longer appear', () => {
    const { ores } = offeredOres(1);
    expect(ores.size).toBeGreaterThan(0);
    for (const ore of ores) expect(getOre(ore)!.permitGrade, ore).toBe(1);
  });

  it('the ores the site offers shift with the grade', () => {
    const g0 = offeredOres(0).site;
    const g1 = offeredOres(1).site;
    expect(g0.length).toBeGreaterThan(0);
    expect(g1.length).toBeGreaterThan(0);
    for (const ore of g0) expect(g1).not.toContain(ore);
  });

  it('`contract list` at grade 1 names no G0 ore', () => {
    const { runner } = createRunner();
    expect(runner.run(`${SANDBOX} grade:1`).success).toBe(true);
    const listed = runner.run('contract list');
    expect(listed.success).toBe(true);
    expect(listed.output).not.toMatch(/dirtite|rustite/i);
  });

  it('a tutorial or campaign site without a mine grade is not grade-restricted (the level ores still hold)', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    expect(ctx.state!.grade).toBeUndefined();
    const ores = new Set(ctx.state!.contracts.available.filter(c => c.type !== 'rubble_disposal').map(c => c.materialId));
    for (const ore of ores) expect(LEVEL1_ORES).toContain(ore);
  });
});
