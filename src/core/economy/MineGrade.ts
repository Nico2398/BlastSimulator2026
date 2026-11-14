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
  MINE_LAST_NAMED_GRADE,
  MINE_TIERS_PER_GRADE,
  MINE_GRADE_CLASS_ORE_FACTOR,
  MINE_GRADE_CLASS_ROCK_BASE_M3,
  MINE_GRADE_CLASS_ROCK_FACTOR,
  MINE_GRADE_CLASS_BASE_FEE,
  MINE_GRADE_CLASS_FEE_FACTOR,
  MINE_GRADE_CLASS_PROCESSING_TICKS,
  type MineGradeTargetConfig,
  type MineTierPerk,
  type PermitLimitConfig,
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
  /** Tier within the grade, 1-3 (always 1 on an endless class). */
  tier: number;
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
  /** Grade whose approval the player has not yet been shown (#1926); null/absent once acknowledged. */
  unseenApproval?: number | null;
}

export interface GradeTargetStatus {
  kind: GradeTargetKind;
  met: boolean;
  current: number;
  needed: number;
}

export type GradeApplyRefusal = 'no_ladder' | 'pending' | 'tier_incomplete' | 'unmet_targets' | 'insufficient_funds';

type GradeApplyResult =
  | { ok: true; fee: number; toGrade: number }
  | { ok: false; refusal: GradeApplyRefusal; unmet?: GradeTargetKind[] };

/** Last grade with a named table entry (G3 Meteorite); classes start above it. */
export const LAST_NAMED_GRADE = MINE_LAST_NAMED_GRADE;

/** One tier of a named grade: what completes it, what reaching it grants. */
export interface TierDef {
  grade: number;
  tier: number;
  targets: readonly GradeTargetDef[];
  perk: MineTierPerk | null;
  limits: PermitLimitConfig;
}

/** Ladder step of a site: grade x tier for grades 0-3, then one step per endless class. */
export function gradeRung(_g: Pick<GradeState, 'grade' | 'tier'>): number {
  throw new Error('not implemented');
}

/** Definition of a tier of a named grade (0-3); undefined for a class or an out-of-range tier. */
export function tierDef(_grade: number, _tier: number): TierDef | undefined {
  throw new Error('not implemented');
}

/** Per-target progress toward completing the current tier; empty without a ladder or on a class. */
export function currentTierTargets(_state: GameState): GradeTargetStatus[] {
  throw new Error('not implemented');
}

/** Raises the tier while the current tier's targets are met; returns the tiers gained. Emits `progression:tier_up` per step. */
export function advanceGradeTier(_state: GameState, _emitter?: Pick<EventEmitter, 'emit'>): number {
  throw new Error('not implemented');
}

/** Where a pre-tier save's grade (0-5, then classes) lands on the new ladder, never below the caps it held. */
export function migrateLegacyGrade(_oldGrade: number): { grade: number; tier: number } {
  throw new Error('not implemented');
}

/** Target amount for display: whole numbers as-is, fractions floored to one decimal. */
export function formatGradeAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.floor(n * 10) / 10).toFixed(1);
}

/** Fresh grade state of a progression site: grade 0, nothing tracked. */
export function createGradeState(): GradeState {
  return { grade: 0, tier: 1, oreDeliveredKg: 0, deepestPitM: 0, rockBrokenM3: 0, blastsFired: 0, pending: null, strikeTicks: [], inspectionRolls: 0, lastBlastChargeShare: 0, unseenApproval: null };
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
  const unseenApproval = isWholeCount(r['unseenApproval']) ? r['unseenApproval'] : null;
  const lastBlastChargeShare = typeof r['lastBlastChargeShare'] === 'number' && Number.isFinite(r['lastBlastChargeShare']) && r['lastBlastChargeShare'] >= 0 ? r['lastBlastChargeShare'] : 0;
  if (pending === null) return { grade, tier: 1, oreDeliveredKg, deepestPitM, rockBrokenM3, blastsFired, pending: null, strikeTicks, inspectionRolls, lastBlastChargeShare, unseenApproval };
  if (typeof pending !== 'object' || Array.isArray(pending)) return undefined;
  const p = pending as Record<string, unknown>;
  if (!isWholeCount(p['toGrade']) || !isWholeCount(p['ticksLeft'])) return undefined;
  return { grade, tier: 1, oreDeliveredKg, deepestPitM, rockBrokenM3, blastsFired, pending: { toGrade: p['toGrade'], ticksLeft: p['ticksLeft'] }, strikeTicks, inspectionRolls, lastBlastChargeShare, unseenApproval };
}

