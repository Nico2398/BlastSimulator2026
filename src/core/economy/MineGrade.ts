// BlastSimulator2026 — Mine grades: the Ministry of Holes permit ladder (#1921)

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { ContractType } from './Contract.js';

export type GradeTargetKind = 'ore_kg' | 'blasts' | 'depth_m' | 'rock_m3' | 'safety' | 'ecology' | 'neighbours' | 'no_death';

export interface GradeTargetDef {
  kind: GradeTargetKind;
  /** For `no_death` the look-back window in ticks. */
  value: number;
}

export interface GradeDef {
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
}

export interface GradeTargetStatus {
  kind: GradeTargetKind;
  met: boolean;
  current: number;
  needed: number;
}

export type GradeApplyRefusal = 'no_ladder' | 'pending' | 'unmet_targets' | 'insufficient_funds';

export type GradeApplyResult =
  | { ok: true; fee: number; toGrade: number }
  | { ok: false; refusal: GradeApplyRefusal; unmet?: GradeTargetKind[] };

/** Fresh grade state of a progression site: grade 0, nothing tracked. */
export function createGradeState(): GradeState {
  throw new Error('not implemented');
}

/** Validate a loaded grade sub-state; undefined when malformed. */
export function sanitizeGradeState(_raw: unknown): GradeState | undefined {
  throw new Error('not implemented');
}

/** Definition of a grade: named for 0-5, endless classes above. */
export function gradeDef(_grade: number): GradeDef {
  throw new Error('not implemented');
}

/** Per-target progress toward the next grade; empty without a ladder. */
export function nextGradeTargets(_state: GameState): GradeTargetStatus[] {
  throw new Error('not implemented');
}

/** Book delivered ore kg (ore_sale and supply only). No-op without grade state. */
export function recordOreDelivery(_grade: GradeState | undefined, _type: ContractType, _kg: number): void {
  throw new Error('not implemented');
}

/** Book one fired blast. No-op without grade state. */
export function recordGradeBlast(_grade: GradeState | undefined, _deepestM: number, _rockM3: number): void {
  throw new Error('not implemented');
}

/** Deepest point below the natural surface over the columns a blast cleared ("x,y" keys), in m. */
export function blastPitDepthM(_grid: VoxelGrid, _clearedColumns: readonly string[]): number {
  throw new Error('not implemented');
}

/** Apply for the next grade: checks, books the fee, starts processing. */
export function applyForGrade(_state: GameState): GradeApplyResult {
  throw new Error('not implemented');
}

/** Tick a pending application; on completion raise the grade and emit `progression:grade_approved`. */
export function advanceGradeApplication(_state: GameState, _emitter: EventEmitter): void {
  throw new Error('not implemented');
}
