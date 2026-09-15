// BlastSimulator2026 — Tick pipeline orchestration (#1086)
//
// Moves the per-tick orchestration currently split across
// src/console/commands/tick.ts and its helpers into src/core/, so the
// browser render loop and the console can both call one core-owned pipeline
// (dev-architecture) instead of hosting their own ordering. Returns a
// structured TickReport rather than accumulating console-formatted strings —
// callers (console formatter, renderer/UI) render the report however they
// need to.
//
// Skeleton only (#1086 skeleton phase) — no logic yet.

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Random } from '../math/Random.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { SurveyMethod } from '../mining/SurveyCalc.js';
import type { TaskProgressLevelUp } from './TaskProgress.js';
import type { TrainingCompletion } from '../entities/EmployeeTraining.js';
import type { CancelledResearch } from '../entities/Building.js';
import type { ArrivalGateResult } from './ArrivalGate.js';
import type { Violation } from '../state/WorldInvariants.js';

/** One need/traffic-jam event that fired and auto-paused the tick loop. */
export interface FiredEventReport {
  eventId: string;
}

/** What a single employee's just-completed task did to the world, by task type. */
export interface TaskCompletionReport {
  completed: boolean;
  rampSegment?: { rampId: number; segmentIndex: number; voxelsCleared: number; rampFullyDone: boolean };
  groundLevelled?: { voxelsCleared: number };
  survey?: { method: SurveyMethod; centerX: number; centerZ: number };
  drillHole?: { holeId: string; x: number; z: number };
  chargeLoaded?: { holeId: string; explosiveId: string; amountKg: number };
  building?:
    | { outcome: 'built'; type: string; tier: number; buildingId: number; x: number; z: number; footprintLevelled: number }
    | { outcome: 'failed'; type: string; tier: number; x: number; z: number; error: string; refund: number };
  levelUps: TaskProgressLevelUp[];
}

/** Which win/lose condition(s), if any, ended the level this tick. */
export interface GameOverReport {
  levelCompleted: boolean;
  bankrupted: boolean;
  ecoShutdown: boolean;
  arrested: boolean;
  revolted: boolean;
  levelEndReason: GameState['levelEndReason'];
}

/** Structured result of advancing the simulation by one tick. */
export interface TickReport {
  tick: number;
  contractsExpired: Array<{ contractId: number; penalty: number }>;
  smuggling: { income: number; exposed: boolean };
  mafiaExposed: boolean;
  needEvents: FiredEventReport[];
  trainingCompletions: TrainingCompletion[];
  researchCancelled: CancelledResearch | undefined;
  taskCompletions: Array<{ employeeId: number; report: TaskCompletionReport }>;
  stuckEmployees: number[];
  abandonedActions: Array<{ employeeId: number; actionId: number | null }>;
  boardingCancelled: ArrivalGateResult['boardingCancelled'];
  worldInvariantViolations: Violation[];
  firedEvent: FiredEventReport | null;
  gameOver: GameOverReport;
  paused: boolean;
}

export interface RunTickOptions {
  checkInvariants: boolean;
}

/**
 * Advance `state` by exactly one tick, mutating it in place, and report what
 * happened. The single core-owned tick step (dev-architecture) — console and
 * renderer both call this rather than hosting their own ordering.
 */
export function runTick(
  _state: GameState,
  _grid: VoxelGrid | null,
  _rng: Random,
  _emitter: EventEmitter,
  _options: RunTickOptions,
): TickReport {
  // TODO: implement
  throw new Error('not implemented');
}