/** Definition of entering a grade: 0 is the start permit, 1-3 are named, above that endless classes. */
export function gradeDef(_grade: number): GradeDef {
  void [MINE_GRADES, MINE_TIERS_PER_GRADE, MINE_GRADE_CLASS_ORE_FACTOR, MINE_GRADE_CLASS_ROCK_BASE_M3, MINE_GRADE_CLASS_ROCK_FACTOR, MINE_GRADE_CLASS_BASE_FEE, MINE_GRADE_CLASS_FEE_FACTOR, MINE_GRADE_CLASS_PROCESSING_TICKS];
  throw new Error('not implemented');
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
export function applyForGrade(state: GameState, emitter?: Pick<EventEmitter, 'emit'>): GradeApplyResult {
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
  emitter?.emit('progression:grade_applied', { toGrade, fee: def.fee });
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
export function approvePendingApplication(g: GradeState, emitter?: Pick<EventEmitter, 'emit'>): boolean {
  if (!g.pending) return false;
  g.grade = g.pending.toGrade;
  g.pending = null;
  g.unseenApproval = g.grade;
  emitter?.emit('progression:grade_approved', { grade: g.grade });
  return true;
}

/** Records the last blast's charge as a share of the grade's charge cap (#1927). */
export function recordBlastChargeShare(g: GradeState | undefined, planKg: number, maxChargeKg: number): void {
  if (!g || !(maxChargeKg > 0)) return;
  g.lastBlastChargeShare = planKg / maxChargeKg;
}

/** One line of the "what this grade unlocks" list: a locale key, optionally parameterised by the grade (#1926). */
interface UnlockLine {
  /** A specific grade, or 'class' for every endless class grade. */
  grade: number | 'class';
  key: string;
  params?: (grade: number) => Record<string, string | number>;
  /** Sorts ahead of non-leading lines of the same grade (permit limits come first). */
  leading?: boolean;
}

const unlockLines: UnlockLine[] = [];

/** Registers an unlock line (#1926). A `leading` line sorts ahead of the rest of its grade whatever the module load order. */
export function registerUnlockLine(line: UnlockLine): void {
  unlockLines.push(line);
}

/** Unlock lines that apply to a grade, in registration order (leading lines first), with params resolved (#1926). */
export function unlockLinesFor(grade: number): { key: string; params: Record<string, string | number> }[] {
  if (grade <= 0) return [];
  const matching = unlockLines.filter(l => l.grade === grade || (l.grade === 'class' && grade > LAST_NAMED_GRADE));
  const ordered = [...matching.filter(l => l.leading), ...matching.filter(l => !l.leading)];
  return ordered.map(l => ({ key: l.key, params: l.params?.(grade) ?? {} }));
}

for (let grade = 1; grade <= LAST_NAMED_GRADE; grade++) {
  registerUnlockLine({ grade, key: `progression.unlock.flavour.${grade}` });
  registerUnlockLine({ grade, key: `progression.unlock.hint.${grade}` });
}
registerUnlockLine({ grade: 'class', key: 'progression.unlock.flavour.class' });
registerUnlockLine({ grade: 'class', key: 'progression.unlock.hint.class' });

/** Marks the pending approval as seen; false when there was none (#1926). */
export function acknowledgeApproval(g: GradeState): boolean {
  if (g.unseenApproval == null) return false;
  g.unseenApproval = null;
  return true;
}
