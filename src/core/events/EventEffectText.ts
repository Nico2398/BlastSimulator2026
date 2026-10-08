// BlastSimulator2026 — Outcome chips describing declarative event effects (#1414)

import type { EventEffect } from './EventSystem.js';
import type { EventEffectSpec } from './EventEffectCatalog.js';

/** One chip per spec; textKey is an i18n key, params carry the numbers to interpolate. */
export interface EventEffectChip extends EventEffect {
  params?: Record<string, string | number>;
}

export function effectChips(specs: readonly EventEffectSpec[] | undefined): EventEffectChip[] {
  void specs;
  return [];
}
