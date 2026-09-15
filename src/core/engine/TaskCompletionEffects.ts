// BlastSimulator2026 — Task-completion world effects (#1086)
//
// Core-owned relocation of src/console/commands/tickTaskCompletion.ts's
// resolveTaskCompletion: applies the world-mutating side effects of a
// just-completed task (carve a ramp segment, land a drilled hole, place a
// building, resolve a survey, ...) and reports what happened structurally,
// rather than pushing console-formatted strings.
//
// Skeleton only (#1086 skeleton phase) — no logic yet.

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Employee } from '../entities/Employee.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { TaskProgressResult } from './TaskProgress.js';
import type { TaskCompletionReport } from './TickPipeline.js';

/**
 * Apply the world effects of `emp`'s just-completed task (per `progress`)
 * and report what happened, structurally.
 */
export function applyTaskCompletion(
  _state: GameState,
  _grid: VoxelGrid | null,
  _emp: Employee,
  _progress: TaskProgressResult,
  _emitter: EventEmitter,
): TaskCompletionReport {
  // TODO: implement
  throw new Error('not implemented');
}
