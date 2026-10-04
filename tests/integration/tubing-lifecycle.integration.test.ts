// BlastSimulator2026 — Tubing lifecycle through the real console runner (#1351).
// Tubing records must follow the hole: a blast, `drill_plan clear` and
// `drill_plan remove` drop them; unknown/bare install_tubing is refused.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';

const GRID = 'drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12';

function drive(runner: ConsoleRunner, ctx: GameContext, done: () => boolean, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && !done(); i++) {
    for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
    runner.run('tick 1');
  }
}

function drilledGame() {
  const game = createRunner();
  game.runner.run('new_game seed:42 staffed:true');
  game.runner.run(GRID);
  drive(game.runner, game.ctx, () => game.ctx.state!.plannedDrillHoles.length === 0);
  expect(game.ctx.state!.drillHoles.length).toBe(6);
  return game;
}

describe('tubing lifecycle via console (#1351)', () => {
  it('blast drops tubing: next grid plan has no tubed holes', () => {
    const game = drilledGame();
    const { runner, ctx } = game;
    const firstId = ctx.state!.drillHoles[0]!.id;
    expect(runner.run('buy amount:2').success).toBe(true);
    expect(runner.run(`install_tubing hole:${firstId}`).success).toBe(true);
    expect(ctx.state!.tubingState.installedHoles.has(firstId)).toBe(true);

    runner.run('charge hole:* explosive:boomite amount:8 stemming:2');
    drive(runner, ctx, () => Object.keys(ctx.state!.plannedChargesByHole).length === 0);
    runner.run('sequence auto delay_step:25');
    expect(runner.run('blast').success).toBe(true);
    expect(ctx.state!.tubingState.installedHoles.size).toBe(0);
    expect(ctx.state!.tubingState.inventory).toBe(1);

    expect(runner.run(GRID).success).toBe(true);
    // Hole ids restart after a blast: the new first ordered hole reuses the
    // tubed id and must come up untubed. (Post-blast debris keeps the new
    // drill orders queued, so assert on the ordered holes, not drilled ones.)
    const newFirstId = ctx.state!.plannedDrillHoles[0]!.id;
    const tubing = ctx.state!.tubingState;
    expect(newFirstId).toBe(firstId);
    expect(tubing.installedHoles.has(newFirstId)).toBe(false);
    expect(tubing.installedHoles.size).toBe(0);
    expect(tubing.inventory).toBe(1);
  });

  it('drill_plan clear drops tubing, inventory unchanged', () => {
    const { runner, ctx } = drilledGame();
    const id = ctx.state!.drillHoles[0]!.id;
    runner.run('buy amount:2');
    runner.run(`install_tubing hole:${id}`);
    expect(runner.run('drill_plan clear').success).toBe(true);
    expect(ctx.state!.tubingState.installedHoles.size).toBe(0);
    expect(ctx.state!.tubingState.inventory).toBe(1);
  });

  it('drill_plan remove drops tubing for that hole only, inventory unchanged', () => {
    const { runner, ctx } = drilledGame();
    const [a, b] = ctx.state!.drillHoles.map(h => h.id) as [string, string];
    runner.run('buy amount:3');
    runner.run(`install_tubing hole:${a}`);
    runner.run(`install_tubing hole:${b}`);
    expect(runner.run(`drill_plan remove hole:${a}`).success).toBe(true);
    const tubing = ctx.state!.tubingState;
    expect(tubing.installedHoles.has(a)).toBe(false);
    expect(tubing.installedHoles.has(b)).toBe(true);
    expect(tubing.inventory).toBe(1);
  });

  it('install_tubing on an unknown hole is refused, inventory unchanged', () => {
    const { runner, ctx } = drilledGame();
    runner.run('buy amount:2');
    const result = runner.run('install_tubing hole:NOPE');
    expect(result.success).toBe(false);
    expect(ctx.state!.tubingState.inventory).toBe(2);
    expect(ctx.state!.tubingState.installedHoles.size).toBe(0);
  });

  it('bare install_tubing is refused with usage, inventory unchanged', () => {
    const { runner, ctx } = drilledGame();
    runner.run('buy amount:2');
    const result = runner.run('install_tubing');
    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('usage');
    expect(ctx.state!.tubingState.inventory).toBe(2);
    expect(ctx.state!.tubingState.installedHoles.size).toBe(0);
  });

  it('install_tubing on a known hole still succeeds and consumes one unit', () => {
    const { runner, ctx } = drilledGame();
    const id = ctx.state!.drillHoles[0]!.id;
    runner.run('buy amount:2');
    expect(runner.run(`install_tubing hole:${id}`).success).toBe(true);
    expect(ctx.state!.tubingState.inventory).toBe(1);
  });
});
