// BlastSimulator2026 — Tutorial activation guard
//
// The CSS rails make railed controls inert to the pointer only. This guard closes the
// keyboard path (Enter/Space on a focused control, and shortcuts that drive a control).

/** Controls the rail rule in styles.ts (`body.bs-tutorial-guided ...:not(.bs-tutorial-allowed)`) makes inert. */
export const RAILED_CONTROL_SELECTOR =
  'button, select, input, .bs-detail-toggle, .bs-survey-method';

/** True when the tutorial holds the rails and the target sits in a railed control not marked allowed. */
export function isRailedControl(_target: EventTarget | null, _doc?: Document): boolean {
  // TODO: implement
  return false;
}

/** True when the control matching `selector` may be activated: not guided, absent, or marked allowed. */
export function isControlLive(_selector: string, _doc?: Document): boolean {
  // TODO: implement
  return true;
}

/** Installs capture-phase click and keydown listeners; returns a disposer. */
export function installActivationGuard(_doc?: Document): () => void {
  // TODO: implement
  return () => undefined;
}
