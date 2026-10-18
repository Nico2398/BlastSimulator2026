import { isRisky, type EventConsequence, type EventDef } from './EventPool.js';
import type { EventEffectSpec } from './EventEffectCatalog.js';
import {
  EVENT_BALANCE_PERMANENT_DAYS, EVENT_BALANCE_REFERENCE_CREW, EVENT_BALANCE_PERMIT_APPROVE_TICKS, EVENT_BALANCE_REFERENCE_PERMIT_FEE,
} from '../config/balance.js';

/** Signed expected-value dimensions of one option; higher is always better for the player. */
type OptionDims = Readonly<Record<string, number>>;

/** Expected value of one option. */
interface OptionValue {
  dims: OptionDims;
  /** Signature of effects that cannot be compared numerically; options only dominate on equal signatures. */
  opaque: string;
}

/** One option of an event that is strictly worse than another option of the same event. */
interface DominatedPair {
  eventId: string;
  winner: number;
  loser: number;
}

const TOLERANCE = 1e-9;

type DimEntry = readonly [dim: string, value: number];

/** Numeric dims one effect spec contributes (higher = better); null when the spec is opaque. */
function specDims(spec: EventEffectSpec): DimEntry[] | null {
  switch (spec.type) {
    case 'work_stoppage': return [['work', -spec.hours]];
    case 'work_rate': return [['work', (spec.pct / 100) * spec.hours]];
    case 'morale_shift': return [['morale', spec.perHour * spec.hours]];
    case 'fatigue_relief': return [['fatigue', 1]];
    case 'employee_leaves': return [['crew', -1]];
    case 'employee_joins': return [['crew', 1]];
    case 'employee_injured': return [['injury', -1]];
    case 'salary': return [['payroll', -spec.pct * (spec.days ?? EVENT_BALANCE_PERMANENT_DAYS)]];
    case 'bonus_per_employee': return [['cash', -spec.amount * EVENT_BALANCE_REFERENCE_CREW]];
    case 'recurring_charge': return [['cash', -spec.perDay * spec.days]];
    case 'ban': return [['ban', -spec.hours]];
    case 'cost_factor': return [['costs', -spec.pct * spec.days]];
    case 'contract_price': return [['income', spec.pct * spec.days]];
    case 'special_contract': return [['income', 1]];
    case 'cancel_contract': return [['contracts', spec.penalty ? -2 : -1]];
    case 'vehicle_breakdown': return [['outOfService', -spec.hours]];
    case 'building_closed': return [['outOfService', -spec.hours]];
    case 'forced_weather': return null;
    case 'event_weight': return null;
    case 'permit_processing':
      return spec.action === 'shift'
        ? [['permit', -Math.max(spec.ticks, spec.ticksBelow ?? spec.ticks)]]
        : [['permit', EVENT_BALANCE_PERMIT_APPROVE_TICKS], ['cash', -(spec.feePct / 100) * EVENT_BALANCE_REFERENCE_PERMIT_FEE]];
    default: return spec satisfies never;
  }
}

/** Adds one consequence's own fields (not its alt branch) at the given branch weight. */
function addBranch(c: EventConsequence, w: number, dims: Record<string, number>, opaque: string[]): void {
  const add = (dim: string, v: number): void => { dims[dim] = (dims[dim] ?? 0) + v * w; };
  if (c.cashDelta) add('cash', c.cashDelta);
  for (const [key, v] of Object.entries(c.scoreDelta ?? {})) if (v) add(key, v);
  if (c.corruptionDelta) add('corruption', -c.corruptionDelta);
  if (c.exposureDelta) add('exposure', -c.exposureDelta);
  if (c.followUpEventId) opaque.push(`fu:${c.followUpEventId}@${w}`);
  for (const spec of c.effects ?? []) {
    const entries = specDims(spec);
    if (entries === null) opaque.push(`${JSON.stringify(spec)}@${w}`);
    else for (const [dim, v] of entries) add(dim, v);
  }
}

/**
 * Expected value of one option: signed dimensions (higher = better) plus an opaque signature.
 * Outcomes produced by effectTag handlers (traffic, unqualified) are unvalued here and
 * must be reviewed by hand.
 */
export function optionValue(c: EventConsequence): OptionValue {
  const dims: Record<string, number> = {};
  const opaque: string[] = [];
  const p = isRisky(c) ? c.probability! : 1;
  addBranch(c, p, dims, opaque);
  if (p < 1 && c.altConsequence) addBranch(c.altConsequence, 1 - p, dims, opaque);
  return { dims, opaque: opaque.sort().join('|') };
}

/** True when a >= b on every dim, > on one, and a.opaque === b.opaque. */
export function dominates(a: OptionValue, b: OptionValue): boolean {
  if (a.opaque !== b.opaque) return false;
  let strictlyBetter = false;
  for (const dim of new Set([...Object.keys(a.dims), ...Object.keys(b.dims)])) {
    const diff = (a.dims[dim] ?? 0) - (b.dims[dim] ?? 0);
    if (diff < -TOLERANCE) return false;
    if (diff > TOLERANCE) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Every (winner, loser) option index pair of the event where winner dominates loser. */
export function findDominatedPairs(ev: EventDef): DominatedPair[] {
  const values = ev.consequences.map(optionValue);
  const pairs: DominatedPair[] = [];
  values.forEach((a, winner) => values.forEach((b, loser) => {
    if (winner !== loser && dominates(a, b)) pairs.push({ eventId: ev.id, winner, loser });
  }));
  return pairs;
}
