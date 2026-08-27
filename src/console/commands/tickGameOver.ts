// BlastSimulator2026 — Game-over condition checks for the per-tick loop
// Split from events.ts's tickCommand (#695).

import type { GameState } from '../../core/state/GameState.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';

export function checkGameOverConditions(
  state: GameState,
  emitter: EventEmitter,
  lines: string[],
): void {
  void state;
  void emitter;
  void lines;
  throw new Error('not implemented');
}
