// BlastSimulator2026 — Tutorial step definitions
// Defines the TutorialStep interface and ordered step array.

import type { GameState } from '../core/state/GameState.js';

export interface TutorialStep {
  id: string;
  titleKey: string;
  textKey: string;
  commands?: string[];
  autoAdvanceMs?: number;
  captureSnapshot?: (state: GameState) => Record<string, unknown>;
  isComplete: (state: GameState, snapshot: Record<string, unknown>) => boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [];

export const TOTAL_TUTORIAL_STEPS = 0;
