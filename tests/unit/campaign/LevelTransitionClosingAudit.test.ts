// #1409 — a closing tax audit runs before a level is declared complete: smuggling still
// on the open books is regularised, and a payment that drops profit under the target
// lets the level go on.
import { describe, it, expect } from 'vitest';
import { checkLevelComplete } from '../../../src/core/campaign/LevelTransition.js';
import { addIncome } from '../../../src/core/economy/Finance.js';
import { bookTaxAuditIncome } from '../../../src/core/events/TaxAudit.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { makeCampaignCtx } from '../../integration/full-level/helpers.js';

const TARGET = getLevel('dusty_hollow')!.unlockThreshold;

/** A Dusty Hollow session sitting exactly on the profit target; `smuggled` of it was smuggled. */
function sessionOnTarget(seed: number, smuggled: number) {
  const ctx = makeCampaignCtx('dusty_hollow');
  const state = ctx.state!;
  state.seed = seed;
  state.tickCount = 500 + seed;
  addIncome(state.finances, TARGET - smuggled, 'sales', 'Ore sale', state.tickCount);
  if (smuggled > 0) addIncome(state.finances, smuggled, 'smuggling', 'Smuggling', state.tickCount);
  bookTaxAuditIncome(state.taxAudit, state.tickCount, TARGET - smuggled, smuggled);
  return { ctx, state };
}

describe('checkLevelComplete closing audit (#1409)', () => {
  it('an honest mine on target completes the level with no conviction', () => {
    const { ctx, state } = sessionOnTarget(1, 0);
    const result = checkLevelComplete(state, ctx.campaignProfile.campaign, ctx.emitter);
    expect(result.triggered).toBe(true);
    expect(state.taxAudit.convictions).toBe(0);
  });

  it('smuggling on the books across many seeds: sometimes caught and the level goes on, sometimes not', () => {
    let blocked = 0;
    let completed = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const { ctx, state } = sessionOnTarget(seed, 20_000);
      const result = checkLevelComplete(state, ctx.campaignProfile.campaign, ctx.emitter);
      if (result.triggered) {
        completed++;
        expect(state.levelEnded).toBe(true);
        expect(state.taxAudit.convictions).toBe(0);
      } else {
        blocked++;
        expect(state.levelEnded).toBe(false);
        expect(state.taxAudit.convictions).toBe(1);
        // The closing audit collects the regularisation at once, which is what sank the profit.
        expect(state.taxAudit.debt).toBeGreaterThanOrEqual(0);
      }
    }
    expect(blocked).toBeGreaterThan(0);
    expect(completed).toBeGreaterThan(0);
  });

  it('smuggling on the books raises the audit before the level is settled, not after', () => {
    // 90 % smuggled income can never be honest profit: a catch leaves the level unfinished.
    let blockedWithDebt = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { ctx, state } = sessionOnTarget(seed, Math.round(TARGET * 0.9));
      const result = checkLevelComplete(state, ctx.campaignProfile.campaign, ctx.emitter);
      if (!result.triggered) blockedWithDebt++;
    }
    expect(blockedWithDebt).toBeGreaterThan(0);
  });
});
