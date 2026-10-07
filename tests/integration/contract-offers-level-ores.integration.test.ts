// BlastSimulator2026 — Integration: contract offers only ask for ores the active level's rocks can yield (#1364).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';

const LEVEL1_ORES = ['dirtite', 'rustite', 'blingite'];
const OUT_OF_LEVEL_ORES = ['gloomium', 'sparkium', 'craktonite', 'absurdium', 'treranium'];

describe('contract offers are limited to the level ores (#1364)', () => {
  for (const seed of [1, 7, 42, 99, 1234]) {
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
    expect(runner.run('campaign start level:dusty_hollow').success).toBe(true);
    for (const c of ctx.state!.contracts.available) {
      if (c.type !== 'rubble_disposal') expect(LEVEL1_ORES).toContain(c.materialId);
    }
  });
});
