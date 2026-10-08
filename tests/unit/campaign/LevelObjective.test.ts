import { describe, it, expect } from 'vitest';
import { getLevelObjective } from '../../../src/core/campaign/LevelObjective.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { addIncome, addExpense, getOperatingProfit } from '../../../src/core/economy/Finance.js';

const LEVEL = 'dusty_hollow';
const target = (): number => getLevel(LEVEL)!.unlockThreshold;

function finances() {
  return createGame({ seed: 42, mineType: 'desert' }).finances;
}

describe('getLevelObjective', () => {
  it('returns profit, target and fraction for a campaign level', () => {
    const f = finances();
    addIncome(f, 20000, 'sales', 'ore', 1);
    const o = getLevelObjective(LEVEL, f);
    expect(o).not.toBeNull();
    expect(o!.target).toBe(target());
    expect(o!.profit).toBe(getOperatingProfit(f));
    expect(o!.profit).toBe(20000);
    expect(o!.fraction).toBeCloseTo(20000 / target(), 6);
  });

  it('fraction is 0 with no transactions', () => {
    const o = getLevelObjective(LEVEL, finances());
    expect(o!.profit).toBe(0);
    expect(o!.fraction).toBe(0);
  });

  it('negative profit clamps fraction to 0 but keeps the raw profit', () => {
    const f = finances();
    addExpense(f, 5000, 'equipment', 'x', 1);
    const o = getLevelObjective(LEVEL, f);
    expect(o!.profit).toBe(getOperatingProfit(f));
    expect(o!.fraction).toBe(0);
  });

  it('profit exactly at target gives fraction 1', () => {
    const f = finances();
    addIncome(f, target(), 'sales', 'ore', 1);
    expect(getLevelObjective(LEVEL, f)!.fraction).toBe(1);
  });

  it('profit over target clamps fraction to 1 but keeps the raw profit', () => {
    const f = finances();
    addIncome(f, target() * 3, 'sales', 'ore', 1);
    const o = getLevelObjective(LEVEL, f)!;
    expect(o.fraction).toBe(1);
    expect(o.profit).toBe(target() * 3);
  });

  it('target follows the level threshold', () => {
    expect(getLevelObjective('tutorial_pit', finances())!.target).toBe(getLevel('tutorial_pit')!.unlockThreshold);
  });

  it('returns null for a null level id', () => {
    expect(getLevelObjective(null, finances())).toBeNull();
  });

  it('returns null in sandbox', () => {
    expect(getLevelObjective('sandbox', finances())).toBeNull();
  });

  it('returns null for an unknown level id', () => {
    expect(getLevelObjective('no_such_level', finances())).toBeNull();
  });
});
