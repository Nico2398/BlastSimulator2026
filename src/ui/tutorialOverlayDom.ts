// BlastSimulator2026 — Tutorial coach-mark DOM
// Builds the tutorial card element tree. Extracted from TutorialOverlay.ts to
// keep each file under the 300-line limit; holds no behaviour of its own.

import { t } from '../core/i18n/I18n.js';

/** Every element TutorialOverlay needs a handle on after construction. */
export interface TutorialCardElements {
  overlay: HTMLElement;
  box: HTMLElement;
  titleEl: HTMLElement;
  textEl: HTMLElement;
  stageEl: HTMLElement;
  pausedEl: HTMLElement;
  stepCounter: HTMLElement;
  progressEl: HTMLElement;
  commandsLabel: HTMLElement;
  commandsHint: HTMLElement;
}

/**
 * Build the tutorial card and append it to `container`, hidden.
 *
 * The wrapper is a bottom-docked, click-through strip rather than a modal
 * scrim: the card has to coexist with the control each step points at.
 */
export function buildTutorialCard(container: HTMLElement): TutorialCardElements {
  const overlay = document.createElement('div');
  overlay.id = 'bs-tutorial-overlay';
  overlay.className = 'bs-tutorial-overlay';
  overlay.style.display = 'none';

  const box = document.createElement('div');
  box.className = 'bs-tutorial-box';

  const header = document.createElement('div');
  header.className = 'bs-tutorial-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'bs-panel-title';

  const stepCounter = document.createElement('div');
  stepCounter.className = 'bs-tutorial-progress';

  header.append(titleEl, stepCounter);

  const textEl = document.createElement('p');
  textEl.className = 'bs-panel-text';

  // The one thing to do right now. A step is several clicks; the paragraph above
  // explains the goal, this names the next control.
  const stageEl = document.createElement('div');
  stageEl.className = 'bs-tutorial-stage';

  // Shown while the clock is held, so a paused game reads as deliberate rather
  // than broken.
  const pausedEl = document.createElement('div');
  pausedEl.className = 'bs-tutorial-paused';
  pausedEl.textContent = t('tutorial.clock_held');
  pausedEl.style.display = 'none';

  const progressTrack = document.createElement('div');
  progressTrack.className = 'bs-tutorial-progress-track';

  const progressEl = document.createElement('div');
  progressEl.className = 'bs-tutorial-progress-fill';
  progressEl.style.width = '0%';
  progressTrack.appendChild(progressEl);

  const commandsLabel = document.createElement('div');
  commandsLabel.className = 'bs-tutorial-commands-label';
  commandsLabel.textContent = t('tutorial.console_hint');
  commandsLabel.style.display = 'none';

  const commandsHint = document.createElement('div');
  commandsHint.className = 'bs-tutorial-commands';
  commandsHint.style.display = 'none';

  // No buttons at all. There is no "Next" and no "Skip": the only way through a
  // step is to perform it, so the card offers nothing to click past it with.
  box.append(header, textEl, stageEl, pausedEl, progressTrack, commandsLabel, commandsHint);
  overlay.appendChild(box);
  container.appendChild(overlay);

  return {
    overlay, box, titleEl, textEl, stageEl, pausedEl, stepCounter,
    progressEl, commandsLabel, commandsHint,
  };
}
