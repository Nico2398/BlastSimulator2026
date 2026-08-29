// BlastSimulator2026 — Tutorial state probe
//
// Where the tutorial believes it is. A harness that only checks for thrown
// errors cannot tell a completed step from a silently stuck one. Backs
// window.__tutorialState (main.ts), mirroring uiActionProbe.ts's split
// between the bridge assignment and the probe logic it calls.

import type { TutorialOverlay } from './TutorialOverlay.js';
import { TUTORIAL_STEPS } from './tutorialSteps.js';

export interface TutorialStateSnapshot {
  active: boolean;
  stepIndex: number;
  stepId: string | null;
  title: string;
  total: number;
  stageIndex: number;
  stageTotal: number;
  stageTarget: string | null;
  clockHeld: boolean;
}

export function probeTutorialState(tutorial: TutorialOverlay): TutorialStateSnapshot {
  const el = document.querySelector('.bs-tutorial-box .bs-panel-title');
  const counter = document.querySelector('.bs-tutorial-progress');
  const parsed = /(\d+)\s*\/\s*(\d+)/.exec(counter?.textContent ?? '');
  const stage = tutorial.stageProgress;
  const paused = document.querySelector('.bs-tutorial-paused') as HTMLElement | null;
  return {
    active: tutorial.isActive,
    stepIndex: parsed ? Number(parsed[1]) - 1 : -1,
    stepId: TUTORIAL_STEPS[parsed ? Number(parsed[1]) - 1 : -1]?.id ?? null,
    title: el?.textContent ?? '',
    total: parsed ? Number(parsed[2]) : 0,
    // Which click of the step the player is on — a step is several controls,
    // and a harness that only knew the step could not tell them apart.
    stageIndex: stage.index,
    stageTotal: stage.total,
    stageTarget: stage.target,
    clockHeld: paused !== null && paused.style.display !== 'none',
  };
}
