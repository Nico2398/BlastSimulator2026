// BlastSimulator2026 — Tax audit of smuggled income (#1409).
// Open books with an audit clock; see docs/plans/issue-1409-smuggling-balance.md.

import { Random } from '../math/Random.js';
import { chargeFine, type FinanceState } from '../economy/Finance.js';
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
  TICKS_PER_DAY,
  BANKRUPTCY_THRESHOLD,
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

const clampShare = (share: number): number => Math.min(1, Math.max(0, share));

/** S(s) = s / (1 - s): smuggling income per unit of legit income at share s. */
export function smugglingIncomeRatio(share: number): number {
  return share / (1 - share);
}

/** P(s): audit chance within one time base at share s. */
export function auditChance(share: number, p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS): number {
  const s = clampShare(share);
  if (s <= p.s1) return p.p0 + ((p.p20 - p.p0) * s) / p.s1;
  if (s <= p.s2) return p.p20 + ((p.p50 - p.p20) * (s - p.s1)) / (p.s2 - p.s1);
  return p.p50;
}

/** G*(s): target expected gain as a fraction of legit income. */
export function targetGain(share: number, p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS): number {
  const s = clampShare(share);
  if (s <= p.s1) return (p.e20 * s) / p.s1;
  if (s <= p.s2) return p.e20 + ((p.e50 - p.e20) * (s - p.s1)) / (p.s2 - p.s1);
  return (p.e50 * smugglingIncomeRatio(s)) / smugglingIncomeRatio(p.s2);
}

/** G*(s) / S(s), finite at both ends of the share range (s = 0 and s = 1). */
function targetGainPerSmuggledUnit(s: number, p: TaxAuditParams): number {
  if (s <= p.s1) return (p.e20 * (1 - s)) / p.s1;
  if (s <= p.s2) return targetGain(s, p) / smugglingIncomeRatio(s);
  return p.e50 / smugglingIncomeRatio(p.s2);
}

/** rho(s): regularisation multiplier at share s, without recidivism surcharge. */
export function regularisationMultiplier(share: number, p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS): number {
  const s = clampShare(share);
  return (1 - targetGainPerSmuggledUnit(s, p)) / auditChance(s, p);
}

const RHO_SCAN_STEPS = 1000;
const RHO_EPSILON = 1e-9;

/** Checks the valid-input constraints of the model. */
export function validateTaxAuditParams(p: TaxAuditParams): { ok: true } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!(p.timeBase > 0)) return fail('time base must be positive');
  if (!(p.p0 > 0 && p.p0 <= p.p20 && p.p20 <= p.p50 && p.p50 < 1)) return fail('need 0 < P0 <= P20 <= P50 < 1');
  if (!(p.e50 < 0 && p.e20 > 0)) return fail('need E50 < 0 < E20');
  if (!(p.s1 > 0 && p.s1 < p.s2 && p.s2 < 1)) return fail('need 0 < s1 < s2 < 1');
  if (!(p.cooldown >= 0 && p.ramp >= 0)) return fail('cooldown and ramp must not be negative');
  if (!(p.surcharge >= 0 && p.maxSteps >= 0)) return fail('recidivism surcharge and steps must not be negative');
  if (p.e20 > p.s1 * (1 - p.p0) - RHO_EPSILON) return fail('E20 too high: rho would drop below 1 at tiny shares');
  const sweetSpotCap = (p.s1 / (1 - p.s1)) * (1 - p.p20);
  if (p.e20 > sweetSpotCap - RHO_EPSILON) return fail('E20 too high: rho would drop below 1 at the sweet spot');
  for (let i = 1; i < RHO_SCAN_STEPS; i++) {
    if (regularisationMultiplier(i / RHO_SCAN_STEPS, p) < 1 + RHO_EPSILON) return fail('rho drops below 1');
  }
  const recidivismCost = p.surcharge * p.maxSteps *
    (((p.p20 - p.p0) / p.s1) * smugglingIncomeRatio(p.s1) + p.p20 / ((1 - p.s1) * (1 - p.s1)));
  if (recidivismCost >= p.e20 / p.s1) return fail('recidivism could pull the peak below the sweet spot');
  return { ok: true };
}

/** Per-tick audit probability: 1 - (1 - chance)^(speed / timeBase). */
export function auditHazard(chance: number, speed: number, timeBase: number): number {
  return 1 - Math.pow(1 - chance, speed / timeBase);
}

/** Audit clock speed m: 0 in cooldown, linear 0 to 1 over the ramp, 1 otherwise (null = never audited). */
export function auditClockSpeed(sinceAuditTicks: number | null, cooldown: number, ramp: number): number {
  if (sinceAuditTicks === null) return 1;
  if (sinceAuditTicks < cooldown) return 0;
  if (ramp > 0 && sinceAuditTicks < cooldown + ramp) return (sinceAuditTicks - cooldown) / ramp;
  return 1;
}

