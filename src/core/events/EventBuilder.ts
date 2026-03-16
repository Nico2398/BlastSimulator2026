// BlastSimulator2026 — Event builder utility
// Compact helpers for defining events without verbose boilerplate.

import type { EventDef, EventCategory, EventContext, EventConsequence } from './EventPool.js';
import type { ScoreState } from '../scores/ScoreManager.js';

/** Shorthand for building an event definition. */
export function ev(
  id: string,
  category: EventCategory,
  opts: {
    weight: (s: ScoreState) => number;
    canFire?: (ctx: EventContext) => boolean;
    options: Array<{ cashDelta?: number; scoreDelta?: Partial<Record<keyof ScoreState, number>>;
      corruptionDelta?: number; followUp?: string; effectTag?: string;
      probability?: number; alt?: Omit<EventConsequence, 'probability' | 'altConsequence'>; }>;
  },
): EventDef {
  return {
    id,
    category,
    titleKey: `event.${id}.title`,
    descKey: `event.${id}.desc`,
    options: opts.options.map((_, i) => ({ labelKey: `event.${id}.opt${i}` })),
    consequences: opts.options.map(o => {
      const c: EventConsequence = {};
      if (o.cashDelta !== undefined) c.cashDelta = o.cashDelta;
      if (o.scoreDelta !== undefined) c.scoreDelta = o.scoreDelta;
      if (o.corruptionDelta !== undefined) c.corruptionDelta = o.corruptionDelta;
      if (o.followUp !== undefined) c.followUpEventId = o.followUp;
      if (o.effectTag !== undefined) c.effectTag = o.effectTag;
      if (o.probability !== undefined) c.probability = o.probability;
      if (o.alt !== undefined) c.altConsequence = o.alt;
      return c;
    }),
    weightCoeff: opts.weight,
    canFire: opts.canFire ?? (() => true),
  };
}

/** Score ratio helpers (0 to 1). */
export const r = {
  wb: (s: ScoreState) => s.wellBeing / 100,
  sf: (s: ScoreState) => s.safety / 100,
  ec: (s: ScoreState) => s.ecology / 100,
  nu: (s: ScoreState) => s.nuisance / 100,
};
