// BlastSimulator2026 — console: board status | start (#1946)

import { describe, it, expect } from 'vitest';
import { boardCommand } from '../../../src/console/commands/board.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { makeGameContext, makeEmptyGameContext } from '../../helpers/gameContext.js';
import { createBoardState, recordBoardOre } from '../../../src/core/economy/Board.js';
import { addIncome, getOperatingProfit } from '../../../src/core/economy/Finance.js';
import { BOARD_QUARTER_TICKS } from '../../../src/core/config/balance.js';

function withBoard() {
  const ctx = makeGameContext({ seed: 42 });
  ctx.state!.board = createBoardState({ quarterTicks: 720, oreTargetT: 20, profitTarget: 5000 }, ctx.state!.tickCount);
  return ctx;
}

describe('board status', () => {
  it('fails without a board', () => {
    const ctx = makeGameContext({ seed: 42 });
    const res = boardCommand(ctx, ['status'], {});
    expect(res.success).toBe(false);
    expect(res.output.length).toBeGreaterThan(0);
  });

  it('fails without a game', () => {
    const res = boardCommand(makeEmptyGameContext(), ['status'], {});
    expect(res.success).toBe(false);
  });

  it('defaults to status when no subcommand is given', () => {
    const ctx = withBoard();
    expect(boardCommand(ctx, [], {}).success).toBe(true);
  });

  it('shows confidence, days left, targets and the current quarter', () => {
    const ctx = withBoard();
    const res = boardCommand(ctx, ['status'], {});
    expect(res.success).toBe(true);
    expect(res.output).toContain('60'); // confidence
    expect(res.output).toContain('30'); // 720 ticks = 30 days left
    expect(res.output).toContain('20'); // ore target t
    expect(res.output).toMatch(/5,?000/); // profit target
    expect(res.output).toMatch(/1/); // quarter
  });

  it('shows ore and profit progress toward the targets', () => {
    const ctx = withBoard();
    recordBoardOre(ctx.state!.board, 'ore_sale', 7500);
    addIncome(ctx.state!.finances, 1234, 'sales', 'ore', 1);
    const res = boardCommand(ctx, ['status'], {});
    expect(res.output).toMatch(/7\.5/);
    expect(res.output).toMatch(/1,?234/);
  });

  it('counts down the days left as ticks pass', () => {
    const ctx = withBoard();
    ctx.state!.tickCount += 720 - 24 * 12; // 12 days left
    const res = boardCommand(ctx, ['status'], {});
    expect(res.output).toMatch(/\b12\b/);
  });

  it('shows the last dividend', () => {
    const ctx = withBoard();
    ctx.state!.board!.lastDividend = 12_345;
    expect(boardCommand(ctx, ['status'], {}).output).toMatch(/12,?345/);
  });

  it('does not mutate the game', () => {
    const ctx = withBoard();
    const before = JSON.stringify(ctx.state!.board);
    boardCommand(ctx, ['status'], {});
    expect(JSON.stringify(ctx.state!.board)).toBe(before);
  });
});

describe('board start', () => {
  it('attaches a board with the named config', () => {
    const ctx = makeGameContext({ seed: 42 });
    const res = boardCommand(ctx, ['start'], { quarterTicks: '48', ore: '1', profit: '1000' });
    expect(res.success).toBe(true);
    const b = ctx.state!.board!;
    expect(b.config).toMatchObject({ quarterTicks: 48, oreTargetT: 1, profitTarget: 1000 });
    expect(b.quarter).toBe(1);
    expect(b.confidence).toBe(60);
  });

  it('starts the quarter at the current tick and profit', () => {
    const ctx = makeGameContext({ seed: 42 });
    ctx.state!.tickCount = 37;
    addIncome(ctx.state!.finances, 900, 'sales', 'ore', 1);
    boardCommand(ctx, ['start'], { quarterTicks: '48', ore: '1', profit: '1000' });
    expect(ctx.state!.board!.quarterStartTick).toBe(37);
    expect(ctx.state!.board!.profitAtQuarterStart).toBe(getOperatingProfit(ctx.state!.finances));
  });

  it('falls back to the default quarter length when quarterTicks is omitted', () => {
    const ctx = makeGameContext({ seed: 42 });
    expect(boardCommand(ctx, ['start'], { ore: '5', profit: '500' }).success).toBe(true);
    expect(ctx.state!.board!.config.quarterTicks).toBe(BOARD_QUARTER_TICKS);
  });

  it('refuses when a board already exists and leaves it untouched', () => {
    const ctx = withBoard();
    ctx.state!.board!.confidence = 33;
    const res = boardCommand(ctx, ['start'], { quarterTicks: '48', ore: '1', profit: '1000' });
    expect(res.success).toBe(false);
    expect(ctx.state!.board!.confidence).toBe(33);
    expect(ctx.state!.board!.config.quarterTicks).toBe(720);
  });

  it('refuses after the level ended', () => {
    const ctx = makeGameContext({ seed: 42 });
    ctx.state!.levelEnded = true;
    const res = boardCommand(ctx, ['start'], { quarterTicks: '48', ore: '1', profit: '1000' });
    expect(res.success).toBe(false);
    expect(ctx.state!.board).toBeUndefined();
  });

  it('refuses without a game', () => {
    expect(boardCommand(makeEmptyGameContext(), ['start'], {}).success).toBe(false);
  });

  it('then status works', () => {
    const ctx = makeGameContext({ seed: 42 });
    boardCommand(ctx, ['start'], { quarterTicks: '48', ore: '1', profit: '1000' });
    const res = boardCommand(ctx, ['status'], {});
    expect(res.success).toBe(true);
    expect(res.output).toContain('60');
  });
});

describe('board — unknown subcommand', () => {
  it('fails and changes nothing', () => {
    const ctx = makeGameContext({ seed: 42 });
    expect(boardCommand(ctx, ['frobnicate'], {}).success).toBe(false);
    expect(ctx.state!.board).toBeUndefined();
  });
});

describe('board — through the runner', () => {
  it('is registered and parses start arguments', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(runner.run('board status').success).toBe(false);
    expect(runner.run('board start quarterTicks:48 ore:1 profit:1000').success).toBe(true);
    expect(ctx.state!.board!.config.quarterTicks).toBe(48);
    expect(runner.run('board status').success).toBe(true);
  });
});
