// BlastSimulator2026 — Game-over condition checks for the per-tick loop
// Split from events.ts's tickCommand (#695). The checks themselves now live
// in src/core/engine/GameOverConditions.ts's checkGameOverConditions
// (#1086), called once per tick from the core-owned runTick — this file is a
// pure formatter turning the GameOverReport it already produced into the
// same console lines as before. It does not call checkGameOverConditions
// itself: runTick already did, once, this tick — calling it again here
// would double the bankruptcy/ecology/arrest/revolt streak bookkeeping a
// second pass through the checks would trigger.

import type { GameOverReport } from '../../core/engine/TickPipeline.js';

export function formatGameOver(tickCount: number, report: GameOverReport, lines: string[]): void {
  if (report.levelCompleted) {
    lines.push(`[tick ${tickCount}] LEVEL COMPLETE! Profit target reached.`);
  }

  if (report.levelEndReason === 'bankruptcy' && report.bankrupted) {
    lines.push(`[tick ${tickCount}] BANKRUPTCY! The mine is seized.`);
  } else if (report.levelEndReason === 'ecological_shutdown' && report.ecoShutdown) {
    lines.push(`[tick ${tickCount}] ECOLOGICAL SHUTDOWN! Regulators close the mine.`);
  } else if (report.levelEndReason === 'arrest' && report.arrested) {
    lines.push(`[tick ${tickCount}] ARRESTED! Criminal charges end your run.`);
  } else if (report.levelEndReason === 'worker_revolt' && report.revolted) {
    lines.push(`[tick ${tickCount}] WORKER REVOLT! Your workforce walks out for good.`);
  }
}
