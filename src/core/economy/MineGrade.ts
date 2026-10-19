// BlastSimulator2026 — Mine grades: the Ministry of Holes permit ladder (#1921)

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { computeVoxelColumnSurfaceHeight, type VoxelGrid } from '../world/VoxelGrid.js';
import type { ContractType } from './Contract.js';
import { deductExpense } from './Finance.js';
import { takePermitDelay } from '../events/ActiveModifiers.js';
import { parseColumnKey } from '../mining/SurveyColumn.js';
import {
  MINE_GRADES,
  MINE_GRADE_CLASS_ORE_FACTOR,
  MINE_GRADE_CLASS_ROCK_BASE_M3,
  MINE_GRADE_CLASS_ROCK_FACTOR,
  MINE_GRADE_CLASS_FEE_FACTOR,
  MINE_GRADE_CLASS_PROCESSING_TICKS,
  type MineGradeTargetConfig,
} from '../config/balance.js';

export type GradeTargetKind = MineGradeTargetConfig['kind'];

interface GradeTargetDef {
  kind: GradeTargetKind;
  /** For `no_death` the look-back window in ticks. */
  value: number;
}

interface GradeDef {
  grade: number;
  nameKey: string;
  nameParams?: Record<string, number>;
  fee: number;
  processingTicks: number;
  targets: readonly GradeTargetDef[];
}

export interface GradeState {
  grade: number;
  oreDeliveredKg: number;
  deepestPitM: number;
  rockBrokenM3: number;
  blastsFired: number;
  pending: { toGrade: number; ticksLeft: number } | null;
  /** Ticks of recent caught over-limit blasts; strikes inside the window count toward suspension. */
  strikeTicks?: number[];
  /** Count of inspection rolls made, salting each roll's seed. */
  inspectionRolls?: number;
  /** Share of the blast charge cap the last blast used (#1927). */
  lastBlastChargeShare?: number;
}

export interface GradeTargetStatus {
  kind: GradeTargetKind;
  met: boolean;
  current: number;
  needed: number;
}

export type GradeApplyRefusal = 'no_ladder' | 'pending' | 'unmet_targets' | 'insufficient_funds';

type GradeApplyResult =
  | { ok: true; fee: number; toGrade: number }
  | { ok: false; refusal: GradeApplyRefusal; unmet?: GradeTargetKind[] };

/** Last grade with a named table entry; classes start above it. */
export const LAST_NAMED_GRADE = 5;

/** Target amount for display: whole numbers as-is, fractions floored to one decimal. */
export function formatGradeAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.floor(n * 10) / 10).toFixed(1);
}

/** Fresh grade state of a progression site: grade 0, nothing tracked. */
export function createGradeState(): GradeState {
  return { grade: 0, oreDeliveredKg: 0, deepestPitM: 0, rockBrokenM3: 0, blastsFired: 0, pending: null, strikeTicks: [], inspectionRolls: 0, lastBlastChargeShare: 0 };
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isWholeCount(v: unknown): v is number {
  return isCount(v) && Number.isInteger(v);
}

/** Validate a loaded grade sub-state; undefined when malformed. */
export function sanitizeGradeState(raw: unknown): GradeState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const { grade, oreDeliveredKg, deepestPitM, rockBrokenM3, blastsFired, pending } = r;
  if (!isWholeCount(grade) || !isCount(oreDeliveredKg) || !isCount(deepestPitM) || !isCount(rockBrokenM3) || !isWholeCount(blastsFired)) return undefined;
  const strikeTicks = Array.isArray(r['strikeTicks']) && r['strikeTicks'].every(isWholeCount) ? [...r['strikeTicks'] as number[]] : [];
  const inspectionRolls = isWholeCount(r['inspectionRolls']) ? r['inspectionRolls'] : 0;
  const lastBlastChargeShare = typeof r['lastBlastChargeShare'] === 'number' && Number.isFinite(r['lastBlastChargeShare']) && r['lastBlastChargeShare'] >= 0 ? r['lastBlastChargeShare'] : 0;
  if (pending === null) return { grade, oreDeliveredKg, deepestPitM, rockBrokenM3, blastsFired, pending: null, strikeTicks, inspectionRolls, lastBlastChargeShare };
  if (typeof pending !== 'object' || Array.isArray(pending)) return undefined;
  const p = pending as Record<string, unknown>;
  if (!isWholeCount(p['toGrade']) || !isWholeCount(p['ticksLeft'])) return undefined;
  return { grade, oreDeliveredKg, deepestPitM, rockBrokenM3, blastsFired, pending: { toGrade: p['toGrade'], ticksLeft: p['ticksLeft'] }, strikeTicks, inspectionRolls, lastBlastChargeShare };
}

