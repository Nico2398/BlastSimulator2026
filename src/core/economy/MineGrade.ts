// BlastSimulator2026 — Mine grades: the Ministry of Holes permit ladder (#1921)

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { computeVoxelColumnSurfaceHeight, type VoxelGrid } from '../world/VoxelGrid.js';
import type { ContractType } from './Contract.js';
import { tierPerksAt } from './TierPerks.js';
import { deductExpense } from './Finance.js';
import { takePermitDelay } from '../events/ActiveModifiers.js';
import { parseColumnKey } from '../mining/SurveyColumn.js';
import {
  MINE_GRADES,
  MINE_LAST_NAMED_GRADE,
  MINE_LAST_NAMED_RUNG,
  PERMIT_LIMITS,
  LEGACY_PERMIT_LIMITS,
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
interface TierDef {
  grade: number;
  tier: number;
  targets: readonly GradeTargetDef[];
  perk: MineTierPerk | null;
  limits: PermitLimitConfig;
}

/** Ladder step of a site: grade x tier for grades 0-3, then one step per endless class. */
export function gradeRung(g: Pick<GradeState, 'grade' | 'tier'>): number {
  if (g.grade > LAST_NAMED_GRADE) return MINE_LAST_NAMED_RUNG + (g.grade - LAST_NAMED_GRADE);
  const tier = Math.min(MINE_TIERS_PER_GRADE, Math.max(1, g.tier || 1));
  return Math.max(0, g.grade) * MINE_TIERS_PER_GRADE + tier - 1;
}

/** Definition of a tier of a named grade (0-3); undefined for a class or an out-of-range tier. */
export function tierDef(grade: number, tier: number): TierDef | undefined {
  const cfg = MINE_GRADES[grade]?.tiers[tier - 1];
  if (!cfg) return undefined;
  const rung = gradeRung({ grade, tier });
  return { grade, tier, targets: cfg.targets, perk: cfg.perk, limits: { ...PERMIT_LIMITS[rung]! } };
}

/** Per-target progress toward completing tier `tier` of the current grade; empty without a ladder or on a class. */
export function tierTargetStatuses(state: GameState, tier: number): GradeTargetStatus[] {
  const g = state.grade;
  const def = g ? tierDef(g.grade, tier) : undefined;
  return g && def ? def.targets.map(({ kind, value }) => targetStatus(state, g, kind, value)) : [];
}

/** Per-target progress toward completing the current tier; empty without a ladder or on a class. */
export function currentTierTargets(state: GameState): GradeTargetStatus[] {
  return tierTargetStatuses(state, state.grade?.tier ?? 1);
}

function targetStatus(state: GameState, g: GradeState, kind: GradeTargetKind, value: number): GradeTargetStatus {
  const current = targetProgress(state, g, kind, value);
  return { kind, met: current >= value, current, needed: value };
}

/** Raises the tier while the current tier's targets are met; returns the tiers gained. Emits `progression:tier_up` per step. */
export function advanceGradeTier(state: GameState, emitter?: Pick<EventEmitter, 'emit'>): number {
  const g = state.grade;
  if (!g || g.grade > LAST_NAMED_GRADE) return 0;
  let gained = 0;
  while (g.tier < MINE_TIERS_PER_GRADE && currentTierTargets(state).every(t => t.met)) {
    g.tier++;
    gained++;
    emitter?.emit('progression:tier_up', { grade: g.grade, tier: g.tier });
  }
  return gained;
}

/** Where a pre-tier save's grade (0-5, then classes) lands on the new ladder, never below the caps it held. */
export function migrateLegacyGrade(oldGrade: number): { grade: number; tier: number } {
  const legacyCount = Object.keys(LEGACY_PERMIT_LIMITS).length;
  if (oldGrade >= legacyCount) return { grade: oldGrade - (legacyCount - 1 - LAST_NAMED_GRADE), tier: 1 };
  const held = LEGACY_PERMIT_LIMITS[Math.max(0, oldGrade)]!;
  let rung = 0;
  while (rung < MINE_LAST_NAMED_RUNG && (PERMIT_LIMITS[rung]!.maxChargeKg < held.maxChargeKg || PERMIT_LIMITS[rung]!.maxAreaM2 < held.maxAreaM2)) rung++;
  return { grade: Math.floor(rung / MINE_TIERS_PER_GRADE), tier: (rung % MINE_TIERS_PER_GRADE) + 1 };
}

/** Contract offers the site's tier perks add to every board refresh; 0 without a ladder. */
export function extraContractOffers(g: GradeState | undefined): number {
  return g ? tierPerksAt(gradeRung(g)).extraContractOffers : 0;
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
  const unseenRaw = isWholeCount(r['unseenApproval']) ? r['unseenApproval'] : null;
  const lastBlastChargeShare = typeof r['lastBlastChargeShare'] === 'number' && Number.isFinite(r['lastBlastChargeShare']) && r['lastBlastChargeShare'] >= 0 ? r['lastBlastChargeShare'] : 0;
  const hasTier = r['tier'] !== undefined;
  if (hasTier && (!isWholeCount(r['tier']) || r['tier'] < 1 || r['tier'] > MINE_TIERS_PER_GRADE)) return undefined;
  const map = (old: number): { grade: number; tier: number } => hasTier ? { grade: old, tier: old === grade ? r['tier'] as number : 1 } : migrateLegacyGrade(old);
  const here = map(grade);
  const tier = here.grade > LAST_NAMED_GRADE ? 1 : here.tier;
  const unseenApproval = unseenRaw === null ? null : map(unseenRaw).grade;
  const base = { grade: here.grade, tier, oreDeliveredKg, deepestPitM, rockBrokenM3, blastsFired, strikeTicks, inspectionRolls, lastBlastChargeShare, unseenApproval };
  if (pending === null) return { ...base, pending: null };
  if (typeof pending !== 'object' || Array.isArray(pending)) return undefined;
  const p = pending as Record<string, unknown>;
  if (!isWholeCount(p['toGrade']) || !isWholeCount(p['ticksLeft'])) return undefined;
  const toGrade = Math.max(map(p['toGrade']).grade, here.grade + 1);
  return { ...base, pending: { toGrade, ticksLeft: p['ticksLeft'] } };
}

/** Definition of entering a grade: 0 is the start permit, 1-3 are named, above that endless classes. */
export function gradeDef(grade: number): GradeDef {
  if (grade <= 0) return { grade: 0, nameKey: MINE_GRADES[0]!.nameKey, fee: 0, processingTicks: 0, targets: [] };
  const top = MINE_GRADES[LAST_NAMED_GRADE]!;
  const entry = (below: number): GradeTargetDef[] => [...MINE_GRADES[below]!.tiers[MINE_TIERS_PER_GRADE - 1]!.targets, ...MINE_GRADES[below]!.mastery];
  const named = MINE_GRADES[grade];
  if (named) return { grade, nameKey: named.nameKey, fee: named.fee, processingTicks: named.processingTicks, targets: entry(grade - 1) };

  const k = grade - LAST_NAMED_GRADE;
  const topOre = top.mastery.find(tg => tg.kind === 'ore_kg')!.value;
  return {
    grade,
    nameKey: 'permit.grade.class',
    nameParams: { n: k },
    fee: Math.round(MINE_GRADE_CLASS_BASE_FEE * MINE_GRADE_CLASS_FEE_FACTOR ** (k - 1)),
    processingTicks: MINE_GRADE_CLASS_PROCESSING_TICKS,
    targets: k === 1 ? entry(LAST_NAMED_GRADE) : [
      { kind: 'ore_kg', value: Math.round(topOre * MINE_GRADE_CLASS_ORE_FACTOR ** (k - 1)) },
      { kind: 'rock_m3', value: Math.round(MINE_GRADE_CLASS_ROCK_BASE_M3 * MINE_GRADE_CLASS_ROCK_FACTOR ** (k - 2)) },
    ],
  };
}

/** Per-target progress toward the next grade; empty without a ladder. */
export function nextGradeTargets(state: GameState): GradeTargetStatus[] {
  const g = state.grade;
  if (!g) return [];
  return gradeDef(g.grade + 1).targets.map(({ kind, value }) => targetStatus(state, g, kind, value));
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
  if (g.grade <= LAST_NAMED_GRADE && g.tier < MINE_TIERS_PER_GRADE) return { refusal: 'tier_incomplete', unmet: [] };
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
  const perks = tierPerksAt(gradeRung(g));
  const base = Math.round(def.processingTicks * (1 - perks.processingDiscountPct / 100));
  g.pending = { toGrade, ticksLeft: flooredTicks(base + takePermitDelay(state.events.activeModifiers)) };
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
  g.tier = 1;
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
