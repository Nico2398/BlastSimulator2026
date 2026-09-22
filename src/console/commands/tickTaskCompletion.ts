// BlastSimulator2026 — Task-completion resolution for the per-tick loop
// Split from events.ts's tickCommand (#695). The world-mutating effects now
// live in src/core/engine/TaskCompletionEffects.ts's applyTaskCompletion
// (#1086), called once per employee from the core-owned runTick — this file
// is a pure formatter turning the TaskCompletionReport it already produced
// into the same console lines as before. It does not call
// applyTaskCompletion itself: runTick already did, once, this tick — calling
// it again here would double the game-over/need bookkeeping that a second
// pass through the completion effects would trigger.

import type { TaskCompletionReport } from '../../core/engine/TickPipeline.js';

export function formatTaskCompletion(
  tickCount: number,
  empName: string,
  report: TaskCompletionReport,
  lines: string[],
): void {
  if (report.completed) {
    lines.push(`[tick ${tickCount}] TASK: ${empName} completed task.`);

    if (report.rampSegment) {
      const filledSuffix = report.rampSegment.voxelsFilled > 0 ? `, ${report.rampSegment.voxelsFilled} voxels filled` : '';
      lines.push(`[tick ${tickCount}] Ramp #${report.rampSegment.rampId} segment ${report.rampSegment.segmentIndex} excavated: ${report.rampSegment.voxelsCleared} voxels cleared${filledSuffix}.`);
    }

    if (report.groundLevelled) {
      lines.push(`[tick ${tickCount}] Ground levelling complete: ${report.groundLevelled.voxelsCleared} voxels cleared.`);
    }

    if (report.survey) {
      lines.push(`[tick ${tickCount}] ${report.survey.method} survey complete at (${report.survey.centerX}, ${report.survey.centerZ}).`);
    }

    if (report.drillHole) {
      lines.push(`[tick ${tickCount}] Hole ${report.drillHole.holeId} drilled at (${report.drillHole.x}, ${report.drillHole.z}).`);
    }

    if (report.chargeLoaded) {
      lines.push(`[tick ${tickCount}] Charge loaded at ${report.chargeLoaded.holeId}: ${report.chargeLoaded.explosiveId} ${report.chargeLoaded.amountKg}kg.`);
    }

    if (report.building) {
      const b = report.building;
      if (b.outcome === 'built') {
        if (b.footprintLevelled > 0) {
          lines.push(`[tick ${tickCount}] Footprint levelled for ${b.type} T${b.tier}: ${b.footprintLevelled} voxels cleared.`);
        }
        lines.push(`[tick ${tickCount}] Built ${b.type} T${b.tier} #${b.buildingId} at (${b.x}, ${b.z}).`);
      } else {
        lines.push(`[tick ${tickCount}] Construction of ${b.type} T${b.tier} failed at (${b.x}, ${b.z}): ${b.error}. $${b.refund} refunded.`);
      }
    }
  }

  // Report every award that leveled up this tick (#622) — a vehicle-gated
  // action can grant XP in two categories in the same tick and both can
  // cross a level threshold; progress.leveledUp/skill/newLevel alone only
  // carry the first one.
  for (const levelUp of report.levelUps) {
    lines.push(`[tick ${tickCount}] LEVELUP: ${empName} reached level ${levelUp.newLevel} in ${levelUp.skill}.`);
  }
}