/** Definition of a grade: 0 is the start permit, 1-5 are named, above that endless classes. */
export function gradeDef(grade: number): GradeDef {
  if (grade <= 0) return { grade: 0, nameKey: 'permit.grade.0', fee: 0, processingTicks: 0, targets: [] };
  const named = MINE_GRADES[grade];
  if (named) return { grade, nameKey: named.nameKey, fee: named.fee, processingTicks: named.processingTicks, targets: named.targets };

  const k = grade - LAST_NAMED_GRADE;
  const top = MINE_GRADES[LAST_NAMED_GRADE]!;
  const topOre = top.targets.find(tg => tg.kind === 'ore_kg')!.value;
  return {
    grade,
    nameKey: 'permit.grade.class',
    nameParams: { n: k },
    fee: Math.round(top.fee * MINE_GRADE_CLASS_FEE_FACTOR ** k),
    processingTicks: MINE_GRADE_CLASS_PROCESSING_TICKS,
    targets: [
      { kind: 'ore_kg', value: Math.round(topOre * MINE_GRADE_CLASS_ORE_FACTOR ** k) },
      { kind: 'rock_m3', value: Math.round(MINE_GRADE_CLASS_ROCK_BASE_M3 * MINE_GRADE_CLASS_ROCK_FACTOR ** (k - 1)) },
    ],
  };
}

/** Per-target progress toward the next grade; empty without a ladder. */
export function nextGradeTargets(state: GameState): GradeTargetStatus[] {
  const g = state.grade;
  if (!g) return [];
  return gradeDef(g.grade + 1).targets.map(({ kind, value }): GradeTargetStatus => {
    const current = targetProgress(state, g, kind, value);
    return { kind, met: current >= value, current, needed: value };
  });
}

/** Current value of one target kind; `no_death` reads as ticks since the last death, capped at the window. */
function targetProgress(state: GameState, g: GradeState, kind: GradeTargetKind, window: number): number {
  switch (kind) {
    case 'ore_kg': return g.oreDeliveredKg;
    case 'blasts': return g.blastsFired;
    case 'depth_m': return g.deepestPitM;
    case 'rock_m3': return g.rockBrokenM3;
    case 'safety': return state.scores.safety;
    case 'ecology': return state.scores.ecology;
    case 'neighbours': return state.scores.nuisance;
    case 'no_death': {
      let sinceDeath = window;
      for (const a of state.damage.accidents) {
        if (a.type === 'death') sinceDeath = Math.min(sinceDeath, state.tickCount - a.tick);
      }
      return sinceDeath;
    }
  }
}

/** True when a delivery of this contract type counts as ore (rubble disposal does not). */
export function countsAsOreDelivery(type: ContractType): boolean {
  return type !== 'rubble_disposal';
}

/** Book delivered ore kg (ore_sale and supply only). No-op without grade state. */
export function recordOreDelivery(grade: GradeState | undefined, type: ContractType, kg: number): void {
  if (!grade || !countsAsOreDelivery(type) || !(kg > 0)) return;
  grade.oreDeliveredKg += kg;
}

