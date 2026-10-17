// #1838 — same-tick mafia rolls draw independent streams, salted by MafiaState.rollCount.
import { describe, it, expect } from 'vitest';
import { mafiaCommand } from '../../../src/console/commands/mafia.js';
import { makeGameContext, type GameContext } from '../../helpers/gameContext.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { ACCIDENT_COST } from '../../../src/core/events/MafiaActions.js';

function ctxFor(seed: number): { ctx: GameContext; ids: number[] } {
  const ctx = makeGameContext({ mineType: 'desert', seed, size: 24 });
  const s = ctx.state!;
  s.corruption.mafiaUnlocked = true;
  s.cash = 100_000_000;
  s.tickCount = 50;
  const ids = [1, 2].map(i => {
    const e = hireEmployee(s.employees, 'driver', new Random(i), 5, 5).employee;
    e.unionized = false; // framing refuses union members (#1872)
    return e.id;
  });
  return { ctx, ids };
}

describe('mafia accident — roll salt (#1838)', () => {
  it('two same-tick accidents draw independent rolls for some seed', () => {
    let differs = false;
    for (let seed = 1; seed <= 40 && !differs; seed++) {
      const { ctx, ids } = ctxFor(seed);
      mafiaCommand(ctx, ['accident'], { employee: String(ids[0]) });
      mafiaCommand(ctx, ['accident'], { employee: String(ids[1]) });
      const alive = ids.map(id => ctx.state!.employees.employees.find(e => e.id === id)?.alive ?? false);
      if (alive[0] !== alive[1]) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('rollCount grows by one per accepted accident', () => {
    const { ctx, ids } = ctxFor(1);
    expect(ctx.state!.mafia.rollCount).toBe(0);
    mafiaCommand(ctx, ['accident'], { employee: String(ids[0]) });
    expect(ctx.state!.mafia.rollCount).toBe(1);
    mafiaCommand(ctx, ['accident'], { employee: String(ids[1]) });
    expect(ctx.state!.mafia.rollCount).toBe(2);
  });

  it('missing target consumes no salt', () => {
    const { ctx } = ctxFor(1);
    mafiaCommand(ctx, ['accident'], { employee: '9999' });
    expect(ctx.state!.mafia.rollCount).toBe(0);
  });

  it('insufficient cash consumes no salt', () => {
    const { ctx, ids } = ctxFor(1);
    ctx.state!.cash = ACCIDENT_COST - 1;
    mafiaCommand(ctx, ['accident'], { employee: String(ids[0]) });
    expect(ctx.state!.mafia.rollCount).toBe(0);
  });
});

describe('mafia frame completion — roll salt (#1838)', () => {
  it('each completed frame increments rollCount; starting one does not', () => {
    const { ctx, ids } = ctxFor(1);
    const s = ctx.state!;
    mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) });
    mafiaCommand(ctx, ['frame'], { employee: String(ids[1]) });
    expect(s.mafia.rollCount).toBe(0);
    s.tickCount += 100;
    mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) });
    expect(s.mafia.rollCount).toBe(1);
    mafiaCommand(ctx, ['frame'], { employee: String(ids[1]) });
    expect(s.mafia.rollCount).toBe(2);
  });
});
