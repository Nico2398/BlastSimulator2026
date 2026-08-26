// BlastSimulator2026 — Console command executing a blast

import type { CommandResult } from '../../ConsoleRunner.js';
import type { MiningContext } from './types.js';
import { requireGame } from './shared.js';
import { t } from '../../../core/i18n/I18n.js';
import { assembleBlastPlan, validateBlastPlan } from '../../../core/mining/BlastPlan.js';
import { executeBlast, buildBlastReport } from '../../../core/mining/BlastExecution.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import { addBlastFragments, syncLogisticsCapacity } from '../../../core/economy/Logistics.js';
import { processProjections } from '../../../core/entities/Damage.js';
import { killEmployee } from '../../../core/entities/Employee.js';
import { destroyVehicle } from '../../../core/entities/Vehicle.js';
import { recordVibration, recordBuildingDestruction } from '../../../core/scores/ScoreManager.js';
import { recordBlastResult, snapshotStats } from '../../../core/campaign/SuccessTracker.js';
import { wetHoles } from '../../../core/mining/WetHoles.js';
import { computeBlastOreReport } from '../../../core/mining/SurveyCalc.js';
import { detectOreReport } from '../../../core/events/EventEngine.js';
import { NavGrid } from '../../../core/nav/NavGrid.js';
import { getStorageCapacity } from '../../../core/entities/Building.js';

