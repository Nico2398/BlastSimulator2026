// BlastSimulator2026 — Tutorial step definitions: closing sequence
// Split out of tutorialSteps.ts (#557's evacuate-zone step addition made
// that file cover two unrelated concerns — the closing sequence below is
// its own single responsibility, separate from the rest of the step list).
// Steps 19-22: apply the real shift policy, let the clock run, hit the
// level's profit target, and the closing card.

import type { GameState } from '../core/state/GameState.js';
import type { TutorialStep } from './tutorialSteps.js';
import { TOOLBAR_TARGET } from './tutorialStepHelpers.js';
import type { DefeatReason } from './screens/LevelEndScreen.js';

/** True for any terminal `levelEndReason` other than a genuine win — reuses the same union `LevelEndScreen` already carries rather than redefining it (#959). */
function isDefeatReason(reason: GameState['levelEndReason']): reason is DefeatReason {
  return reason !== null && reason !== 'completed';
}

export const TUTORIAL_STEPS_CLOSING: TutorialStep[] = [
  // ── Step 19: set-policy ──
  {
    id: 'set-policy',
    titleKey: 'tutorial.step20.title',
    textKey: 'tutorial.step20',
    commands: ['set_policy mode:shift_8h'],
    highlightTarget: TOOLBAR_TARGET.settings,
    // Completes when a policy is applied, not when one of its values happens to
    // differ. Comparing values left a player who pressed Apply on the settings
    // already showing — the common case, since the form mirrors the policy in
    // force — watching a "Site policy updated" message while the tutorial sat
    // on the step forever.
    captureSnapshot: (state: GameState) => ({
      policyRevision: state.sitePolicy?.revision ?? 0,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const before = (snapshot.policyRevision as number | undefined) ?? 0;
      return (state.sitePolicy?.revision ?? 0) > before;
    },
  },

  // ── Step 20: tick-advance ──
  {
    id: 'tick-advance',
    titleKey: 'tutorial.step21.title',
    textKey: 'tutorial.step21',
    // The whole point of this step is that the clock runs.
    tickBudget: 30,
    waitsOnWork: true,
    highlightTarget: '#bs-hud-top .bs-speed-btn',
    captureSnapshot: (state: GameState) => ({
      prevTick: state.tickCount ?? 0,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevTick as number;
      return (state.tickCount ?? 0) > prev + 5;
    },
  },

  // ── Step 21: victory ──
  {
    id: 'victory',
    titleKey: 'tutorial.step22.title',
    textKey: 'tutorial.step22',
    // Waits on the level's profit target, which only accrues while time runs.
    tickBudget: 60,
    waitsOnWork: true,
    highlightTarget: '#bs-hud-scores',
    // Only a genuine win completes this step — `state.levelEnded` alone also
    // goes true on bankruptcy/arrest/ecological_shutdown/worker_revolt, which
    // used to hand straight to the congratulations card on a loss (#959).
    // Any other terminal reason is handled generically by TutorialOverlay's
    // own defeat short-circuit (jumpToLastStep via shortCircuitOnDefeat),
    // which fires from every step, not just this one.
    isComplete: (state: GameState) => state.levelEndReason === 'completed',
  },

  // ── Step 22: congratulations ──
  {
    id: 'congratulations',
    titleKey: 'tutorial.complete_title',
    textKey: 'tutorial.complete_text',
    // A defeat reaches this card via the short-circuit above rather than via
    // 'victory' completing, so its title/text still have to reflect what
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
