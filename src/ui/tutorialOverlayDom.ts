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
  stepCounter: HTMLElement;
  progressEl: HTMLElement;
  commandsLabel: HTMLElement;
  commandsHint: HTMLElement;
  skipBtn: HTMLButtonElement;
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

  const actions = document.createElement('div');
  actions.className = 'bs-tutorial-actions';

  // Skip only. There is deliberately no "Next": the way forward is to perform
  // the step the card is asking for, so the tutorial cannot be clicked past.
  const skipBtn = document.createElement('button');
  skipBtn.className = 'bs-btn bs-btn-skip';
  skipBtn.textContent = t('tutorial.skip');

  actions.append(skipBtn);

  box.append(header, textEl, progressTrack, commandsLabel, commandsHint, actions);
  overlay.appendChild(box);
  container.appendChild(overlay);

  return {
    overlay, box, titleEl, textEl, stepCounter,
    progressEl, commandsLabel, commandsHint, skipBtn,
  };
}
