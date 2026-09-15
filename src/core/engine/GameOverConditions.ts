// BlastSimulator2026 — Game-over condition checks (#1086)
//
// Core-owned relocation of src/console/commands/tickGameOver.ts's
// checkGameOverConditions: runs the level-complete/bankruptcy/ecological-
// shutdown/arrest/worker-revolt checks and reports which one (if any) ended
// the level this tick, rather than pushing console-formatted strings.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { updateBankruptcy } from '../campaign/Bankruptcy.js';
import { updateEcology } from '../campaign/EcologicalDisaster.js';
import { updateArrest } from '../campaign/CriminalArrest.js';
import { updateRevolt } from '../campaign/WorkerRevolt.js';
import { checkLevelComplete } from '../campaign/LevelTransition.js';
import { snapshotStats } from '../campaign/SuccessTracker.js';
import type { GameOverReport } from './TickPipeline.js';

/** Run every win/lose condition check for this tick and report the outcome. */
export function checkGameOverConditions(state: GameState, emitter: EventEmitter): GameOverReport {
  // 9. Level stats snapshot + campaign profit check
  snapshotStats(state.levelStats, state);
  const levelResult = checkLevelComplete(state, state.campaign, emitter);
  let levelCompleted = false;
  if (levelResult.triggered) {
    state.levelEnded = true;
    state.levelEndReason = 'completed';
    levelCompleted = true;
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
    } else if (ecoShutdown) {
      state.levelEnded = true;
      state.levelEndReason = 'ecological_shutdown';
    } else if (arrested) {
      state.levelEnded = true;
      state.levelEndReason = 'arrest';
    } else if (revolted) {
      state.levelEnded = true;
      state.levelEndReason = 'worker_revolt';
    }
  }

  return {
    levelCompleted,
    bankrupted,
    ecoShutdown,
    arrested,
    revolted,
    levelEndReason: state.levelEndReason,
  };
}
