// BlastSimulator2026 — Task-completion resolution for the per-tick loop
// Split from events.ts's tickCommand (#695).

import type { GameContext } from './world.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Employee } from '../../core/entities/Employee.js';
import type { TaskProgressResult } from '../../core/engine/GameLoop.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';

export function resolveTaskCompletion(
  ctx: GameContext,
  state: GameState,
  emp: Employee,
  progress: TaskProgressResult,
  emitter: EventEmitter,
  lines: string[],
): void {
  void ctx;
  void state;
  void emp;
  void progress;
  void emitter;
  void lines;
  throw new Error('not implemented');
}
