// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial closing sequence (#959)
//
// The reported bug: 'victory' completes on any `state.levelEnded === true`,
// which bankruptcy/arrest/ecological_shutdown/worker_revolt all set just as
// readily as a genuine win (checkGameOverConditions, tickGameOver.ts) — so a
// player who goes bankrupt still sees the "Tutorial Complete!" card.
// 'congratulations' compounds it: its title/text are unconditionally the
// success copy, regardless of how the level actually ended.

import { describe, it, expect } from 'vitest';
import { TUTORIAL_STEPS_CLOSING } from '../../../src/ui/tutorialStepsClosing.js';
import type { GameState } from '../../../src/core/state/GameState.js';

const victory = TUTORIAL_STEPS_CLOSING.find((s) => s.id === 'victory')!;
const congratulations = TUTORIAL_STEPS_CLOSING.find((s) => s.id === 'congratulations')!;

function stateWith(levelEnded: boolean, levelEndReason: GameState['levelEndReason']): GameState {
  return { levelEnded, levelEndReason } as unknown as GameState;
}

describe('tutorialStepsClosing (#959)', () => {
  it('both closing steps exist', () => {
    expect(victory).toBeDefined();
    expect(congratulations).toBeDefined();
  });

  describe('victory.isComplete', () => {
    const DEFEAT_REASONS: GameState['levelEndReason'][] = [
      'bankruptcy', 'arrest', 'ecological_shutdown', 'worker_revolt',
    ];

    for (const reason of DEFEAT_REASONS) {
      it(`returns false when levelEndReason is '${reason}', even with levelEnded === true`, () => {
        const state = stateWith(true, reason);
        expect(victory.isComplete(state, {})).toBe(false);
      });
    }

    it("returns true when levelEndReason is 'completed'", () => {
      const state = stateWith(true, 'completed');
      expect(victory.isComplete(state, {})).toBe(true);
    });

    it('returns false when the level has not ended at all (levelEndReason null)', () => {
      const state = stateWith(false, null);
      expect(victory.isComplete(state, {})).toBe(false);
    });

    it('returns false when levelEndReason is completed but levelEnded is somehow still false', () => {
      // Defensive: completion should require the level to have genuinely
      // ended, not merely carry a stale reason from a previous run.
      const state = stateWith(false, 'completed');
      expect(victory.isComplete(state, {})).toBe(false);
    });

    it('does not throw against a minimal state with no levelEndReason field at all', () => {
      const state = {} as unknown as GameState;
      expect(() => victory.isComplete(state, {})).not.toThrow();
    });
  });

  describe('congratulations title/text resolution', () => {
    it('has titleKeyFor and textKeyFor functions', () => {
      expect(typeof congratulations.titleKeyFor).toBe('function');
      expect(typeof congratulations.textKeyFor).toBe('function');
    });

    it("resolves to tutorial.complete_title/tutorial.complete_text when levelEndReason is 'completed'", () => {
      const state = stateWith(true, 'completed');
      expect(congratulations.titleKeyFor!(state)).toBe('tutorial.complete_title');
      expect(congratulations.textKeyFor!(state)).toBe('tutorial.complete_text');
    });

    const DEFEAT_CASES: Array<{ reason: GameState['levelEndReason']; key: string }> = [
      { reason: 'bankruptcy', key: 'bankruptcy' },
      { reason: 'arrest', key: 'arrest' },
      { reason: 'ecological_shutdown', key: 'ecological_shutdown' },
      { reason: 'worker_revolt', key: 'worker_revolt' },
    ];

    for (const { reason, key } of DEFEAT_CASES) {
      it(`resolves to tutorial.defeat.${key}.title/.text when levelEndReason is '${reason}'`, () => {
        const state = stateWith(true, reason);
        expect(congratulations.titleKeyFor!(state)).toBe(`tutorial.defeat.${key}.title`);
        expect(congratulations.textKeyFor!(state)).toBe(`tutorial.defeat.${key}.text`);
      });
    }

    it('falls back to the success copy when levelEndReason is null (defensive default, not a defeat)', () => {
      const state = stateWith(false, null);
      expect(congratulations.titleKeyFor!(state)).toBe('tutorial.complete_title');
      expect(congratulations.textKeyFor!(state)).toBe('tutorial.complete_text');
    });

    it('does not throw against a minimal state with no levelEndReason field at all', () => {
      const state = {} as unknown as GameState;
      expect(() => congratulations.titleKeyFor!(state)).not.toThrow();
      expect(() => congratulations.textKeyFor!(state)).not.toThrow();
    });

    // Static fallback fields still resolve to the success copy — every
    // OTHER place a step's title/text is read (e.g. a step with no
    // titleKeyFor at all) reads titleKey/textKey directly.
    it('static titleKey/textKey still name the success copy as a fallback', () => {
      expect(congratulations.titleKey).toBe('tutorial.complete_title');
      expect(congratulations.textKey).toBe('tutorial.complete_text');
    });
  });
});
