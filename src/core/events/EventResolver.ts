// BlastSimulator2026 — Event resolution system
// Applies consequences of player decisions. Outcomes hidden until chosen.

import type { Random } from '../math/Random.js';
import { clampScore, type ScoreState } from '../scores/ScoreManager.js';
import type { FinanceState } from '../economy/Finance.js';
import { addIncome, addExpense } from '../economy/Finance.js';
import type { EventConsequence } from './EventPool.js';
import { getEventById } from './EventPool.js';
import type { EventSystemState, EventEffect, EventOutcome } from './EventSystem.js';
import { clearPendingEvent, queueFollowUp } from './EventSystem.js';

// ── Resolution result ──

export interface ResolutionResult {
  success: boolean;
  eventId: string;
  optionIndex: number;
  /** i18n key for the resolved-outcome sentence. */
  resultKey: string;
  /** What actually happened (human-readable). */
  effects: string[];
  cashChange: number;
  scoreChanges: Partial<Record<keyof ScoreState, number>>;
  corruptionChange: number;
  followUpQueued: string | null;
}

/**
 * Resolve an event by applying the chosen option's consequences.
 * The consequence may be probabilistic — roll with rng.
 */
export function resolveEvent(
  eventSystem: EventSystemState,
  finances: FinanceState,
  scores: ScoreState,
  optionIndex: number,
  tick: number,
  rng: Random,
): ResolutionResult | null {
  if (!eventSystem.pendingEvent) return null;

  const eventDef = getEventById(eventSystem.pendingEvent.eventId);
  if (!eventDef) return null;

  if (optionIndex < 0 || optionIndex >= eventDef.options.length) return null;

  const consequence = eventDef.consequences[optionIndex];
  if (!consequence) return null;

  const option = eventDef.options[optionIndex];
  if (!option) return null;

  // Resolve probabilistic consequence
  const { consequence: resolved, isAlt } = resolveConsequence(consequence, rng);

  // Apply effects
  const result = applyConsequence(
    resolved,
    eventDef.id,
    optionIndex,
    option.resultKey,
    isAlt,
    finances,
    scores,
    eventSystem,
    tick,
  );

  // Clear the pending event; record the outcome for the UI to read directly
  // instead of parsing this function's console-facing effects: string[].
  clearPendingEvent(eventSystem);
  eventSystem.lastOutcome = buildEventOutcome(result);

  return result;
}

/**
 * Structured replacement for ResolutionResult.effects's pre-formatted English
 * sentences ("Gained $500", "safety +8") — built from the same already-
 * structured cashChange/scoreChanges/corruptionChange/followUpQueued fields,
 * not by re-parsing the sentences themselves.
 */
function buildEventOutcome(result: ResolutionResult): EventOutcome {
  const effects: EventEffect[] = [];

  if (result.cashChange !== 0) {
    effects.push({ kind: 'cash', key: 'cash', delta: result.cashChange });
  }
  for (const [key, delta] of Object.entries(result.scoreChanges)) {
    effects.push({ kind: 'score', key, delta: delta as number });
  }
  if (result.corruptionChange !== 0) {
    effects.push({ kind: 'other', key: 'corruption', delta: result.corruptionChange });
  }
  if (result.followUpQueued) {
    effects.push({ kind: 'other', key: 'followUp', delta: 0, textKey: 'ui.event.follow_up_developing' });
  }

  return { eventId: result.eventId, resultKey: result.resultKey, effects };
}

function resolveConsequence(
  c: EventConsequence,
  rng: Random,
): { consequence: EventConsequence; isAlt: boolean } {
  if (c.probability !== undefined && c.probability < 1.0) {
    if (rng.chance(c.probability)) {
      return { consequence: c, isAlt: false }; // Success path
    }
    return { consequence: c.altConsequence ?? {}, isAlt: c.altConsequence !== undefined }; // Failure path
  }
  return { consequence: c, isAlt: false };
}

function applyConsequence(
  c: EventConsequence,
  eventId: string,
  optionIndex: number,
  resultKey: string,
  isAlt: boolean,
  finances: FinanceState,
  scores: ScoreState,
  eventSystem: EventSystemState,
  tick: number,
): ResolutionResult {
  const effects: string[] = [];
  let cashChange = 0;
  const scoreChanges: Partial<Record<keyof ScoreState, number>> = {};
  let corruptionChange = 0;
  let followUpQueued: string | null = null;

  // Cash effect
  if (c.cashDelta) {
    cashChange = c.cashDelta;
    if (c.cashDelta > 0) {
      addIncome(finances, c.cashDelta, 'contracts', `Event: ${eventId}`, tick);
      effects.push(`Gained $${c.cashDelta}`);
    } else {
      addExpense(finances, Math.abs(c.cashDelta), 'fines', `Event: ${eventId}`, tick);
      effects.push(`Lost $${Math.abs(c.cashDelta)}`);
    }
  }

  // Score effects
  if (c.scoreDelta) {
    for (const [key, val] of Object.entries(c.scoreDelta)) {
      const k = key as keyof ScoreState;
      const v = val as number;
      scores[k] = clampScore(scores[k] + v);
      scoreChanges[k] = v;
      const dir = v > 0 ? '+' : '';
      effects.push(`${k} ${dir}${v}`);
    }
  }

  // Corruption
  if (c.corruptionDelta) {
    corruptionChange = c.corruptionDelta;
    effects.push(`Corruption ${c.corruptionDelta > 0 ? '+' : ''}${c.corruptionDelta}`);
  }

  // Follow-up
  if (c.followUpEventId) {
    queueFollowUp(eventSystem, c.followUpEventId);
    followUpQueued = c.followUpEventId;
    effects.push('A follow-up situation is developing...');
  }

  // Effect tag
  if (c.effectTag) {
    effects.push(c.effectTag);
  }

  return {
    success: true,
    eventId,
    optionIndex,
    resultKey: `${resultKey}${isAlt ? '_alt' : ''}`,
    effects,
    cashChange,
    scoreChanges,
    corruptionChange,
    followUpQueued,
  };
}
