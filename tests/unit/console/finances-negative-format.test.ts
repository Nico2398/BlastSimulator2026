// BlastSimulator2026 — `finances` command negative money format (#1482)
// Negative amounts print sign-first ("-$25,832"), whole dollars, never "$-25832.00".

import { describe, it, expect } from 'vitest';
import { financesCommand } from '../../../src/console/commands/economy.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function ctx() {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
}

describe('finances command negative money format', () => {
  it('prints negative cash sign-first as whole dollars', () => {
    const c = ctx();
    c.state!.cash = -25832;
    c.state!.finances.cash = -25832;
    const out = financesCommand(c, [], {}).output;
    expect(out).toContain('Balance: -$25,832');
    expect(out).not.toMatch(/\$-/);
    expect(out).not.toContain('.00');
  });

  it('prints a negative net profit as -$N', () => {
    const c = ctx();
    c.state!.finances.transactions.push(
      { tick: 1, amount: 1000, type: 'income', category: 'contract', description: 'x' } as never,
      { tick: 2, amount: 146000, type: 'expense', category: 'salaries', description: 'payroll' } as never,
    );
    const out = financesCommand(c, [], {}).output;
    expect(out).toMatch(/Net profit:\s+-\$145,000/);
    expect(out).not.toMatch(/\$-/);
  });

  it('prints positive cash with a grouped, unsigned $ amount', () => {
    const c = ctx();
    c.state!.cash = 75000;
    c.state!.finances.cash = 75000;
    expect(financesCommand(c, [], {}).output).toContain('Balance: $75,000');
  });
});
