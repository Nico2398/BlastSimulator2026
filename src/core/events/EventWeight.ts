// BlastSimulator2026 — Event weight (#2146)
// An event is major (a blocking modal) or minor (a non-blocking notice). The line is drawn by stakes.

import type { EventDef } from './EventPool.js';
import { EVENT_MAJOR_CASH_SHARE } from '../config/balance.js';

type EventWeight = 'major' | 'minor';

/** The part of an event outcome the weight rule and the default-answer rule read. */
interface OptionOutcome {
  readonly cashDelta?: number;
  readonly effects?: ReadonlyArray<{ readonly type: string }>;
  readonly altConsequence?: OptionOutcome;
}

/** Effect types that make an event major whichever option carries them. */
const MAJOR_EFFECT_TYPES: ReadonlySet<string> = new Set(['employee_leaves', 'ban', 'work_stoppage', 'cancel_contract']);

/** True when an outcome, or the fallback it may roll into, takes an employee off the crew (`employee_leaves`). */
export function outcomeCostsCrew(outcome: OptionOutcome | undefined): boolean {
  if (!outcome) return false;
  return (outcome.effects ?? []).some(e => e.type === 'employee_leaves') || outcomeCostsCrew(outcome.altConsequence);
}

/**
 * Index of the option with the highest `cashDelta` (missing = 0; lowest index on ties; 0 when empty) among those that
 * cost no crew, or among all of them when every option does. A free answer that makes an employee quit is not the cheap
 * one: the reinvest probe lost its only licensed fragmenter driver that way and left every later boulder unbroken (#2126).
 */
export function cheapestEventOption(consequences: ReadonlyArray<OptionOutcome>): number {
  const keepsCrew = consequences.map(c => !outcomeCostsCrew(c));
  const eligible = keepsCrew.some(Boolean) ? keepsCrew : consequences.map(() => true);
  let best = -1;
  for (let i = 0; i < consequences.length; i++) {
    if (!eligible[i]) continue;
    if (best === -1 || (consequences[i]!.cashDelta ?? 0) > (consequences[best]!.cashDelta ?? 0)) best = i;
  }
  return Math.max(0, best);
}

/** Whether an outcome (or its fallback) carries a major effect or a cash cost above `cashLimit`. */
function outcomeIsMajor(outcome: OptionOutcome | undefined, cashLimit: number): boolean {
  if (!outcome) return false;
  if ((outcome.effects ?? []).some(e => MAJOR_EFFECT_TYPES.has(e.type))) return true;
  const cash = outcome.cashDelta ?? 0;
  if (cash < 0 && -cash > cashLimit) return true;
  return outcomeIsMajor(outcome.altConsequence, cashLimit);
}

/** Categories detected from the world (or scripted) rather than drawn from a timer: always a modal. */
const ALWAYS_MAJOR_CATEGORIES: ReadonlySet<string> = new Set(['traffic', 'mining', 'tutorial']);

/** Major when any option carries a stakes effect or a heavy cash cost; engine-detected categories are always major. */
export function eventWeight(def: Pick<EventDef, 'category' | 'consequences'>, cash: number): EventWeight {
  if (ALWAYS_MAJOR_CATEGORIES.has(def.category)) return 'major';
  const cashLimit = EVENT_MAJOR_CASH_SHARE * Math.max(cash, 0);
  return def.consequences.some(c => outcomeIsMajor(c, cashLimit)) ? 'major' : 'minor';
}

export function isMajorEvent(def: Pick<EventDef, 'category' | 'consequences'>, cash: number): boolean {
  return eventWeight(def, cash) === 'major';
}

/** The option an ignored notice resolves to: the cheapest that keeps the crew. */
export function defaultNoticeOption(def: Pick<EventDef, 'consequences'>): number {
  return cheapestEventOption(def.consequences);
}
