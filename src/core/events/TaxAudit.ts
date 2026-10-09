// BlastSimulator2026 — Tax audit of smuggled income (#1409).
// Open books with an audit clock; see docs/plans/issue-1409-smuggling-balance.md.

import type { Random } from '../math/Random.js';
import {
  TAX_AUDIT_TIME_BASE_TICKS,
  TAX_AUDIT_CHANCE_AT_ZERO,
  TAX_AUDIT_CHANCE_AT_SWEET_SPOT,
  TAX_AUDIT_CHANCE_AT_MAX,
  TAX_AUDIT_GAIN_AT_SWEET_SPOT,
  TAX_AUDIT_GAIN_AT_MAX,
  TAX_AUDIT_SWEET_SPOT_SHARE,
  TAX_AUDIT_MAX_RISK_SHARE,
  TAX_AUDIT_COOLDOWN_TICKS,
  TAX_AUDIT_RAMP_TICKS,
  TAX_RECIDIVISM_SURCHARGE,
  TAX_RECIDIVISM_MAX_STEPS,
} from '../config/balance.js';

/** Designer inputs of the audit model plus the secondary knobs; tests may override any. */
export interface TaxAuditParams {
  /** B: period the chances refer to, in ticks. */
  timeBase: number;
  /** P0, P20, P50: audit chance within B at shares 0, s1, s2. */
  p0: number;
  p20: number;
  p50: number;
  /** E20, E50: expected gain at shares s1, s2. */
  e20: number;
  e50: number;
  /** s1, s2: sweet-spot and max-risk shares. */
  s1: number;
  s2: number;
  /** Cooldown ticks with a stopped clock after an audit. */
  cooldown: number;
  /** Ticks over which the clock speed ramps from 0 to 1 after the cooldown. */
  ramp: number;
  /** Recidivism: added to the multiplier per earlier conviction (0 turns it off). */
  surcharge: number;
  /** Recidivism: cap on counted convictions. */
  maxSteps: number;
}

export const DEFAULT_TAX_AUDIT_PARAMS: TaxAuditParams = {
  timeBase: TAX_AUDIT_TIME_BASE_TICKS,
  p0: TAX_AUDIT_CHANCE_AT_ZERO,
  p20: TAX_AUDIT_CHANCE_AT_SWEET_SPOT,
  p50: TAX_AUDIT_CHANCE_AT_MAX,
  e20: TAX_AUDIT_GAIN_AT_SWEET_SPOT,
  e50: TAX_AUDIT_GAIN_AT_MAX,
  s1: TAX_AUDIT_SWEET_SPOT_SHARE,
  s2: TAX_AUDIT_MAX_RISK_SHARE,
  cooldown: TAX_AUDIT_COOLDOWN_TICKS,
  ramp: TAX_AUDIT_RAMP_TICKS,
  surcharge: TAX_RECIDIVISM_SURCHARGE,
  maxSteps: TAX_RECIDIVISM_MAX_STEPS,
};

/** One day of income on the open books. */
export interface AuditBucket {
  day: number;
  legit: number;
  smuggled: number;
  /** Audit clock value when the income was earned. */
  clockAtEarn: number;
}

export interface TaxAuditState {
  buckets: AuditBucket[];
  /** Audit clock X, advances at the clock speed per tick. */
  clock: number;
  lastAuditTick: number | null;
  /** Convictions this level (drives the recidivism surcharge). */
  convictions: number;
  /** Regularisation owed, collected from income. */
  debt: number;
  auditsCount: number;
}

export type AuditOutcome =
  | { kind: 'clean'; tick: number }
  | { kind: 'regularisation'; tick: number; owed: number; smuggled: number; share: number; convictions: number };

/** S(s) = s / (1 - s): smuggling income per unit of legit income at share s. */
export function smugglingIncomeRatio(_share: number): number {
  return undefined as unknown as number; // TODO: implement
}

/** P(s): audit chance within one time base at share s. */
export function auditChance(_share: number, _p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS): number {
  return undefined as unknown as number; // TODO: implement
}

/** G*(s): target expected gain as a fraction of legit income. */
export function targetGain(_share: number, _p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS): number {
  return undefined as unknown as number; // TODO: implement
}

/** rho(s): regularisation multiplier at share s, without recidivism surcharge. */
export function regularisationMultiplier(_share: number, _p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS): number {
  return undefined as unknown as number; // TODO: implement
}

/** Checks the valid-input constraints of the model. */
export function validateTaxAuditParams(_p: TaxAuditParams): { ok: true } | { ok: false; reason: string } {
  return { ok: true }; // TODO: implement
}

/** Per-tick audit probability: 1 - (1 - chance)^(speed / timeBase). */
export function auditHazard(_chance: number, _speed: number, _timeBase: number): number {
  return undefined as unknown as number; // TODO: implement
}

/** Audit clock speed m: 0 in cooldown, linear 0 to 1 over the ramp, 1 otherwise (null = never audited). */
export function auditClockSpeed(_sinceAuditTicks: number | null, _cooldown: number, _ramp: number): number {
  return undefined as unknown as number; // TODO: implement
}

/** Closing audit look-back T = -B ln(u) / -ln(1 - chance), in clock time. */
export function closingLookBack(_chance: number, _timeBase: number, _u: number): number {
  return undefined as unknown as number; // TODO: implement
}

export function createTaxAuditState(): TaxAuditState {
  return { buckets: [], clock: 0, lastAuditTick: null, convictions: 0, debt: 0, auditsCount: 0 };
}

/** Books one tick of income into the day's bucket. */
export function bookTaxAuditIncome(_a: TaxAuditState, _tick: number, _legit: number, _smuggled: number): void {
  // TODO: implement
}

/** Advances the clock, prescribes old buckets, may audit. */
export function tickTaxAudit(
  _a: TaxAuditState,
  _tick: number,
  _rng: Random,
  _p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS,
): AuditOutcome | null {
  return null; // TODO: implement
}

/** Closing audit at level completion; null when the books hold no smuggling. */
export function closingAudit(
  _a: TaxAuditState,
  _rng: Random,
  _p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS,
): AuditOutcome | null {
  return null; // TODO: implement
}

/** Takes up to `cash` of the debt out of `income`; returns the amount collected. */
export function collectAuditDebt(_a: TaxAuditState, _income: number, _cash: number): number {
  return undefined as unknown as number; // TODO: implement
}
