import type { EventConsequence, EventDef } from './EventPool.js';
import type { EventSystemState } from './EventSystem.js';
import {
  UNION_GRIEVANCE_AFTER_STRIKE,
  UNION_GRIEVANCE_EASE_PER_MET,
  UNION_GRIEVANCE_MAX,
  UNION_GRIEVANCE_PER_REFUSAL,
  UNION_GRIEVANCE_STRIKE_THRESHOLD,
  UNION_STRIKE_MIN_MEMBERS,
} from '../config/balance.js';

export type UnionStance = 'refused' | 'met' | 'neutral';

/** Tag on union events that are the strike itself (#1890). */
export const STRIKE_EVENT_TAG = 'strike';

/** Classify a resolved union-event choice by its score effect: a well-being drop is a refusal (#1890). */
export function unionStance(c: Pick<EventConsequence, 'scoreDelta'>): UnionStance {
  const wb = c.scoreDelta?.wellBeing ?? 0;
  if (wb < 0) return 'refused';
  return wb > 0 ? 'met' : 'neutral';
}

/** Move grievance after a resolved union event: refusal raises, met demand eases, a strike resets (#1890). */
export function applyUnionDecision(
  state: Pick<EventSystemState, 'unionGrievance'>,
  def: Pick<EventDef, 'category' | 'tags'>,
  resolved: EventConsequence,
): void {
  if (def.category !== 'union') return;
  if (def.tags?.includes(STRIKE_EVENT_TAG)) {
    state.unionGrievance = UNION_GRIEVANCE_AFTER_STRIKE;
    return;
  }
  const stance = unionStance(resolved);
  const delta = stance === 'refused' ? UNION_GRIEVANCE_PER_REFUSAL
    : stance === 'met' ? -UNION_GRIEVANCE_EASE_PER_MET : 0;
  state.unionGrievance = Math.min(UNION_GRIEVANCE_MAX, Math.max(0, (state.unionGrievance ?? 0) + delta));
}

/** Grievance as 0..1 share of the strike threshold (#1890). */
export function strikePressure(grievance: number | undefined): number {
  return Math.min(1, Math.max(0, (grievance ?? 0) / UNION_GRIEVANCE_STRIKE_THRESHOLD));
}

/** Whether grievance and membership make a strike due (#1890). */
export function strikeDue(grievance: number | undefined, members: number | undefined): boolean {
  return grievance !== undefined && members !== undefined
    && grievance >= UNION_GRIEVANCE_STRIKE_THRESHOLD && members >= UNION_STRIKE_MIN_MEMBERS;
}