export function blastCommand(
  ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const plan = assembleBlastPlan(ctx.state!.drillHoles, ctx.state!.chargesByHole, ctx.state!.sequenceDelays);
  const errors = validateBlastPlan(plan, new Set(Object.keys(ctx.state!.plannedChargesByHole)));
  if (errors.length > 0) {
    return { success: false, output: `Invalid plan:\n${errors.map(e => `  ${e.holeId}: ${t(e.issue)}`).join('\n')}` };
  }

  // ctx.weatherCycle may not exist yet (created lazily by the `weather`
  // command, eagerly by main.ts on new_game/campaign start/sandbox start —
  // see console-api.ts's `weather` field doc) — 'sunny' (not raining) is the
  // correct fallback either way, since createWeatherCycle's own initial
  // state is always 'sunny' regardless of seed.
  const wetHoleIds = new Set(wetHoles(ctx.state!, ctx.weatherCycle?.current ?? 'sunny'));
  const result = executeBlast(plan, ctx.grid!, [], undefined, ctx.state!.buildings, ctx.emitter, wetHoleIds);
  if (!result) return { success: false, output: 'Blast execution failed.' };

  // Store fragment data for renderer (localized remesh + mesh spawning)
  ctx.lastBlastFragments = result.fragments.map(f => f.position);
  ctx.lastBlastFragmentData = result.fragments;
  ctx.lastBlastFlights = result.flights;

  const state = ctx.state!;

  // Buildings destroyed by the blast: score penalty per building. Their freed
  // footprint is already inside clearedRegion (a building is only destroyed
  // when its footprint overlaps a cleared voxel), so the NavGrid patch below
  // — keyed on clearedRegion — covers it without a second patch call.
  for (const destroyed of result.destroyedBuildings) {
    recordBuildingDestruction(state.scores, destroyed.type === 'explosive_warehouse');
  }

  // A blast can destroy a Freight Warehouse — keep logistics capacity honest.
  if (result.destroyedBuildings.length > 0) {
    syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
  }

  // Ore value is informational only here — cash is credited when the ore is
  // actually hauled, stored, and sold/delivered (see Logistics.consumeStoredOre).

  // Update scores based on blast outcome
  if (result.projectionCount > 0) {
    recordVibration(state.scores, result.projectionCount * 0.5);
  }

  // Standing on the rock when it goes is not survivable, whatever the charge:
  // the ground is simply not there any more. Evacuating the blast zone first
  // (see Zone.ts) is the whole point of the safety drill.
  const blastedColumns = new Set(result.clearedColumns);
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (!blastedColumns.has(`${Math.floor(emp.x)},${Math.floor(emp.z)}`)) continue;
    killEmployee(state.employees, emp.id);
    state.damage.deathCount++;
    state.damage.lawsuitPending = true;
    state.damage.accidents.push({
      tick: state.tickCount, type: 'death', entityId: emp.id, fragmentId: -1, kineticEnergy: 0,
    });
  }
  for (const veh of [...state.vehicles.vehicles]) {
    if (!blastedColumns.has(`${Math.floor(veh.x)},${Math.floor(veh.z)}`)) continue;
    destroyVehicle(state.vehicles, veh.id);
    state.damage.accidents.push({
      tick: state.tickCount, type: 'vehicle_destroyed', entityId: veh.id, fragmentId: -1, kineticEnergy: 0,
    });
  }

  // Rock that was thrown lands somewhere, and whatever is standing there pays
  // for it. Fragment positions are where the rock came to rest and its speed is
  // what it was doing on impact, so this reads the blast's own outcome rather
  // than guessing at a danger radius.
  const impacts = processProjections(
    result.fragments,
    state.buildings,
    state.vehicles,
    state.employees,
    state.damage,
    state.tickCount,
  );
  if (impacts.length > 0) {
    syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
  }

  // Track blast in damage state and level stats
  state.damage.blastCount++;
  recordBlastResult(state.levelStats, result.fragments);
  snapshotStats(state.levelStats, state);

  // Trigger one post-blast ore report event when conditions are met.
  const oreReport = computeBlastOreReport(result.fragments, state.surveyResults);
  state.lastOreReport = oreReport;
  detectOreReport(oreReport, state.events, state.tickCount);

  // Track blast fragments in logistics for contract delivery. collectedOre is
  // only credited once a fragment is hauled and delivered to a warehouse
  // (see Logistics.deliverToDepot), not the instant the blast resolves.
  addBlastFragments(state.logistics, result.fragments);

  // Store drill holes before clearing (needed by renderer for per-hole detonation timing)
  ctx.lastBlastHoles = [...state.drillHoles];

  // Charge cost, summed before the plan is cleared below — BlastResult has no
  // notion of money spent, only rock/ore recovered.
  let spent = 0;
  for (const charge of Object.values(state.chargesByHole)) {
    const explosive = getExplosive(charge.explosiveId);
    if (explosive) spent += explosive.costPerKg * charge.amountKg;
  }
  state.lastBlastReport = buildBlastReport(result, state.tickCount, spent);

  // Clear drill plan after blast (holes are consumed)
  state.drillHoles = [];
  state.chargesByHole = {};
  state.plannedChargesByHole = {};
  state.sequenceDelays = {};

  // Patch NavGrid to reflect terrain changes from the blast
  if (state.navGrid) {
    NavGrid.patchNavGrid(state.navGrid, ctx.grid!, state.buildings.buildings, state.drillHoles, result.clearedRegion);
  }

  return {
    success: true,
    output: [
      `=== BLAST REPORT ===`,
      `Rating: ${result.rating.toUpperCase()}`,
      `Cleared voxels: ${result.clearedVoxels}`,
      `Cracked voxels: ${result.crackedVoxels}`,
      `Fragments: ${result.fragmentCount}`,
      `Average fragment size: ${result.averageFragmentSize.toFixed(3)} m³`,
      `Oversized fragments: ${result.oversizedFragments}`,
      `Projections: ${result.projectionCount}`,
      `Furthest throw: ${result.maxThrowDistance.toFixed(1)} m`,
      `Total rock volume: ${result.totalRockVolume.toFixed(1)} m³`,
      `Total ore value: $${result.totalOreValue.toFixed(0)}`,
      ...(result.destroyedBuildings.length > 0
        ? [`Buildings destroyed: ${result.destroyedBuildings.map(b => `${b.type} #${b.buildingId}`).join(', ')}`]
        : []),
    ].join('\n'),
  };
}
