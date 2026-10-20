// BlastSimulator2026 — Post-blast wall slumps on progression sites (#1941)
// Runs the core stability pass, then announces each slump and hurts whatever stood in its toe zone.

import type { MiningContext } from './types.js';
import { t } from '../../../core/i18n/I18n.js';
import { emitRegionInStrips, type BlastRegion, type FragmentData } from '../../../core/mining/BlastExecution.js';
import { runWallStability, type SlumpReport } from '../../../core/mining/WallStability.js';
import type { Steps } from '../../../core/engine/Steps.js';
import { vec3 } from '../../../core/math/Vec3.js';
import { processProjections, type AccidentRecord } from '../../../core/entities/Damage.js';
import { resolveSecondaryBlasts, type SecondaryBlastEvent } from '../../../core/entities/SecondaryBlast.js';
import { recordBuildingDestruction } from '../../../core/scores/ScoreManager.js';
import { releaseOccupantsOfRemovedBuildings } from '../../../core/engine/Mount.js';
import { refreshLogisticsCapacity } from '../../../core/engine/BuildingTaskHelpers.js';
import { emitFootprintOccupancyChanged, snapshotBuildingFootprints } from '../buildingHelpers.js';
import { releaseAfterAccidents } from './shared.js';
import { WALL_SLUMP_IMPACT_SPEED_MS, WALL_SLUMP_ROCK_DENSITY_KG_M3, WALL_SLUMP_TOE_ZONE_MARGIN_M } from '../../../core/config/balance.js';

/** Synthetic rockfall ids are negative so they never collide with blast fragments: slump n owns -n*1000-1 downward. */
const ROCKFALL_IDS_PER_SLUMP = 1000;
function rockfallFragmentId(slumpNumber: number, columnIndex: number): number {
  return -1 - slumpNumber * ROCKFALL_IDS_PER_SLUMP + columnIndex;
}

/** One synthetic rockfall per toe column, landing on the toe floor, so the existing hit rules price the damage. */
function rockfallProjections(report: SlumpReport, slumpNumber: number): FragmentData[] {
  const mass = (report.volumeM3 * WALL_SLUMP_ROCK_DENSITY_KG_M3) / report.toeColumns.length;
  return report.toeColumns.map(({ x, z }, i) => {
    const position = vec3(x + 0.5, report.toeY, z + 0.5);
    return {
      id: rockfallFragmentId(slumpNumber, i), position, volume: report.volumeM3 / report.toeColumns.length, mass,
      rockId: '', oreDensities: {}, initialVelocity: vec3(0, -WALL_SLUMP_IMPACT_SPEED_MS, 0),
      isProjection: true, halfExtents: vec3(0.5, 0.5, 0.5), shapeSeed: 0, origin: position,
    };
  });
}

/** Damage zone of a slump: the columns that took the spill plus a small margin; the rest of the slumped slope is not hit. */
function toeZone(report: SlumpReport): { x1: number; z1: number; x2: number; z2: number } {
  const m = WALL_SLUMP_TOE_ZONE_MARGIN_M;
  const xs = report.toeColumns.map(c => c.x), zs = report.toeColumns.map(c => c.z);
  return { x1: Math.min(...xs) - m, z1: Math.min(...zs) - m, x2: Math.max(...xs) + 1 + m, z2: Math.max(...zs) + 1 + m };
}

/** Stability pass for a blast that cleared `clearedRegion`; returns the report lines. */
export function* applyWallSlumps(ctx: MiningContext, clearedRegion: BlastRegion): Steps<string[]> {
  const state = ctx.state!;
  const reports = runWallStability(ctx.grid!, clearedRegion);
  const lines: string[] = [];
  for (const report of reports) {
    yield;
    yield* emitRegionInStrips(ctx.emitter, 'terrain:updated', {
      minX: report.region.minX, maxX: report.region.maxX, minZ: report.region.minZ, maxZ: report.region.maxZ,
      minY: report.minY, maxY: report.maxY,
    });
    state.damage.wallSlumpCount = (state.damage.wallSlumpCount ?? 0) + 1;

    const footprintsBefore = snapshotBuildingFootprints(state.buildings);
    const secondary: SecondaryBlastEvent[] = [];
    const accidents: AccidentRecord[] = processProjections(
      rockfallProjections(report, state.damage.wallSlumpCount),
      state.buildings, state.vehicles, state.employees, state.damage, state.tickCount,
      toeZone(report),
      secondary,
    );
    if (secondary.length > 0) {
      accidents.push(...resolveSecondaryBlasts(secondary, state.buildings, state.vehicles, state.employees, state.damage, state.tickCount)
        .flatMap(o => o.accidents));
    }
    if (accidents.length > 0) {
      for (const loss of refreshLogisticsCapacity(state)) ctx.emitter.emit('logistics:warehouse_stock_lost', loss);
      releaseOccupantsOfRemovedBuildings(state, ctx.emitter);
    }
    releaseAfterAccidents(state, ctx.emitter, accidents);
    for (const a of accidents) {
      if (a.type !== 'building_destroyed') continue;
      recordBuildingDestruction(state.scores, a.entityLabel === 'explosive_warehouse');
      const gone = footprintsBefore.get(a.entityId);
      if (gone) emitFootprintOccupancyChanged(ctx, gone.x, gone.z, gone.sizeX, gone.sizeZ);
    }

    ctx.emitter.emit('mining:wall_slump', { x: report.toe.x, z: report.toe.z, volumeM3: report.volumeM3 });
    lines.push(t('mining.blast.wall_slump', { x: report.toe.x, z: report.toe.z, volume: report.volumeM3 }));
  }
  return lines;
}
