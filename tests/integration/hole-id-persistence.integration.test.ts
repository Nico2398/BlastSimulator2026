// BlastSimulator2026 — Integration tests: hole ids stay unique across save/load (#1352)
//
// The hole id counter was module-level, so a reload (or a second game) restarted
// it at H1 and `drill_plan add` could hand out an id a drilled hole already held.
// The counter now lives on GameState.nextHoleId and is saved.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { DrillHole } from '../../src/core/mining/DrillPlan.js';

const hole = (id: string, x: number, z: number): DrillHole => ({ id, x, z, depth: 8, diameter: 0.15 });

function newGame() {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  return { runner, ctx };
}

function allIds(ctx: ReturnType<typeof createRunner>['ctx']): string[] {
  return [...ctx.state!.drillHoles, ...ctx.state!.plannedDrillHoles].map(h => h.id);
}

describe('hole id uniqueness (#1352)', () => {
  it('a new game starts with nextHoleId 1', () => {
    const { ctx } = newGame();
    expect(ctx.state!.nextHoleId).toBe(1);
  });

  it('survives save+load: next added hole is H4, no duplicate ids', () => {
    const { runner, ctx } = newGame();
    ctx.state!.drillHoles.push(hole('H1', 10, 10), hole('H2', 14, 10), hole('H3', 18, 10));
    ctx.state!.nextHoleId = 4;
    expect(runner.run('save slot:h1352').success).toBe(true);
    expect(runner.run('load slot:h1352').success).toBe(true);

    expect(ctx.state!.nextHoleId).toBe(4);
    const result = runner.run('drill_plan add x:30 z:30');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Added hole H4');

    const ids = allIds(ctx);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('charge hole:H1 is unambiguous after a reload and a further add', () => {
    const { runner, ctx } = newGame();
    ctx.state!.drillHoles.push(hole('H1', 10, 10), hole('H2', 14, 10), hole('H3', 18, 10));
    ctx.state!.nextHoleId = 4;
    runner.run('save slot:h1352b');
    runner.run('load slot:h1352b');
    runner.run('drill_plan add x:30 z:30');

    expect(ctx.state!.drillHoles.filter(h => h.id === 'H1')).toHaveLength(1);
    expect(allIds(ctx).filter(id => id === 'H1')).toHaveLength(1);
    const result = runner.run('charge hole:H1 explosive:boomite amount:5 stemming:2');
    expect(result.output).not.toMatch(/ambiguous|duplicate/i);
  });

  it('regression: fresh state with drilled H1 and nextHoleId 1 never re-issues H1', () => {
    const { runner, ctx } = newGame();
    ctx.state!.drillHoles.push(hole('H1', 10, 10));
    expect(ctx.state!.nextHoleId).toBe(1);

    const result = runner.run('drill_plan add x:30 z:30');
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('Added hole H1 ');
    expect(result.output).toContain('Added hole H2');
    const ids = allIds(ctx);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sequential drill_plan add commands give unique increasing ids', () => {
    const { runner, ctx } = newGame();
    for (const x of [10, 14, 18]) expect(runner.run(`drill_plan add x:${x} z:10`).success).toBe(true);
    expect(ctx.state!.plannedDrillHoles.map(h => h.id)).toEqual(['H1', 'H2', 'H3']);
    expect(ctx.state!.nextHoleId).toBe(4);
  });

  it('removing the highest hole does not reuse its id', () => {
    const { runner, ctx } = newGame();
    for (const x of [10, 14]) runner.run(`drill_plan add x:${x} z:10`);
    runner.run('drill_plan clear');
    const result = runner.run('drill_plan add x:10 z:10');
    expect(result.output).toContain('Added hole H3');
  });

  it('drill_plan grid still numbers H1..Hn after clearing', () => {
    const { runner, ctx } = newGame();
    runner.run('drill_plan add x:10 z:10');
    runner.run('drill_plan add x:14 z:10');
    expect(runner.run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(ctx.state!.plannedDrillHoles.map(h => h.id)).toEqual(['H1', 'H2', 'H3', 'H4']);
    expect(ctx.state!.nextHoleId).toBe(5);
  });

  it('a refused grid claim leaves nextHoleId unchanged', () => {
    const { runner, ctx } = newGame();
    runner.run('drill_plan add x:10 z:10');
    const before = ctx.state!.nextHoleId;
    const result = runner.run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:9999,9999');
    expect(result.success).toBe(false);
    expect(ctx.state!.nextHoleId).toBe(before);
  });

  it('a second game does not inherit the first game counter', () => {
    const { runner, ctx } = newGame();
    runner.run('drill_plan add x:10 z:10');
    runner.run('drill_plan add x:14 z:10');
    expect(runner.run('new_game seed:7 size:32 staffed:true').success).toBe(true);
    expect(ctx.state!.nextHoleId).toBe(1);
    expect(runner.run('drill_plan add x:10 z:10').output).toContain('Added hole H1');
  });
});
