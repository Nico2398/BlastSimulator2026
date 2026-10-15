// BlastSimulator2026 — idle crew and parked trucks must not stall drilling (#1696).
// A fresh staffed sandbox drills a 3x3 plan completely without anyone being
// moved by hand (the crew spawns bunched around a parked charging truck).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';

const DRILL_BUDGET_TICKS = 600;

describe('sandbox drilling is not stalled by idle crew (#1696)', () => {
  for (const [biome, seed] of [['red_canyon', 7], ['red_canyon', 2], ['alpine_granite', 1], ['tropical_karst', 3]] as const) {
    it(`${biome} seed ${seed}: all 9 holes of a 3x3 plan are drilled within ${DRILL_BUDGET_TICKS} ticks`, () => {
      const { runner, ctx } = createRunner();
      expect(runner.run(`sandbox start biome:${biome} difficulty:easy seed:${seed}`).success).toBe(true);
      expect(runner.run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:16,16').success).toBe(true);
      const state = ctx.state!;
      let ticks = 0;
      while (ticks < DRILL_BUDGET_TICKS && state.drillHoles.length < 9) {
        runner.run('tick 1');
        ticks++;
      }
      expect(state.drillHoles).toHaveLength(9);
    });
  }
});
