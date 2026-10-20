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
import { getBuildingDef, getDefSize } from '../../../core/entities/Building.js';
import { recordBuildingDestruction } from '../../../core/scores/ScoreManager.js';
import { releaseOccupantsOfRemovedBuildings, releaseOccupantsOfRemovedVehicles } from '../../../core/engine/Mount.js';
import { releaseDeadEmployeeActions } from '../../../core/engine/TaskDispatch.js';
import { refreshLogisticsCapacity } from '../../../core/engine/BuildingTaskHelpers.js';
import { emitFootprintOccupancyChanged } from '../buildingHelpers.js';
import { WALL_SLUMP_IMPACT_SPEED_MS, WALL_SLUMP_ROCK_DENSITY_KG_M3 } from '../../../core/config/balance.js';

/** One synthetic rockfall per toe column, so the existing hit rules price the damage. */
function rockfallProjections(report: SlumpReport, floorY: number, fragmentId: number): FragmentData[] {
  const mass = (report.volumeM3 * WALL_SLUMP_ROCK_DENSITY_KG_M3) / report.toeColumns.length;
  return report.toeColumns.map((key, i) => {
    const [x, z] = key.split(',').map(Number) as [number, number];
    const position = vec3(x + 0.5, floorY, z + 0.5);
    return {
      id: fragmentId + i, position, volume: report.volumeM3 / report.toeColumns.length, mass,
      rockId: '', oreDensities: {}, initialVelocity: vec3(0, -WALL_SLUMP_IMPACT_SPEED_MS, 0),
      isProjection: true, halfExtents: vec3(0.5, 0.5, 0.5), shapeSeed: 0, origin: position,
    };
  });
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

    const footprintsBefore = new Map(state.buildings.buildings.map(b =>
      [b.id, { x: b.x, z: b.z, ...getDefSize(getBuildingDef(b.type, b.tier)) }] as const));
    const secondary: SecondaryBlastEvent[] = [];
    const accidents: AccidentRecord[] = processProjections(
      rockfallProjections(report, report.minY, -1 - state.damage.wallSlumpCount * 1000),
      state.buildings, state.vehicles, state.employees, state.damage, state.tickCount,
      { x1: report.region.minX, z1: report.region.minZ, x2: report.region.maxX + 1, z2: report.region.maxZ + 1 },
      secondary,
    );
    if (secondary.length > 0) {
      accidents.push(...resolveSecondaryBlasts(secondary, state.buildings, state.vehicles, state.employees, state.damage, state.tickCount)
        .flatMap(o => o.accidents));
    }
    if (accidents.length > 0) {
      for (const loss of refreshLogisticsCapacity(state)) ctx.emitter.emit('logistics:warehouse_stock_lost', loss);
      releaseOccupantsOfRemovedBuildings(state, ctx.emitter);
      releaseOccupantsOfRemovedVehicles(state, ctx.emitter);
    }
    for (const a of accidents) {
      if (a.type === 'death') releaseDeadEmployeeActions(state, a.entityId);
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
