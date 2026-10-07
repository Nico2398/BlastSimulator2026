// BlastSimulator2026 — operating profit in the console and goal readouts (#1363)
// `economy`/`finances`, `campaign complete` and the tutorial goal chip use the
// same figure the level win condition does: operating profit, not net profit.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { financesCommand } from '../../../src/console/commands/economy.js';
import { campaignCompleteCommand } from '../../../src/console/commands/campaign.js';
import { addIncome, addExpense, createFinanceState, getOperatingProfit } from '../../../src/core/economy/Finance.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { victoryProgress, goalChipParams } from '../../../src/ui/tutorialStepsClosing.js';
import { formatDollars } from '../../../src/core/economy/formatMoney.js';
import { makeGameContext } from '../../helpers/gameContext.js';

describe('finances command (#1363)', () => {
  it('prints an Operating profit line that leaves out capital outlay', () => {
    const c = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    addIncome(c.state!.finances, 9000, 'contracts', 'c', 1);
    addExpense(c.state!.finances, 50000, 'equipment', 'vehicle', 2);
    addExpense(c.state!.finances, 1000, 'salaries', 'wages', 3);
    const out = financesCommand(c, [], {}).output;
    expect(out).toMatch(/Operating profit:\s+\$8,000/);
    expect(out).toMatch(/Net profit:\s+-\$42,000/);
  });
});

describe('campaign complete (debug) grants the operating-profit shortfall (#1363)', () => {
  it('tops operating profit up to exactly the threshold when capital outlay already sits in the ledger', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    const state = ctx.state!;
    const threshold = getLevel('tutorial_pit')!.unlockThreshold;
    addExpense(state.finances, 90000, 'equipment', 'fleet', 0);
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(getOperatingProfit(state.finances)).toBe(threshold);
    expect(state.levelEndReason).toBe('completed');
  });
});

describe('tutorial victory readouts use operating profit (#1363)', () => {
  const target = 5000;

  it('victoryProgress ignores a vehicle purchase', () => {
    const f = createFinanceState(100000);
    addIncome(f, 1200, 'contracts', 'c', 1);
    addExpense(f, 25000, 'equipment', 'hauler', 2);
    expect(victoryProgress(f, target)).toEqual({ profit: 1200, target, remaining: target - 1200 });
  });

  it('victoryProgress counts a fine against the player', () => {
    const f = createFinanceState(100000);
    addIncome(f, 1200, 'contracts', 'c', 1);
    addExpense(f, 200, 'fines', 'fine', 2);
    expect(victoryProgress(f, target).profit).toBe(1000);
  });

  it('goalChipParams shows operating profit', () => {
    const c = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    addIncome(c.state!.finances, 3000, 'contracts', 'c', 1);
    addExpense(c.state!.finances, 40000, 'construction', 'b', 2);
    expect(goalChipParams(c.state!).profit).toBe(formatDollars(3000));
  });
});
