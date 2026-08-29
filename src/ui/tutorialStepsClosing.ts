// BlastSimulator2026 — Tutorial step definitions: closing sequence
// Split out of tutorialSteps.ts (#557's evacuate-zone step pushed that file
// over its file-size budget — a grandfathered, may-only-shrink file per
// tests/unit/lint/FileSizeBudget.test.ts). Steps 19-22: apply the real shift
// policy, let the clock run, hit the level's profit target, and the closing
// card.

import type { GameState } from '../core/state/GameState.js';
import type { TutorialStep } from './tutorialSteps.js';
import { TOOLBAR_TARGET } from './tutorialStepHelpers.js';

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
    isComplete: (state: GameState) => state.levelEnded === true,
  },

  // ── Step 22: congratulations ──
  {
    id: 'congratulations',
    titleKey: 'tutorial.complete_title',
    textKey: 'tutorial.complete_text',
    isComplete: () => true,
  },
];
