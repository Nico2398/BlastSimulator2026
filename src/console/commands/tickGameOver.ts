// BlastSimulator2026 — Game-over condition checks for the per-tick loop
// Split from events.ts's tickCommand (#695).

import type { GameState } from '../../core/state/GameState.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';
import { updateBankruptcy } from '../../core/campaign/Bankruptcy.js';
import { updateEcology } from '../../core/campaign/EcologicalDisaster.js';
import { updateArrest } from '../../core/campaign/CriminalArrest.js';
import { updateRevolt } from '../../core/campaign/WorkerRevolt.js';
import { checkLevelComplete } from '../../core/campaign/LevelTransition.js';
import { snapshotStats } from '../../core/campaign/SuccessTracker.js';

export function checkGameOverConditions(
  state: GameState,
  emitter: EventEmitter,
  lines: string[],
): void {
  // 9. Level stats snapshot + campaign profit check
  snapshotStats(state.levelStats, state);
  const levelResult = checkLevelComplete(state, state.campaign, emitter);
  if (levelResult.triggered) {
    state.levelEnded = true;
    state.levelEndReason = 'completed';
    lines.push(`[tick ${state.tickCount}] LEVEL COMPLETE! Profit target reached.`);
  }

  // 9. Campaign game-over condition checks (emit events; UI subscribes).
  // All 4 always run, unconditionally, to preserve their own streak/warning
  // bookkeeping — only the first one to return true this tick sets
  // levelEndReason, and only if 'completed' didn't already claim it above.
  const bankrupted = updateBankruptcy(state, state.bankruptcy, emitter);
  const ecoShutdown = updateEcology(state, state.ecological, emitter);
  const arrested = updateArrest(state, state.arrest, emitter);
  const revolted = updateRevolt(state, state.revolt, emitter);
  if (!state.levelEnded) {
    if (bankrupted) {
      state.levelEnded = true;
      state.levelEndReason = 'bankruptcy';
      lines.push(`[tick ${state.tickCount}] BANKRUPTCY! The mine is seized.`);
    } else if (ecoShutdown) {
      state.levelEnded = true;
      state.levelEndReason = 'ecological_shutdown';
      lines.push(`[tick ${state.tickCount}] ECOLOGICAL SHUTDOWN! Regulators close the mine.`);
    } else if (arrested) {
      state.levelEnded = true;
      state.levelEndReason = 'arrest';
      lines.push(`[tick ${state.tickCount}] ARRESTED! Criminal charges end your run.`);
    } else if (revolted) {
      state.levelEnded = true;
      state.levelEndReason = 'worker_revolt';
      lines.push(`[tick ${state.tickCount}] WORKER REVOLT! Your workforce walks out for good.`);
    }
  }
}
