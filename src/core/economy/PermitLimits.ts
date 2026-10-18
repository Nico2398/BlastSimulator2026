// BlastSimulator2026 — Permit limits: per-blast charge/hole caps and inspections (#1923)

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Random } from '../math/Random.js';
import type { GradeState } from './MineGrade.js';

export interface PermitLimits {
  maxChargeKg: number;
  maxHoles: number;
  fee: number;
}

export interface PreFireCheck {
  limits: PermitLimits;
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
export function permitLimitsFor(grade: number): PermitLimits {
  void grade;
  return undefined as unknown as PermitLimits; // TODO: implement
}

/** Compare a blast plan against the permit of `grade`. */
export function preFireCheck(
  grade: number,
  charges: Readonly<Record<string, { amountKg: number }>>,
  holeCount: number,
): PreFireCheck {
  void grade; void charges; void holeCount;
  return undefined as unknown as PreFireCheck; // TODO: implement
}

/** Strikes still inside the window at `tick`. */
export function liveStrikes(strikeTicks: readonly number[], tick: number): number[] {
  void strikeTicks; void tick;
  return undefined as unknown as number[]; // TODO: implement
}

/** Chance an inspector turns up for a blast over limit by `overshoot`. */
export function inspectionChance(overshoot: number): number {
  void overshoot;
  return undefined as unknown as number; // TODO: implement
}

/** Fine for a caught blast. */
export function inspectionFine(fee: number, overshoot: number): number {
  void fee; void overshoot;
  return undefined as unknown as number; // TODO: implement
}

/** Roll whether the inspection happens. */
export function rollInspection(rng: Random, overshoot: number): boolean {
  void rng; void overshoot;
  return undefined as unknown as boolean; // TODO: implement
}

/** Resolve an over-limit blast: roll, fine, strike, suspend, emit `progression:blast_inspected`. */
export function resolveOvershoot(
  state: Pick<GameState, 'seed' | 'tickCount' | 'cash' | 'finances' | 'scores' | 'events' | 'corruption'>,
  g: GradeState,
  check: PreFireCheck,
  emitter: EventEmitter,
): InspectionVerdict {
  void state; void g; void check; void emitter;
  return undefined as unknown as InspectionVerdict; // TODO: implement
}
