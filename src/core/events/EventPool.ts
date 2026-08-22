// BlastSimulator2026 — Event pool: defines event structure
// Each event has weight coefficients, prerequisites, and decision options.

import type { ScoreState } from '../scores/ScoreManager.js';

// ── Event types ──

export type EventCategory = 'union' | 'politics' | 'weather' | 'mafia' | 'lawsuit' | 'traffic' | 'mining' | 'tutorial';

export interface EventOption {
  /** i18n key for option text. */
  labelKey: string;
  /** i18n key for the resolved-outcome sentence shown after this option is chosen. */
  resultKey: string;
  /**
   * Hand-authored consequence-chip hints for the choose-phase row. Leave unset —
   * getOptionEffectHints derives the same information from the parallel
   * EventConsequence, so hand-authoring here is only for the rare case where
   * that derivation doesn't fit.
   */
  effects?: EventOptionEffectHint[];
}

/** One consequence-chip hint shown before the player chooses an option. No delta magnitude — the real outcome may be probabilistic, so only kind/direction are promised ahead of the choice. */
export interface EventOptionEffectHint {
  kind: 'cash' | 'score' | 'other';
  /** 'cash' for the cash hint; a ScoreState key for a score hint; a free-form tag (e.g. 'corruption', 'followUp') for 'other'. */
  key: string;
  direction: 'positive' | 'negative' | 'neutral';
  /** True when the option's consequence is probabilistic — this hint describes the main branch, which may not be what actually happens. */
  risky?: boolean;
}

export interface EventConsequence {
  cashDelta?: number;
  scoreDelta?: Partial<Record<keyof ScoreState, number>>;
  /** Follow-up event ID to queue. */
  followUpEventId?: string;
  /** Corruption change. */
  corruptionDelta?: number;
  /** Custom effect tag for the resolver to interpret. */
  effectTag?: string;
  /** Probability this outcome occurs (1.0 = certain). */
  probability?: number;
  /** Alternative consequence if probability fails. */
  altConsequence?: EventConsequence;
  /**
   * Marks this option as the deliberate, paid-for resolution of an active
   * death-safety crisis (#698) — choosing it is what lifts
   * `reassertFloorIfCrisisActive`'s post-death safety floor, as opposed to
   * any other option that merely happens to raise `safety` alongside a cash
   * cost (a fine, a bribe, an unrelated settlement). Set only on options
   * genuinely gated on `deathCount` and intended as that gate's payoff —
   * see LawsuitEvents1.ts's `lawsuit_wrongful_death`/`lawsuit_criminal_negligence`.
   * Never inferred from delta shape; must be explicit per option.
   */
  resolvesDeathCrisis?: boolean;
}

export interface EventDef {
  id: string;
  category: EventCategory;
  /** i18n key for event title. */
  titleKey: string;
  /** i18n key for event description. */
  descKey: string;
  /** Decision options (2-4). */
  options: EventOption[];
  /** Consequences per option index. Hidden from player until chosen. */
  consequences: EventConsequence[];
  /**
   * Weight coefficient function.
   * Base ~1.0. Higher = more likely to be selected.
   * Takes score ratios (0-1) as input.
   */
  weightCoeff: (scores: ScoreState) => number;
  /** Prerequisite check. Returns true if event can fire. */
  canFire: (ctx: EventContext) => boolean;
}

/** Context passed to prerequisite checks. */
export interface EventContext {
  scores: ScoreState;
  employeeCount: number;
  deathCount: number;
  corruptionLevel: number;
  hasBuilding: (type: string) => boolean;
  hasDrillPlan: boolean;
  tickCount: number;
  lawsuitCount: number;
  activeContractCount: number;
  weatherId: string;
}

// ── Event pool ──

const allEvents: EventDef[] = [];

/** Register events into the global pool. */
export function registerEvents(events: EventDef[]): void {
  for (const e of events) {
    allEvents.push(e);
  }
}

/** Get all registered events. */
export function getAllEvents(): readonly EventDef[] {
  return allEvents;
}

/** Get events by category. */
export function getEventsByCategory(category: EventCategory): EventDef[] {
  return allEvents.filter(e => e.category === category);
}

/** Get a specific event by ID. */
export function getEventById(id: string): EventDef | undefined {
  return allEvents.find(e => e.id === id);
}

/** Clear all events (for testing). */
export function clearEvents(): void {
  allEvents.length = 0;
}

// ── Choose-phase consequence hints ──

/**
 * Consequence-chip hints for one option, for the choose-phase row. Returns
 * the option's own effects if the def hand-authored them, otherwise derives
 * hints from its parallel EventConsequence. An empty array means the row
 * renders label-only.
 */
export function getOptionEffectHints(
  option: EventOption,
  consequence: EventConsequence | undefined,
): EventOptionEffectHint[] {
  if (option.effects) return option.effects;
  if (!consequence) return [];
  return deriveEffectHints(consequence);
}

function deriveEffectHints(c: EventConsequence): EventOptionEffectHint[] {
  const risky = c.probability !== undefined && c.probability < 1;
  const hints: EventOptionEffectHint[] = [];

  const push = (kind: EventOptionEffectHint['kind'], key: string, direction: EventOptionEffectHint['direction']) => {
    const hint: EventOptionEffectHint = { kind, key, direction };
    if (risky) hint.risky = true;
    hints.push(hint);
  };

  if (c.cashDelta) push('cash', 'cash', c.cashDelta > 0 ? 'positive' : 'negative');
  if (c.scoreDelta) {
    for (const [key, val] of Object.entries(c.scoreDelta)) {
      if (val) push('score', key, val > 0 ? 'positive' : 'negative');
    }
  }
  if (c.corruptionDelta) push('other', 'corruption', c.corruptionDelta > 0 ? 'positive' : 'negative');
  if (c.followUpEventId) push('other', 'followUp', 'neutral');

  return hints;
}
