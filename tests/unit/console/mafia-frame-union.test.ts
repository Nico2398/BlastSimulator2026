// #1872 — framing refuses union members; ordinary dismissal dents the crew's morale, a frame does not.
import { describe, it, expect } from 'vitest';
import { mafiaCommand } from '../../../src/console/commands/mafia.js';
import { employeeCommand } from '../../../src/console/commands/employees.js';
import { makeGameContext, type GameContext } from '../../helpers/gameContext.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { DISMISSAL_CREW_MORALE_DENT } from '../../../src/core/config/balance.js';

function ctxWithCrew(unionFirst: boolean): { ctx: GameContext; ids: number[] } {
  const ctx = makeGameContext({ mineType: 'desert', seed: 3, size: 24 });
  const s = ctx.state!;
  s.corruption.mafiaUnlocked = true;
  s.cash = 1_000_000;
  s.tickCount = 50;
  const ids = [1, 2, 3].map(i => {
    const e = hireEmployee(s.employees, 'driver', new Random(i), 5, 5).employee;
    e.unionized = false;
    e.morale = 70;
    return e.id;
  });
  s.employees.employees.find(e => e.id === ids[0])!.unionized = unionFirst;
  return { ctx, ids };
}

describe('console mafia frame on a union member (#1872)', () => {
  it('is refused with no charge, no expense, no roll and no pending frame', () => {
    const { ctx, ids } = ctxWithCrew(true);
    const s = ctx.state!;
    const cash = s.cash;
    const expenses = s.finances.transactions.length;
    const exposure = s.mafia.exposureRisk;
    const result = mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) });
    expect(result.success).toBe(false);
    expect(s.cash).toBe(cash);
    expect(s.finances.transactions).toHaveLength(expenses);
    expect(s.mafia.rollCount).toBe(0);
    expect(s.mafia.pendingFrames).toEqual([]);
    expect(s.mafia.exposureRisk).toBe(exposure);
  });

  it('a union member who has a stale ready pending frame is not dismissed and consumes no roll', () => {
    const { ctx, ids } = ctxWithCrew(false);
    const s = ctx.state!;
    expect(mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) }).success).toBe(true);
    s.employees.employees.find(e => e.id === ids[0])!.unionized = true;
    s.tickCount += 1000;
    const rolls = s.mafia.rollCount;
    mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) });
    expect(s.employees.employees.some(e => e.id === ids[0])).toBe(true);
    expect(s.mafia.rollCount).toBe(rolls);
    expect(s.mafia.pendingFrames).toEqual([]);
  });

  it('a non-union target is still framed normally', () => {
    const { ctx, ids } = ctxWithCrew(false);
    const result = mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) });
    expect(result.success).toBe(true);
    expect(ctx.state!.mafia.pendingFrames).toHaveLength(1);
  });
});

describe('dismissal versus frame: crew morale (#1872)', () => {
  it('plain employees fire dents every remaining employee', () => {
    const { ctx, ids } = ctxWithCrew(false);
    const result = employeeCommand(ctx, ['fire', String(ids[0])], {});
    expect(result.success).toBe(true);
    for (const id of ids.slice(1)) {
      expect(ctx.state!.employees.employees.find(e => e.id === id)!.morale).toBe(70 - DISMISSAL_CREW_MORALE_DENT);
    }
  });

  it('a successful frame leaves the remaining crew morale untouched', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { ctx, ids } = ctxWithCrew(false);
      const s = ctx.state!;
      s.seed = seed;
      mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) });
      s.tickCount += 1000;
      mafiaCommand(ctx, ['frame'], { employee: String(ids[0]) });
      if (s.employees.employees.some(e => e.id === ids[0])) continue; // frame detected
      for (const id of ids.slice(1)) expect(s.employees.employees.find(e => e.id === id)!.morale).toBe(70);
      return;
    }
    expect.unreachable('no successful frame in 60 seeds');
  });
});
