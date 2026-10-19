// BlastSimulator2026 — Carves craters for detonated explosive warehouses via the blast pipeline (#1896)

import type { MiningContext } from './types.js';
import type { Steps } from '../../../core/engine/Steps.js';
import { resolveSecondaryBlasts, type SecondaryBlastEvent, type SecondaryBlastOutcome } from '../../../core/entities/SecondaryBlast.js';
import { executeBlastSteps, type VillagePosition } from '../../../core/mining/BlastExecution.js';
import { resolveMarketId } from '../../../core/campaign/Level.js';
import { addBlastFragments, reserveFragmentIds } from '../../../core/economy/Logistics.js';
import { getBuildingDef, getDefSize } from '../../../core/entities/Building.js';
import type { AccidentRecord } from '../../../core/entities/Damage.js';
import { recordBuildingDestruction } from '../../../core/scores/ScoreManager.js';
import { emitFootprintOccupancyChanged } from '../buildingHelpers.js';
import { destroyEntitiesOnColumns } from './shared.js';
import { SECONDARY_BLAST_CRATER_MAX_PASSES } from '../../../core/config/balance.js';

export interface SecondaryCraterReport {
  warehouseId: number;
  explosivesKg: number;
  craterVoxels: number;
  craterFragments: number;
}

/**
 * Fire each outcome's crater plan through the blast pipeline; one report per carved crater.
 * Stocked warehouses a crater destroys detonate in turn: their outcomes are appended to
 * `outcomes` and carved on the next pass (bounded by SECONDARY_BLAST_CRATER_MAX_PASSES).
 * Entities the craters kill are appended to `accidentsOut`.
 */
export function* carveSecondaryCraters(
  ctx: MiningContext,
  outcomes: SecondaryBlastOutcome[],
  villages: readonly VillagePosition[],
  wetHoleIds: ReadonlySet<string>,
  accidentsOut: AccidentRecord[] = [],
): Steps<SecondaryCraterReport[]> {
  const state = ctx.state;
  const grid = ctx.grid;
  const reports: SecondaryCraterReport[] = [];
  if (!state || !grid) return reports;

  const visited = new Set<number>();
  let pending = [...outcomes];
  for (let pass = 0; pass < SECONDARY_BLAST_CRATER_MAX_PASSES && pending.length > 0; pass++) {
    const craterEvents: SecondaryBlastEvent[] = [];
    // Footprints as they stand before this pass's craters remove any building.
    const footprints = new Map(state.buildings.buildings.map(b =>
      [b.id, { x: b.x, z: b.z, ...getDefSize(getBuildingDef(b.type, b.tier)) }] as const));
    for (const outcome of pending) {
      const warehouseId = outcome.event.buildingId;
      if (visited.has(warehouseId)) continue;
      visited.add(warehouseId);
      const plan = outcome.craterPlan;
      if (plan.holes.length === 0) continue;

      yield;
      const result = yield* executeBlastSteps(
        plan, grid, villages, undefined, state.buildings, ctx.emitter, wetHoleIds,
        resolveMarketId(state), state.logistics.nextFragmentId,
      );
      if (!result) continue;
      reserveFragmentIds(state.logistics, result.fragments.length);
      ctx.lastBlastFragmentData = [...(ctx.lastBlastFragmentData ?? []), ...result.fragments];
      ctx.lastBlastFragments = ctx.lastBlastFragmentData.map(f => f.position);
      ctx.lastBlastFlights = [...(ctx.lastBlastFlights ?? []), ...result.flights];
      addBlastFragments(state.logistics, result.fragments, state.navGrid);

      for (const destroyed of result.destroyedBuildings) {
        recordBuildingDestruction(state.scores, destroyed.type === 'explosive_warehouse');
        const gone = footprints.get(destroyed.buildingId);
        if (gone) emitFootprintOccupancyChanged(ctx, gone.x, gone.z, gone.sizeX, gone.sizeZ);
      }
      accidentsOut.push(...destroyEntitiesOnColumns(state, result.clearedColumns));
      craterEvents.push(...result.secondaryBlastEvents);
      reports.push({
        warehouseId,
        explosivesKg: outcome.event.explosivesKg,
        craterVoxels: result.clearedVoxels,
        craterFragments: result.fragmentCount,
      });
    }

    // Warehouses the craters destroyed detonate in turn; each is carved on the next pass.
    // Past the last pass nothing would carve them, so they are not resolved (no false crater reports).
    if (pass + 1 >= SECONDARY_BLAST_CRATER_MAX_PASSES) break;
    const fresh = craterEvents.filter(e => !visited.has(e.buildingId));
    pending = fresh.length === 0 ? [] : resolveSecondaryBlasts(
      fresh, state.buildings, state.vehicles, state.employees, state.damage, state.tickCount,
    );
    outcomes.push(...pending);
  }
  return reports;
}