/** Closing audit look-back T = -B ln(u) / -ln(1 - chance), in clock time. */
export function closingLookBack(chance: number, timeBase: number, u: number): number {
  return (-timeBase * Math.log(u)) / -Math.log(1 - chance);
}

/** Dedicated stream for audit draws: a pure function of seed and tick, so it shifts no other stream. */
export function taxAuditRng(seed: number, tick: number): Random {
  return new Random((seed + Math.imul(tick, 0x9e3779b1)) | 0);
}

export function createTaxAuditState(): TaxAuditState {
  return { buckets: [], clock: 0, lastAuditTick: null, convictions: 0, debt: 0, auditsCount: 0 };
}

/** Books one tick of income into the day's bucket. */
export function bookTaxAuditIncome(a: TaxAuditState, tick: number, legit: number, smuggled: number): void {
  if (legit <= 0 && smuggled <= 0) return;
  const day = Math.floor(tick / TICKS_PER_DAY);
  const last = a.buckets[a.buckets.length - 1];
  if (last && last.day === day) {
    last.legit += legit;
    last.smuggled += smuggled;
    return;
  }
  a.buckets.push({ day, legit, smuggled, clockAtEarn: a.clock });
}

function totals(buckets: readonly AuditBucket[]): { legit: number; smuggled: number; share: number } {
  let legit = 0;
  let smuggled = 0;
  for (const b of buckets) {
    legit += b.legit;
    smuggled += b.smuggled;
  }
  const total = legit + smuggled;
  return { legit, smuggled, share: total > 0 ? smuggled / total : 0 };
}

/** Price of regularising `smuggled`: the multiplier at `share` plus the capped recidivism surcharge. */
function regularisationPrice(a: TaxAuditState, share: number, smuggled: number, p: TaxAuditParams): number {
  const surcharge = p.surcharge * Math.min(a.convictions, p.maxSteps);
  return (regularisationMultiplier(share, p) + surcharge) * smuggled;
}

/** Advances the clock, prescribes old buckets, may audit. */
export function tickTaxAudit(
  a: TaxAuditState,
  tick: number,
  rng: Random,
  p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS,
): AuditOutcome | null {
  const since = a.lastAuditTick === null ? null : tick - a.lastAuditTick;
  const speed = auditClockSpeed(since, p.cooldown, p.ramp);
  a.clock += speed;
  while (a.buckets.length > 0 && a.clock - a.buckets[0]!.clockAtEarn >= p.timeBase) a.buckets.shift();

  const { smuggled, share } = totals(a.buckets);
  if (!(rng.next() < auditHazard(auditChance(share, p), speed, p.timeBase))) return null;

  const owed = smuggled > 0 ? regularisationPrice(a, share, smuggled, p) : 0;
  a.buckets = [];
  a.lastAuditTick = tick;
  a.auditsCount++;
  if (smuggled <= 0) return { kind: 'clean', tick };
  a.convictions++;
  a.debt += owed;
  return { kind: 'regularisation', tick, owed, smuggled, share, convictions: a.convictions };
}

/** Closing audit at level completion; null when the books hold no smuggling. */
export function closingAudit(
  a: TaxAuditState,
  rng: Random,
  p: TaxAuditParams = DEFAULT_TAX_AUDIT_PARAMS,
  tick = 0,
): AuditOutcome | null {
  const { smuggled: booked, share } = totals(a.buckets);
  if (booked <= 0) return null;

  const u = Math.max(rng.next(), 1e-12);
  const lookBack = closingLookBack(auditChance(share, p), p.timeBase, u);
  const reached: AuditBucket[] = [];
  const kept: AuditBucket[] = [];
  for (const b of a.buckets) (p.timeBase - (a.clock - b.clockAtEarn) > lookBack ? reached : kept).push(b);
  a.buckets = kept;
  a.auditsCount++;

  const { smuggled } = totals(reached);
  if (smuggled <= 0) return { kind: 'clean', tick };
  const owed = regularisationPrice(a, share, smuggled, p);
  a.convictions++;
  a.debt += owed;
  return { kind: 'regularisation', tick, owed, smuggled, share, convictions: a.convictions };
}

/**
 * Takes the part of the debt that `income` and the cash above the bankruptcy floor can cover;
 * reduces the debt by it and returns the amount. A regularisation never bankrupts: the rest waits.
 */
export function collectAuditDebt(a: TaxAuditState, income: number, cash: number): number {
  const available = Math.max(0, cash - BANKRUPTCY_THRESHOLD);
  const amount = Math.max(0, Math.min(a.debt, income, available));
  a.debt -= amount;
  return amount;
}

/** Charges what `collectAuditDebt` allows as a fine; returns the amount paid. */
export function payTaxAuditDebt(
  state: { cash: number; finances: FinanceState; taxAudit: TaxAuditState },
  income: number,
  tick: number,
): number {
  const amount = collectAuditDebt(state.taxAudit, income, state.cash);
  chargeFine(state, amount, 'Tax audit regularisation', tick);
  return amount;
}
