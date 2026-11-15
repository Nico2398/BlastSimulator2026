// BlastSimulator2026 — Permit limits: per-blast charge/area caps and inspections (#1923)

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { LAST_NAMED_GRADE, gradeRung, registerUnlockLine, type GradeState } from './MineGrade.js';
import { tierPerksAt } from './TierPerks.js';
import { formatMoney } from './formatMoney.js';
import { Random, rollSeed } from '../math/Random.js';
import { chargeFine } from './Finance.js';
import { isEventShielded, markShielded } from './BribeProtection.js';
import { pushModifier } from '../events/ActiveModifiers.js';
import { clampScore } from '../scores/ScoreManager.js';
import {
  PERMIT_LIMITS, MINE_LAST_NAMED_RUNG, PERMIT_CLASS_CHARGE_FACTOR, PERMIT_CLASS_AREA_FACTOR, PERMIT_CLASS_FEE_FACTOR,
  PERMIT_INSPECTION_BASE_CHANCE, PERMIT_FINE_FEE_MULTIPLIER, PERMIT_CAUGHT_NEIGHBOUR_PENALTY,
  PERMIT_STRIKES_TO_SUSPEND, type PermitLimitConfig, PERMIT_STRIKE_WINDOW_TICKS, PERMIT_SUSPENSION_TICKS,
  INSPECTION_EVENT_TAG,
} from '../config/balance.js';


interface PreFireCheck {
  limits: PermitLimitConfig;
  planKg: number;
  /** Area (m²) of the plan's pattern cells (`patternAreaM2`). */
  planAreaM2: number;
  over: boolean;
  fee: number;
  /** Largest fractional excess over either limit; 0 when within limits. */
  overshoot: number;
}

export interface InspectionVerdict {
  rolled: boolean;
  caught: boolean;
  fine: number;
  overshoot: number;
  strikes: number;
  suspended: boolean;
}

/** Limits of a ladder step (see `gradeRung`); endless classes above G3 tier 3 scale by the class factors, the fee less the notification-fee perk. */
export function permitLimitsForRung(rung: number): PermitLimitConfig {
  const r = Math.max(0, Math.floor(rung));
  const named = PERMIT_LIMITS[Math.min(r, MINE_LAST_NAMED_RUNG)]!;
  const k = Math.max(0, r - MINE_LAST_NAMED_RUNG);
  const discount = 1 - tierPerksAt(r).notificationFeeDiscountPct / 100;
  return {
    maxChargeKg: Math.round(named.maxChargeKg * PERMIT_CLASS_CHARGE_FACTOR ** k),
    maxAreaM2: Math.round(named.maxAreaM2 * PERMIT_CLASS_AREA_FACTOR ** k),
    fee: Math.round(named.fee * PERMIT_CLASS_FEE_FACTOR ** k * discount),
  };
}

/** Limits of a grade and tier; tier defaults to 1 (classes have one). */
export function permitLimitsFor(grade: number, tier = 1): PermitLimitConfig {
  return permitLimitsForRung(gradeRung({ grade, tier }));
}

function limitsUnlockParams(grade: number): Record<string, string | number> {
  const l = permitLimitsFor(grade);
  return { maxChargeKg: l.maxChargeKg, maxAreaM2: l.maxAreaM2, fee: formatMoney(l.fee) };
}
const LIMIT_LINE_GRADES = [...Array.from({ length: LAST_NAMED_GRADE }, (_, i) => i + 1), 'class' as const];
for (const grade of LIMIT_LINE_GRADES) {
  registerUnlockLine({ grade, leading: true, key: 'progression.unlock.limits', params: limitsUnlockParams });
}

/** Compare a blast plan — its charges and the area (m²) of its pattern cells — against the permit of `grade`. */
export function preFireCheck(
  rung: number,
  charges: Readonly<Record<string, { amountKg: number }>>,
  planAreaM2: number,
): PreFireCheck {
  const limits = permitLimitsForRung(rung);
  let planKg = 0;
  for (const c of Object.values(charges)) planKg += c.amountKg;
  const kgOver = Math.max(0, planKg - limits.maxChargeKg) / limits.maxChargeKg;
  const areaOver = Math.max(0, planAreaM2 - limits.maxAreaM2) / limits.maxAreaM2;
  const overshoot = Math.max(kgOver, areaOver);
  return { limits, planKg, planAreaM2, over: overshoot > 0, fee: limits.fee, overshoot };
}

/** Strikes still inside the window at `tick`. */
export function liveStrikes(strikeTicks: readonly number[], tick: number): number[] {
  return strikeTicks.filter(t => t > tick - PERMIT_STRIKE_WINDOW_TICKS);
}

/** Chance an inspector turns up for a blast over limit by `overshoot`. */
export function inspectionChance(overshoot: number, rung = 0): number {
  const discount = 1 - tierPerksAt(rung).inspectionDiscountPct / 100;
  return Math.min(1, (PERMIT_INSPECTION_BASE_CHANCE + overshoot) * discount);
}

/** Fine for a caught blast. */
export function inspectionFine(fee: number, overshoot: number): number {
  return Math.round(PERMIT_FINE_FEE_MULTIPLIER * fee * (1 + overshoot));
}

/** Roll whether the inspection happens. */
export function rollInspection(rng: Random, overshoot: number, rung = 0): boolean {
  return rng.next() < inspectionChance(overshoot, rung);
}

/** Resolve an over-limit blast: roll, fine, strike, suspend, emit `progression:blast_inspected`. */
export function resolveOvershoot(
  state: Pick<GameState, 'seed' | 'tickCount' | 'cash' | 'finances' | 'scores' | 'events' | 'corruption'>,
  g: GradeState,
  check: PreFireCheck,
  emitter: EventEmitter,
): InspectionVerdict {
  const tick = state.tickCount;
  const strikes = liveStrikes(g.strikeTicks ?? [], tick);
  g.strikeTicks = strikes;
  const verdict: InspectionVerdict = { rolled: false, caught: false, fine: 0, overshoot: check.overshoot, strikes: strikes.length, suspended: false };

  const inspectorDef = { category: 'lawsuit' as const, tags: [INSPECTION_EVENT_TAG] };
  const protections = state.corruption.protections ?? [];
  if (isEventShielded(inspectorDef, protections, tick)) {
    markShielded(protections, [inspectorDef], tick);
  } else {
    const rolls = g.inspectionRolls ?? 0;
    g.inspectionRolls = rolls + 1;
    verdict.rolled = true;
    verdict.caught = rollInspection(new Random(rollSeed(state.seed, tick, rolls)), check.overshoot, gradeRung(g));
  }

  if (verdict.caught) {
    verdict.fine = inspectionFine(check.fee, check.overshoot);
    chargeFine(state, verdict.fine, 'Blast permit inspection', tick);
    state.scores.nuisance = clampScore(state.scores.nuisance - PERMIT_CAUGHT_NEIGHBOUR_PENALTY);
    strikes.push(tick);
    if (strikes.length >= PERMIT_STRIKES_TO_SUSPEND) {
      pushModifier(state.events, {
        kind: 'blast_ban', sourceEventId: '', role: null, targetId: null, category: null,
        magnitude: 1, startTick: tick, endTick: tick + PERMIT_SUSPENSION_TICKS,
      });
      g.strikeTicks = [];
      verdict.suspended = true;
    }
    verdict.strikes = strikes.length;
  }

  emitter.emit('progression:blast_inspected', {
    overshoot: verdict.overshoot, caught: verdict.caught, fine: verdict.fine, strikes: verdict.strikes, suspended: verdict.suspended,
  });
  return verdict;
}
