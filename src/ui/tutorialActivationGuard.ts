// BlastSimulator2026 — Tutorial activation guard
//
// The CSS rails make railed controls inert to the pointer only. This guard closes the
// keyboard path (Enter/Space on a focused control, and shortcuts that drive a control).

import { GUIDED_CLASS, ALLOWED_CLASS } from './tutorialGuide.js';

/** Controls the rail rule in styles.ts (`body.bs-tutorial-guided ...:not(.bs-tutorial-allowed)`) makes inert. */
export const RAILED_CONTROL_SELECTOR =
  'button, select, input, .bs-detail-toggle, .bs-survey-method';

/** Keys that stay free so a railed control never traps focus or hides the Escape cascade. */
const PASS_THROUGH_KEYS: ReadonlySet<string> = new Set([
  'Tab', 'Shift', 'Escape', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS',
]);

function isGuided(doc: Document): boolean {
  return doc.body?.classList.contains(GUIDED_CLASS) === true;
}

/** True when the tutorial holds the rails and the target sits in a railed control not marked allowed. */
export function isRailedControl(target: EventTarget | null, doc: Document = document): boolean {
  if (!isGuided(doc)) return false;
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const control = target.closest(RAILED_CONTROL_SELECTOR);
  return control !== null && !control.classList.contains(ALLOWED_CLASS);
}

/** True when the control matching `selector` may be activated: not guided, absent, or marked allowed. */
export function isControlLive(selector: string, doc: Document = document): boolean {
  if (!isGuided(doc)) return true;
  const el = doc.querySelector(selector);
  return el === null || el.classList.contains(ALLOWED_CLASS);
}

/** Installs capture-phase click and keydown listeners; returns a disposer. */
export function installActivationGuard(doc: Document = document): () => void {
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onClick = (e: Event): void => {
    if (isRailedControl(e.target, doc)) swallow(e);
  };
  const onKeydown = (e: Event): void => {
    if (PASS_THROUGH_KEYS.has((e as KeyboardEvent).key)) return;
    if (isRailedControl(e.target, doc)) swallow(e);
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKeydown, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKeydown, true);
  };
}
