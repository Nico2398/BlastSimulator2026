// BlastSimulator2026 — Tutorial step definitions: closing sequence
// Split out of tutorialSteps.ts (#557's evacuate-zone step addition made
// that file cover two unrelated concerns — the closing sequence below is
// its own single responsibility, separate from the rest of the step list).
// Last two steps: free play (rails lifted, play on to the profit target) and
// the closing card.

import type { GameState } from '../core/state/GameState.js';
import type { FinanceState } from '../core/economy/Finance.js';
import type { TutorialStep } from './tutorialSteps.js';
import { getOperatingProfit } from '../core/economy/Finance.js';
import { formatDollars } from '../core/economy/formatMoney.js';
import { getLevel } from '../core/campaign/Level.js';
import { TUTORIAL_LEVEL_ID } from './tutorialTrigger.js';
import type { DefeatReason } from './screens/LevelEndScreen.js';

/** True for any terminal `levelEndReason` other than a genuine win — reuses the same union `LevelEndScreen` already carries rather than redefining it (#959). */
function isDefeatReason(reason: GameState['levelEndReason']): reason is DefeatReason {
  return reason !== null && reason !== 'completed';
}

/** Profit earned so far against the level's profit target, and what is still missing. */
export function victoryProgress(
  finances: FinanceState,
  target: number,
): { profit: number; target: number; remaining: number } {
  const profit = getOperatingProfit(finances);
  return { profit, target, remaining: Math.max(0, target - profit) };
}

/** Profit target the tutorial level is won at. */
function tutorialTarget(): number {
  return getLevel(TUTORIAL_LEVEL_ID)?.unlockThreshold ?? 0;
}

export const TUTORIAL_STEPS_CLOSING: TutorialStep[] = [
  // ── free-play ──
  // The guided part ends with the first ore sale. From here every rail is
  // lifted and the clock is never held (`guided: false`); the goal chip shows
  // operating profit against the level's target. Only a genuine win completes this
  // step — `state.levelEnded` alone also goes true on bankruptcy/arrest/
  // ecological_shutdown/worker_revolt (#959); any other terminal reason is
  // handled by TutorialOverlay's own defeat short-circuit from every step.
  {
    id: 'free-play',
    titleKey: 'tutorial.free_play.title',
    textKey: 'tutorial.free_play',
    guided: false,
    goalChip: true,
    textParamsFor: (state: GameState) => ({
      ...goalChipParams(state),
      remaining: formatDollars(victoryProgress(state.finances, tutorialTarget()).remaining),
    }),
    isComplete: (state: GameState) => state.levelEnded === true && state.levelEndReason === 'completed',
  },

  // ── Step 22: congratulations ──
  {
    id: 'congratulations',
    titleKey: 'tutorial.complete_title',
    textKey: 'tutorial.complete_text',
    // A defeat reaches this card via the short-circuit rather than via
    // 'free-play' completing, so its title/text still have to reflect what
    // actually happened instead of always congratulating (#959).
    titleKeyFor: (state: GameState) => (
      isDefeatReason(state.levelEndReason)
        ? `tutorial.defeat.${state.levelEndReason}.title`
        : 'tutorial.complete_title'
    ),
    textKeyFor: (state: GameState) => (
      isDefeatReason(state.levelEndReason)
        ? `tutorial.defeat.${state.levelEndReason}.text`
        : 'tutorial.complete_text'
    ),
    isComplete: () => true,
  },
];

/** Interpolation params for the goal chip: formatted operating profit and profit target (#1328). */
export function goalChipParams(state: GameState): { profit: string; target: string } {
  const target = tutorialTarget();
  return { profit: formatDollars(victoryProgress(state.finances, target).profit), target: formatDollars(target) };
}
