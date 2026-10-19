// BlastSimulator2026 — Permit limits: per-blast charge/hole caps and inspections (#1923)

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { LAST_NAMED_GRADE, registerUnlockLine, type GradeState } from './MineGrade.js';
import { formatMoney } from './formatMoney.js';
import { Random, rollSeed } from '../math/Random.js';
import { chargeFine } from './Finance.js';
import { isEventShielded, markShielded } from './BribeProtection.js';
import { pushModifier } from '../events/ActiveModifiers.js';
import { clampScore } from '../scores/ScoreManager.js';
import {
  PERMIT_LIMITS, PERMIT_CLASS_CHARGE_FACTOR, PERMIT_CLASS_HOLES_FACTOR, PERMIT_CLASS_FEE_FACTOR,
  PERMIT_INSPECTION_BASE_CHANCE, PERMIT_FINE_FEE_MULTIPLIER, PERMIT_CAUGHT_NEIGHBOUR_PENALTY,
  PERMIT_STRIKES_TO_SUSPEND, type PermitLimitConfig, PERMIT_STRIKE_WINDOW_TICKS, PERMIT_SUSPENSION_TICKS,
  MAX_DRILL_GRID_HOLES, INSPECTION_EVENT_TAG,
} from '../config/balance.js';


interface PreFireCheck {
  limits: PermitLimitConfig;
  planKg: number;
  planHoles: number;
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

/** Limits of a grade; endless classes above grade 5 scale by the class factors. */
export function permitLimitsFor(grade: number): PermitLimitConfig {
  const named = PERMIT_LIMITS[Math.max(0, grade)];
  if (named) return { ...named };
  const top = PERMIT_LIMITS[LAST_NAMED_GRADE]!;
  const k = grade - LAST_NAMED_GRADE;
  return {
    maxChargeKg: Math.round(top.maxChargeKg * PERMIT_CLASS_CHARGE_FACTOR ** k),
    maxHoles: Math.min(MAX_DRILL_GRID_HOLES, Math.round(top.maxHoles * PERMIT_CLASS_HOLES_FACTOR ** k)),
    fee: Math.round(top.fee * PERMIT_CLASS_FEE_FACTOR ** k),
  };
}

function limitsUnlockParams(grade: number): Record<string, string | number> {
  const l = permitLimitsFor(grade);
  return { maxChargeKg: l.maxChargeKg, maxHoles: l.maxHoles, fee: formatMoney(l.fee) };
}
const LIMIT_LINE_GRADES = [...Array.from({ length: LAST_NAMED_GRADE }, (_, i) => i + 1), 'class' as const];
for (const grade of LIMIT_LINE_GRADES) {
  registerUnlockLine({ grade, leading: true, key: 'progression.unlock.limits', params: limitsUnlockParams });
}

/** Compare a blast plan against the permit of `grade`. */
export function preFireCheck(
  grade: number,
  charges: Readonly<Record<string, { amountKg: number }>>,
  holeCount: number,
): PreFireCheck {
  const limits = permitLimitsFor(grade);
  let planKg = 0;
  for (const c of Object.values(charges)) planKg += c.amountKg;
  const kgOver = Math.max(0, planKg - limits.maxChargeKg) / limits.maxChargeKg;
  const holesOver = Math.max(0, holeCount - limits.maxHoles) / limits.maxHoles;
  const overshoot = Math.max(kgOver, holesOver);
  return { limits, planKg, planHoles: holeCount, over: overshoot > 0, fee: limits.fee, overshoot };
}

/** Strikes still inside the window at `tick`. */
export function liveStrikes(strikeTicks: readonly number[], tick: number): number[] {
  return strikeTicks.filter(t => t > tick - PERMIT_STRIKE_WINDOW_TICKS);
}

/** Chance an inspector turns up for a blast over limit by `overshoot`. */
export function inspectionChance(overshoot: number): number {
  return Math.min(1, PERMIT_INSPECTION_BASE_CHANCE + overshoot);
}

/** Fine for a caught blast. */
export function inspectionFine(fee: number, overshoot: number): number {
  return Math.round(PERMIT_FINE_FEE_MULTIPLIER * fee * (1 + overshoot));
}

/** Roll whether the inspection happens. */
export function rollInspection(rng: Random, overshoot: number): boolean {
  return rng.next() < inspectionChance(overshoot);
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
    verdict.caught = rollInspection(new Random(rollSeed(state.seed, tick, rolls)), check.overshoot);
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
