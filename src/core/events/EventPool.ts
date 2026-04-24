// BlastSimulator2026 — Event pool: defines event structure
// Each event has weight coefficients, prerequisites, and decision options.

import type { ScoreState } from '../scores/ScoreManager.js';

// ── Event types ──

export type EventCategory = 'union' | 'politics' | 'weather' | 'mafia' | 'lawsuit' | 'traffic';

export interface EventOption {
  /** i18n key for option text. */
  labelKey: string;
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
