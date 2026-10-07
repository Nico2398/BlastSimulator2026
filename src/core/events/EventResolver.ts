// BlastSimulator2026 — Event resolution system
// Applies consequences of player decisions. Outcomes hidden until chosen.

import type { Random } from '../math/Random.js';
import { clampScore, type ScoreState } from '../scores/ScoreManager.js';
import type { FinanceState } from '../economy/Finance.js';
import { addIncome, addExpense } from '../economy/Finance.js';
import { applyExposure } from './MafiaActions.js';
import type { EventConsequence } from './EventPool.js';
import { getEventById } from './EventPool.js';
import type { EventSystemState, EventEffect, EventOutcome } from './EventSystem.js';
import { TRAFFIC_JAM_EFFECTS, type EventWorld, type EffectOutcome } from './TrafficJamEffects.js';
import { UNQUALIFIED_TASK_EFFECTS } from './UnqualifiedTaskEffects.js';
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
  /** Cash the caller still has to apply to the flat `state.cash` (finances log already updated). */
  cashChange: number;
  /** Cash a world effect already debited from state itself (e.g. a widen order): shown in the outcome chip, never re-applied. */
  cashSettled: number;
  scoreChanges: Partial<Record<keyof ScoreState, number>>;
  corruptionChange: number;
  followUpQueued: string | null;
  /** Mafia exposure actually applied (fraction 0-1, signed) when the option carried an exposure delta. */
  exposureChange?: number;
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
  world?: EventWorld,
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

  // A jam or unqualified-task event carries what it concerns: the option's
  // effect tag names the world change to make.
  const { jam, unqualifiedActionIds } = eventSystem.pendingEvent;
  const tag = consequence.effectTag;
  if (world && jam && tag && TRAFFIC_JAM_EFFECTS[tag]) {
    mergeOutcome(result, TRAFFIC_JAM_EFFECTS[tag]!(jam, world, tick));
  } else if (world && unqualifiedActionIds && tag && UNQUALIFIED_TASK_EFFECTS[tag]) {
    // The raw tag is an internal name, not something to show the player.
    result.effects = result.effects.filter(e => e !== tag);
    mergeOutcome(result, UNQUALIFIED_TASK_EFFECTS[tag]!(unqualifiedActionIds, world, tick));
  }

  if (world && resolved.exposureDelta) {
    const mafia = world.state.mafia;
    const before = mafia.exposureRisk;
    applyExposure(mafia, resolved.exposureDelta);
    result.exposureChange = mafia.exposureRisk - before;
    result.effects.push(`Exposure ${resolved.exposureDelta > 0 ? '+' : ''}${Math.round(resolved.exposureDelta * 100)}%`);
  }

  // Clear the pending event; record the outcome for the UI to read directly
  // instead of parsing this function's console-facing effects: string[].
  clearPendingEvent(eventSystem);
  eventSystem.lastOutcome = buildEventOutcome(result);

  return result;
}

/** Fold a world-effect handler's outcome into the resolution it extends. */
function mergeOutcome(result: ResolutionResult, outcome: EffectOutcome): void {
  result.effects.push(...outcome.effects);
  result.cashChange += outcome.cashChange;
  result.cashSettled += outcome.cashSettled;
  for (const [k, d] of Object.entries(outcome.scoreChanges) as [keyof ScoreState, number][]) {
    result.scoreChanges[k] = (result.scoreChanges[k] ?? 0) + d;
  }
  result.resultKey += outcome.resultKeySuffix;
}

/**
 * Structured replacement for ResolutionResult.effects's pre-formatted English
 * sentences ("Gained $500", "safety +8") — built from the same already-
 * structured cashChange/scoreChanges/corruptionChange/followUpQueued fields,
 * not by re-parsing the sentences themselves.
 */
function buildEventOutcome(result: ResolutionResult): EventOutcome {
  const effects: EventEffect[] = [];

  const shownCash = result.cashChange + result.cashSettled;
  if (shownCash !== 0) {
    effects.push({ kind: 'cash', key: 'cash', delta: shownCash });
  }
  for (const [key, delta] of Object.entries(result.scoreChanges)) {
    effects.push({ kind: 'score', key, delta: delta as number });
  }
  if (result.corruptionChange !== 0) {
    effects.push({ kind: 'other', key: 'corruption', delta: result.corruptionChange });
  }
  if (result.exposureChange) {
    // Shown in percentage points, like the console line.
    effects.push({ kind: 'other', key: 'exposure', delta: Math.round(result.exposureChange * 100) });
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
    cashSettled: 0,
    scoreChanges,
    corruptionChange,
    followUpQueued,
  };
}
