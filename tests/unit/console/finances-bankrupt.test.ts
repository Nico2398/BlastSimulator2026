// BlastSimulator2026 — `finances` command Bankrupt line (#1376)
// Bankrupt status comes from state.bankruptcy.bankrupt, not from cash < 0.

import { describe, it, expect } from 'vitest';
import { financesCommand } from '../../../src/console/commands/economy.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function ctx() {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
}

describe('finances command bankrupt line', () => {
  it('says No when cash is negative but the mine is not seized', () => {
    const c = ctx();
    c.state!.cash = -25832;
    c.state!.bankruptcy.bankrupt = false;
    const out = financesCommand(c, [], {}).output;
    expect(out).toContain('Bankrupt: No');
    expect(out).not.toContain('Bankrupt: YES');
  });

  it('says YES when the mine is seized', () => {
    const c = ctx();
    c.state!.bankruptcy.bankrupt = true;
    const out = financesCommand(c, [], {}).output;
    expect(out).toContain('Bankrupt: YES');
  });

  it('says No on a fresh game', () => {
    expect(financesCommand(ctx(), [], {}).output).toContain('Bankrupt: No');
  });
});
