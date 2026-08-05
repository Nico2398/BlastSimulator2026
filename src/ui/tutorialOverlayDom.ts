// BlastSimulator2026 — Tutorial coach-mark DOM (redesign P10)
// Builds the tutorial card element tree. Extracted from TutorialOverlay.ts to
// keep each file under the 300-line limit; holds no behaviour of its own.

import { t } from '../core/i18n/I18n.js';
import { el } from './dom.js';
import { iconEl } from './icons.js';

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
 *
 * No buttons anywhere in this tree. There is no "Next", no "Skip", and no
 * close/dismiss control — the only way through a step is to perform it (see
 * the "no escape hatch" tests in TutorialOverlay.test.ts). The design comp
 * this reskin ports (`docs/BlastSim game UI design/BlastSim UI.dc.html`,
 * `endCoach` on the coach card) and one bullet in
 * `docs/ui-implementation-plan.md`'s P10 scope both show a close (x) button;
 * both predate the deliberate, later, explicitly-tested decision recorded
 * here and in `docs/ui-redesign-spec.md` §6.17 (which lists the card's
 * elements without one). The spec and the tests — written after and more
 * specifically than the plan's phase-list bullet — win: no close button.
 */
export function buildTutorialCard(container: HTMLElement): TutorialCardElements {
  const overlay = document.createElement('div');
  overlay.id = 'bs-tutorial-overlay';
  overlay.className = 'bs-tutorial-overlay';
  overlay.style.display = 'none';

  const box = el('div', { className: 'bsx-root bs-tutorial-box' });

  // Top sliver, edge-to-edge (the box clips it round via overflow:hidden).
  const progressTrack = document.createElement('div');
  progressTrack.className = 'bs-tutorial-progress-track';

  const progressEl = document.createElement('div');
  progressEl.className = 'bs-tutorial-progress-fill';
  progressEl.style.width = '0%';
  progressTrack.appendChild(progressEl);

  const iconChip = el('div', {
    attrs: {
      style: 'width:32px;height:32px;flex:0 0 32px;border-radius:6px;display:flex;'
        + 'align-items:center;justify-content:center;background:rgba(255,176,46,.16);color:var(--bsx-amber)',
    },
  });
  iconChip.appendChild(iconEl('training', 17));

  const titleEl = document.createElement('div');
  titleEl.className = 'bs-panel-title';

  // Shown while the clock is held, so a paused game reads as deliberate
  // rather than broken. Sits inline with the title as a small pill chip; the
  // longer explanation moves to a native tooltip so the compact chip doesn't
  // have to carry a full sentence.
  const pausedEl = el('span', {
    className: 'bs-tutorial-paused',
    attrs: { style: 'display:none', title: t('tutorial.clock_held') },
  });
  pausedEl.appendChild(iconEl('pause', 8));
  pausedEl.appendChild(el('span', { text: t('tutorial.clock_held_chip') }));

  const stepCounter = document.createElement('div');
  stepCounter.className = 'bs-tutorial-progress';

  const titleRow = el('div', {
    attrs: { style: 'display:flex;align-items:center;gap:9px;flex-wrap:wrap' },
    children: [titleEl, pausedEl, stepCounter],
  });

  const textEl = document.createElement('p');
  textEl.className = 'bs-panel-text';

  // The one thing to do right now. A step is several clicks; the paragraph
  // above explains the goal, this names the next control.
  const chevron = iconEl('chevR', 11);
  const stageEl = document.createElement('span');
  stageEl.className = 'bs-tutorial-stage';
  const stageLine = el('div', {
    attrs: { style: 'display:flex;align-items:center;gap:6px;color:var(--bsx-amber)' },
    children: [chevron, stageEl],
  });

  const commandsLabel = document.createElement('div');
  commandsLabel.className = 'bs-tutorial-commands-label';
  commandsLabel.textContent = t('tutorial.console_hint');
  commandsLabel.style.display = 'none';

  const commandsHint = document.createElement('div');
  commandsHint.className = 'bs-tutorial-commands';
  commandsHint.style.display = 'none';

  const contentCol = el('div', {
    attrs: { style: 'display:flex;flex-direction:column;gap:6px;flex:1;min-width:0' },
    children: [titleRow, textEl, stageLine, commandsLabel, commandsHint],
  });

  const contentRow = el('div', {
    attrs: { style: 'padding:14px 16px;display:flex;gap:13px' },
    children: [iconChip, contentCol],
  });

  box.append(progressTrack, contentRow);
  overlay.appendChild(box);
  container.appendChild(overlay);

  return {
    overlay, box, titleEl, textEl, stageEl, pausedEl, stepCounter,
    progressEl, commandsLabel, commandsHint,
  };
}