/** Book one fired blast. No-op without grade state. */
export function recordGradeBlast(grade: GradeState | undefined, deepestM: number, rockM3: number): void {
  if (!grade) return;
  grade.blastsFired++;
  grade.rockBrokenM3 += rockM3;
  grade.deepestPitM = Math.max(grade.deepestPitM, deepestM);
}

/** Deepest point below the natural surface over the columns a blast cleared ("x,z" keys), in m. */
export function blastPitDepthM(grid: VoxelGrid, clearedColumns: readonly string[]): number {
  let deepest = 0;
  for (const key of clearedColumns) {
    const { x, z } = parseColumnKey(key);
    const natural = grid.generatorSurfaceHeightAt(x, z);
    if (natural === undefined) continue;
    const current = computeVoxelColumnSurfaceHeight(grid, x, z);
    if (Number.isNaN(current)) continue;
    deepest = Math.max(deepest, natural - current);
  }
  return deepest;
}

/** Pure dry-run of the application checks: why one would be refused now, or null when it would be accepted. */
export function permitApplyBlocker(
  state: GameState,
): { refusal: GradeApplyRefusal; unmet: GradeTargetKind[] } | null {
  const g = state.grade;
  if (!g) return { refusal: 'no_ladder', unmet: [] };
  if (g.pending) return { refusal: 'pending', unmet: [] };
  const unmet = nextGradeTargets(state).filter(s => !s.met).map(s => s.kind);
  if (unmet.length > 0) return { refusal: 'unmet_targets', unmet };
  if (state.cash < gradeDef(g.grade + 1).fee) return { refusal: 'insufficient_funds', unmet: [] };
  return null;
}

/** Apply for the next grade: checks, books the fee, starts processing. */
export function applyForGrade(state: GameState): GradeApplyResult {
  const blocker = permitApplyBlocker(state);
  if (blocker) {
    return blocker.unmet.length > 0
      ? { ok: false, refusal: blocker.refusal, unmet: blocker.unmet }
      : { ok: false, refusal: blocker.refusal };
  }
  const g = state.grade!;
  const toGrade = g.grade + 1;
  const def = gradeDef(toGrade);
  deductExpense(state, def.fee, 'permits', `Permit fee: grade ${toGrade}`);
  g.pending = { toGrade, ticksLeft: flooredTicks(def.processingTicks + takePermitDelay(state.events.activeModifiers)) };
  return { ok: true, fee: def.fee, toGrade };
}

/** Tick a pending application; on completion raise the grade and emit `progression:grade_approved`. */
export function advanceGradeApplication(state: GameState, emitter: EventEmitter): void {
  const g = state.grade;
  if (!g?.pending) return;
  g.pending.ticksLeft--;
  if (g.pending.ticksLeft > 0) return;
  approvePendingApplication(g, emitter);
}

/** Remaining processing ticks after a delay, never below one tick. */
function flooredTicks(ticks: number): number {
  return Math.max(1, ticks);
}

/** Shifts a pending application's remaining processing ticks (negative = faster, floored at 1); false without one (#1927). */
export function shiftPendingApplication(g: GradeState, ticks: number): boolean {
  if (!g.pending) return false;
  g.pending.ticksLeft = flooredTicks(g.pending.ticksLeft + ticks);
  return true;
}

/** Approves a pending application at once, granting the grade (emits only when an emitter is given); false without one (#1927). */
export function approvePendingApplication(g: GradeState, emitter?: EventEmitter): boolean {
  if (!g.pending) return false;
  g.grade = g.pending.toGrade;
  g.pending = null;
  emitter?.emit('progression:grade_approved', { grade: g.grade });
  return true;
}

/** Records the last blast's charge as a share of the grade's charge cap (#1927). */
export function recordBlastChargeShare(g: GradeState | undefined, planKg: number, maxChargeKg: number): void {
  if (!g || !(maxChargeKg > 0)) return;
  g.lastBlastChargeShare = planKg / maxChargeKg;
}
