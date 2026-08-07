// BlastSimulator2026 — Loading screen DOM-tree assembly (extracted from
// LoadingScreen.ts to keep that file under the 300-line convention, #493).
//
// Pure construction: builds the overlay's element tree once and hands back
// refs to every node LoadingScreen needs to read or write later. No event
// wiring here (the one click listener needs `this`, so LoadingScreen's own
// constructor attaches it after calling this factory) and no i18n calls
// (`show()` fills in text on every call, including locale switches).

import { iconEl } from './icons.js';
import { buildStrataBackdrop } from './loadingBackdrop.js';

/** Element refs `LoadingScreen`'s constructor wires into its own fields. */
export interface LoadingScreenLayout {
  overlay: HTMLElement;
  label: HTMLElement;
  barFill: HTMLElement;
  percentEl: HTMLElement;
  titleEl: HTMLElement;
  eyebrowEl: HTMLElement;
  subtitleEl: HTMLElement;
  briefingEl: HTMLElement;
  marksLayer: HTMLElement;
  stageLabelEl: HTMLElement;
  stageMetaEl: HTMLElement;
  tipLabelEl: HTMLElement;
  tipTextEl: HTMLElement;
  tipNextBtn: HTMLButtonElement;
}

/** Build the loading screen's full DOM tree, unattached to any container. */
export function buildLoadingScreenLayout(): LoadingScreenLayout {
  const overlay = document.createElement('div');
  overlay.id = 'bs-loading-screen';
  // Above the main menu and the sandbox panel — a load can start from either.
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10500;display:none',
    'align-items:center;justify-content:center',
    // overflow before background: jsdom's cssstyle parser silently voids
    // the whole cssText when a `background` shorthand is followed by an
    // `overflow` declaration in the same string (reproduced in isolation;
    // `overflow-then-background` and `background-color` both parse fine).
    'overflow:hidden;background:#0d1116',
  ].join(';');

  overlay.appendChild(buildStrataBackdrop());

  const vignette = document.createElement('div');
  vignette.style.cssText = 'position:absolute;inset:0;'
    + 'background:radial-gradient(96% 76% at 50% 44%, rgba(26,32,40,.55), rgba(11,14,19,.92) 74%)';
  overlay.appendChild(vignette);

  const column = document.createElement('div');
  column.style.cssText = 'position:relative;z-index:1;width:100%;max-width:640px;padding:0 24px;'
    + 'display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center';

  const eyebrowEl = document.createElement('div');
  eyebrowEl.id = 'bs-loading-eyebrow';
  eyebrowEl.className = 'bsx-loading-eyebrow';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font:900 32px/1.15 var(--bsx-font-ui, sans-serif);letter-spacing:-.02em;color:var(--bsx-text-primary, #f2f4f7)';

  const subtitleEl = document.createElement('div');
  subtitleEl.id = 'bs-loading-subtitle';
  subtitleEl.className = 'bsx-loading-subtitle';

  const briefingEl = document.createElement('div');
  briefingEl.id = 'bs-loading-briefing';
  briefingEl.className = 'bsx-loading-briefing';

  const phaseLine = document.createElement('div');
  phaseLine.style.cssText = 'display:flex;align-items:center;gap:9px;color:var(--bsx-text-secondary, #c9d1db)';
  const chev = iconEl('chevR', 10);
  chev.style.color = 'var(--bsx-text-muted, #8a94a2)';
  const label = document.createElement('span');
  label.id = 'bs-loading-label';
  label.style.cssText = 'font:400 13px/1.5 var(--bsx-font-ui, sans-serif)';
  phaseLine.append(chev, label);

  const progressBlock = document.createElement('div');
  progressBlock.style.cssText = 'width:100%;display:flex;flex-direction:column;gap:8px';

  const track = document.createElement('div');
  track.style.cssText = 'position:relative;height:6px;border-radius:3px;overflow:hidden;background:#1b212a';
  const barFill = document.createElement('div');
  barFill.id = 'bs-loading-bar';
  barFill.style.cssText = 'height:100%;width:0%;background:var(--bsx-amber, #ffb02e);transition:width 120ms linear';
  const marksLayer = document.createElement('div');
  marksLayer.className = 'bsx-loading-marks';
  track.append(barFill, marksLayer);

  const stageRow = document.createElement('div');
  stageRow.className = 'bsx-loading-stage-row';
  const stageLabelEl = document.createElement('span');
  stageLabelEl.id = 'bs-loading-stage-label';
  stageLabelEl.className = 'bsx-loading-stage-label';
  const stageMetaEl = document.createElement('span');
  stageMetaEl.id = 'bs-loading-stage-meta';
  stageMetaEl.className = 'bsx-loading-stage-meta';

  const percentEl = document.createElement('div');
  percentEl.style.cssText = 'margin-left:auto;font:600 12px/1 var(--bsx-font-mono, monospace);color:var(--bsx-text-secondary, #c9d1db)';
  stageRow.append(stageLabelEl, stageMetaEl, percentEl);

  const tipBlock = document.createElement('div');
  tipBlock.id = 'bs-loading-tip';
  tipBlock.className = 'bsx-loading-tip';
  const tipIconWrap = document.createElement('span');
  tipIconWrap.className = 'bsx-loading-tip-icon';
  tipIconWrap.appendChild(iconEl('training', 13));
  const tipLabelEl = document.createElement('span');
  tipLabelEl.className = 'bsx-loading-tip-label';
  tipIconWrap.appendChild(tipLabelEl);
  const tipTextEl = document.createElement('span');
  tipTextEl.id = 'bs-loading-tip-text';
  tipTextEl.className = 'bsx-loading-tip-text';
  const tipNextBtn = document.createElement('button');
  tipNextBtn.id = 'bs-loading-tip-next';
  tipNextBtn.className = 'bsx-loading-tip-next';
  tipNextBtn.type = 'button';
  // Click wiring is not this factory's job — LoadingScreen's constructor
  // attaches it once `this` exists, so the handler can call `this.nextTip()`.
  tipBlock.append(tipIconWrap, tipTextEl, tipNextBtn);

  progressBlock.append(track, stageRow);
  column.append(eyebrowEl, titleEl, subtitleEl, briefingEl, phaseLine, progressBlock, tipBlock);
  overlay.appendChild(column);

  return {
    overlay, label, barFill, percentEl, titleEl, eyebrowEl, subtitleEl, briefingEl,
    marksLayer, stageLabelEl, stageMetaEl, tipLabelEl, tipTextEl, tipNextBtn,
  };
}
