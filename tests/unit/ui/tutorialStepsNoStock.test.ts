// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial: no stock-explosives step; the charge step buys from cash at loading (#2153)

import { describe, it, expect, beforeAll } from 'vitest';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import { TUTORIAL_STAGES } from '../../../src/ui/tutorialStages.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

const ids = TUTORIAL_STEPS.map((s) => s.id);
const step = (id: string) => TUTORIAL_STEPS.find((s) => s.id === id)!;

beforeAll(() => setLocale('en'));

describe('the tutorial teaches no stock (#2153)', () => {
  it('has no stock-explosives step', () => {
    expect(ids).not.toContain('stock-explosives');
  });

  it('has no stage list for a stock-explosives step', () => {
    expect(Object.keys(TUTORIAL_STAGES)).not.toContain('stock-explosives');
  });

  it('no stage targets or allows the stock buy button or kg stepper', () => {
    const selectors = Object.values(TUTORIAL_STAGES).flat()
      .flatMap((s) => [s.target, ...(s.also ?? []), ...(s.alsoWhen ?? []).map((a) => a.selector)]);
    for (const selector of selectors) {
      expect(selector).not.toContain('stock-buy');
      expect(selector).not.toContain('stock-kg');
    }
  });

  it('no step scripts a buy explosive command', () => {
    for (const s of TUTORIAL_STEPS) {
      for (const cmd of [...(s.commands ?? []), ...(s.autoCommands ?? [])]) {
        expect(cmd, s.id).not.toMatch(/^buy\s+explosive/);
      }
    }
  });

  it('no step text or title speaks of stocking explosives', () => {
    for (const s of TUTORIAL_STEPS) {
      const text = `${t(s.titleKey)} ${t(s.textKey)}`;
      expect(text, s.id).not.toMatch(/stock explosives|explosives? (in|into) (the )?(stock|warehouse)|in bulk|into the warehouse/i);
    }
  });

  it('the charge step follows drill-plan directly', () => {
    const drill = ids.indexOf('drill-plan');
    const charge = ids.indexOf('charge');
    expect(drill).toBeGreaterThanOrEqual(0);
    expect(charge).toBeGreaterThan(drill);
    expect(charge).toBe(drill + 1);
  });
});

describe('the charge step charges from cash at loading (#2153)', () => {
  const holes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `H${i + 1}` }));
  const charge = { explosiveId: 'boomite', amountKg: 7, stemmingM: 2.5 };

  function chargedState(count: number, charged: number): GameState {
    const state = createGame({ seed: 42 });
    state.drillHoles = holes(count) as unknown as GameState['drillHoles'];
    state.chargesByHole = Object.fromEntries(holes(charged).map((h) => [h.id, charge]));
    return state;
  }

  it('scripts only a charge command: boomite filled up to the default stemming', () => {
    expect(step('charge').commands).toEqual(['charge hole:* explosive:boomite stemming:2.5']);
  });

  it('completes once every hole is charged, with no stock anywhere', () => {
    const state = chargedState(9, 9);
    expect(step('charge').isComplete(state, {})).toBe(true);
  });

  it('does not complete while a hole is still uncharged', () => {
    expect(step('charge').isComplete(chargedState(9, 8), {})).toBe(false);
  });

  it('does not complete with no hole drilled', () => {
    expect(step('charge').isComplete(chargedState(0, 0), {})).toBe(false);
  });

  it('waits on work, as the loading crew takes time', () => {
    expect(step('charge').waitsOnWork).toBe(true);
  });
});
