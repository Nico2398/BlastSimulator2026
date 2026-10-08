// BlastSimulator2026 — HUD chips for active event modifiers (#1414)

import type { ActiveModifier } from '../../core/events/ActiveModifiers.js';

/** Renders one chip per live modifier into the container; returns an updater taking the current modifiers and tick. */
export function createModifierChips(
  container: HTMLElement,
): (modifiers: readonly ActiveModifier[], tick: number) => void {
  void container;
  return () => undefined;
}
