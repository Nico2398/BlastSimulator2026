import type { EventConsequence, EventDef } from './EventPool.js';
import type { EventSystemState } from './EventSystem.js';

export type UnionStance = 'refused' | 'met' | 'neutral';

/** Classify a resolved union-event choice by its score effect (#1890). */
export function unionStance(_c: Pick<EventConsequence, 'scoreDelta'>): UnionStance {
  // TODO: implement
  return 'neutral';
}

/** Move grievance after a resolved union event: refusal raises, met demand eases (#1890). */
export function applyUnionDecision(
  _state: Pick<EventSystemState, 'unionGrievance'>,
  _def: Pick<EventDef, 'category' | 'tags'>,
  _resolved: EventConsequence,
): void {
  // TODO: implement
}

/** Grievance as 0..1 share of the strike threshold (#1890). */
export function strikePressure(_grievance: number | undefined): number {
  // TODO: implement
  return 0;
}

/** Whether grievance and membership make a strike due (#1890). */
export function strikeDue(_grievance: number | undefined, _members: number | undefined): boolean {
  // TODO: implement
  return false;
}
