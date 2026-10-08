// BlastSimulator2026 — Console command executing a blast

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, resetPlanState, cancelOutstandingDrillActions, assembleValidBlastPlan, wetHoleIdSet, levelVillagePositions } from './shared.js';
import { executeBlast, buildBlastReport, maxVillageVibration, type SecondaryBlastReport } from '../../../core/mining/BlastExecution.js';
import { classifyWetChargedHoles } from '../../../core/mining/WetHoles.js';
import { plannedChargesCost } from '../../../core/mining/ChargePlan.js';
import { addBlastFragments, syncLogisticsCapacity } from '../../../core/economy/Logistics.js';
import { resolveSecondaryBlasts, type SecondaryBlastEvent } from '../../../core/entities/SecondaryBlast.js';
import { emitFootprintOccupancyChanged } from '../buildingHelpers.js';
import { getBuildingDef, getDefSize } from '../../../core/entities/Building.js';
import { releaseOccupantsOfRemovedBuildings, releaseOccupantsOfRemovedVehicles } from '../../../core/engine/Mount.js';
import { processProjections, type AccidentRecord } from '../../../core/entities/Damage.js';
import { killEmployee } from '../../../core/entities/Employee.js';
import { releaseDeadEmployeeActions } from '../../../core/engine/TaskDispatch.js';
import { destroyVehicle } from '../../../core/entities/Vehicle.js';
import { recordVibration, recordBuildingDestruction } from '../../../core/scores/ScoreManager.js';
import { recordBlastResult, snapshotStats } from '../../../core/campaign/SuccessTracker.js';
import { computeBlastOreReport } from '../../../core/mining/SurveyCalc.js';
import { markSurveysStaleByBlast } from '../../../core/mining/SurveyStaleness.js';
import { detectOreReport } from '../../../core/events/EventEngine.js';
import { regionForColumns } from '../../../core/nav/NavGridSync.js';
import { getStorageCapacity } from '../../../core/entities/Building.js';
import { computeDangerZone } from '../../../core/entities/Zone.js';
import { armDetonation, cancelDetonation, hasChargedHole, detonationPhase, type DetonationPhase } from '../../../core/engine/DetonationSequence.js';
import { BLAST_DANGER_MARGIN_M, VILLAGE_VIBRATION_SCORE_GAIN, BLAST_PROJECTION_NUISANCE_PER_PROJECTION } from '../../../core/config/balance.js';

/** Dispatch `blast` subcommands: (none) = fire anyway, detonate, cancel, status (#1362). */
export function blastCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };
  switch (args[0]) {
    case 'detonate': return blastDetonate(ctx);
    case 'cancel': return blastCancel(ctx);
    case 'status': return blastStatus(ctx);
    case undefined: return fireBlast(ctx);
    default: return { success: false, output: t('mining.blast.unknown_subcommand', { arg: args[0] }) };
  }
}

/** Localized line describing a non-idle phase. */
function phaseLine(phase: DetonationPhase): string {
  switch (phase.kind) {
    case 'idle': return t('mining.blast.detonation_idle');
    case 'ready': return t('mining.blast.detonation_armed', { remaining: 0 });
    case 'evacuating': return t('mining.blast.detonation_armed', { remaining: phase.remaining });
    case 'stranded': return t('mining.blast.detonation_stranded', { names: phase.names.join(', ') });
  }
}

/** Arm the detonation; fire at once when the zone is already clear. */
function blastDetonate(ctx: MiningContext): CommandResult {
  const armed = armDetonation(ctx.state!);
  if (!armed.success) return { success: false, output: armed.error };
  const phase = detonationPhase(ctx.state!);
  if (phase.kind !== 'ready') return { success: true, output: phaseLine(phase) };
  return fireBlast(ctx);
}

function blastCancel(ctx: MiningContext): CommandResult {
  const wasArmed = cancelDetonation(ctx.state!);
  return { success: true, output: t(wasArmed ? 'mining.blast.detonation_cancelled' : 'mining.blast.detonation_idle') };
}

function blastStatus(ctx: MiningContext): CommandResult {
  return { success: true, output: phaseLine(detonationPhase(ctx.state!)) };
}

/** Fire the loaded pattern immediately, dropping any armed detonation. */
export function fireBlast(
  ctx: MiningContext,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  // Nothing loaded or loading: refuse before anything mutates (#1345). A hole
  // whose charge is still loading falls through to validation, which names it.
  if (!hasChargedHole(ctx.state!)) {
    return { success: false, output: t('mining.blast.no_charged_holes') };
  }

  const assembled = assembleValidBlastPlan(ctx.state!, t('mining.blast_plan.invalid_plan_header'));
  if (assembled.error) return assembled.error;
  const plan = assembled.plan;
  // Validation passed: this fire consumes any armed detonation. Refusals above leave it armed.
  ctx.state!.pendingDetonation = null;

  const wetHoleIds = wetHoleIdSet(ctx);
  const villages = levelVillagePositions(ctx);
  const result = executeBlast(plan, ctx.grid!, villages, undefined, ctx.state!.buildings, ctx.emitter, wetHoleIds);
  if (!result) return { success: false, output: t('mining.blast.execution_failed') };

  // Store fragment data for renderer (localized remesh + mesh spawning)
  ctx.lastBlastFragments = result.fragments.map(f => f.position);
  ctx.lastBlastFragmentData = result.fragments;
  ctx.lastBlastFlights = result.flights;

  const state = ctx.state!;

  // Buildings destroyed by the blast: score penalty per building. Their freed
  // footprint is already inside clearedRegion, which executeBlast's own
  // `terrain:updated` emit above covers — NavGridSync patches from that
  // event, so no separate NavGrid call is needed here.
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
    recordVibration(state.scores, result.projectionCount * BLAST_PROJECTION_NUISANCE_PER_PROJECTION);
  }
  const villageVibration = maxVillageVibration(result.vibrationAtVillages);
  if (villageVibration > 0) {
    recordVibration(state.scores, villageVibration * VILLAGE_VIBRATION_SCORE_GAIN);
  }

  // Standing on the rock when it goes is not survivable, whatever the charge:
  // the ground is simply not there any more. Evacuating the blast zone first
  // (see Zone.ts) is the whole point of the safety drill.
  // Accidents produced by THIS blast call specifically — not a filter over
  // state.damage.accidents by tick, since two blasts can share a tick and
  // that would misattribute the first blast's accidents to the second's
  // report (or vice versa).
  const thisBlastAccidents: AccidentRecord[] = [];

  const blastedColumns = new Set(result.clearedColumns);
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (!blastedColumns.has(`${Math.floor(emp.x)},${Math.floor(emp.z)}`)) continue;
    killEmployee(state.employees, emp.id);
    state.damage.deathCount++;
    state.damage.lawsuitPending = true;
    const accident: AccidentRecord = {
      tick: state.tickCount, type: 'death', entityId: emp.id, fragmentId: -1, kineticEnergy: 0,
    };
    state.damage.accidents.push(accident);
    thisBlastAccidents.push(accident);
  }
  for (const veh of [...state.vehicles.vehicles]) {
    if (!blastedColumns.has(`${Math.floor(veh.x)},${Math.floor(veh.z)}`)) continue;
    destroyVehicle(state.vehicles, veh.id);
    const accident: AccidentRecord = {
      tick: state.tickCount, type: 'vehicle_destroyed', entityId: veh.id, fragmentId: -1, kineticEnergy: 0,
    };
    state.damage.accidents.push(accident);
    thisBlastAccidents.push(accident);
  }

  // Rock that was thrown lands somewhere, and whatever is standing there pays
  // for it. Fragment positions are where the rock came to rest and its speed is
  // what it was doing on impact, so this reads the blast's own outcome rather
  // than guessing at a danger radius. Gated to computeDangerZone's own padded
  // bounds (state.drillHoles is still populated here, cleared further below) —
  // a fragment's real flyrock trajectory can land past that box, and an entity
  // clearly outside it must not take a hit just because a stray fragment
  // happened to come down nearby (#557 audit).
  const dangerZone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
  const projectionSecondaryEvents: SecondaryBlastEvent[] = [];
  const impacts = processProjections(
    result.fragments,
    state.buildings,
    state.vehicles,
    state.employees,
    state.damage,
    state.tickCount,
    dangerZone,
    projectionSecondaryEvents,
  );
  if (impacts.length > 0) {
    syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
  }
  thisBlastAccidents.push(...impacts);

  // Stocked explosive warehouses destroyed by the blast or by flying rock
  // detonate in turn (#1394). resolveSecondaryBlasts records its accidents on
  // state.damage itself; they are added to this blast's own list here.
  const destroyedFootprints = new Map<number, { x: number; z: number; sizeX: number; sizeZ: number }>();
  if (result.secondaryBlastEvents.length + projectionSecondaryEvents.length > 0) {
    for (const b of state.buildings.buildings) {
      destroyedFootprints.set(b.id, { x: b.x, z: b.z, ...getDefSize(getBuildingDef(b.type, b.tier)) });
    }
  }
  const secondaryOutcomes = resolveSecondaryBlasts(
    [...result.secondaryBlastEvents, ...projectionSecondaryEvents],
    state.buildings, state.vehicles, state.employees, state.damage, state.tickCount,
  );
  const secondaryReports: SecondaryBlastReport[] = [];
  for (const outcome of secondaryOutcomes) {
    thisBlastAccidents.push(...outcome.accidents);
    const destroyed = outcome.accidents.filter(a => a.type === 'building_destroyed');
    for (const a of destroyed) recordBuildingDestruction(state.scores, a.entityLabel === 'explosive_warehouse');
    secondaryReports.push({
      buildingId: outcome.event.buildingId,
      x: outcome.event.x,
      z: outcome.event.z,
      explosivesKg: outcome.event.explosivesKg,
      radiusM: outcome.radiusM,
      casualties: outcome.accidents.filter(a => a.type === 'injury' || a.type === 'death').length,
      destroyedIds: destroyed.map(a => a.entityId),
    });
  }
  if (secondaryOutcomes.length > 0) {
    syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
    releaseOccupantsOfRemovedBuildings(state, ctx.emitter);
  }

  // One release after both destruction paths (cleared columns above, flying
  // rock in processProjections) so no rider stays mounted on a removed vehicle.
  releaseOccupantsOfRemovedVehicles(state, ctx.emitter);

  // Every employee this blast killed (exact-hit above, or attenuated via
  // processProjections just above) may still have a PendingAction targeting
  // or held by them — release it back to the pool now, before dispatch's
  // next tick ever sees it, or it stalls forever pointed at a corpse (#557
  // audit; see releaseDeadEmployeeActions' own doc comment).
  for (const accident of thisBlastAccidents) {
    if (accident.type === 'death') releaseDeadEmployeeActions(state, accident.entityId);
  }

  // Track blast in damage state and level stats
  state.damage.blastCount++;
  recordBlastResult(state.levelStats, result.fragments);
  snapshotStats(state.levelStats, state);

  // Trigger one post-blast ore report event when conditions are met.
  const oreReport = computeBlastOreReport(result.fragments, state.surveyResults);
  state.lastOreReport = oreReport;
  // After the report: it compares against estimates that were fresh pre-blast.
  markSurveysStaleByBlast(state.surveyResults, result.clearedColumns);
  detectOreReport(oreReport, state.events, state.tickCount);

  // Track blast fragments in logistics for contract delivery. collectedOre is
  // only credited once a fragment is hauled and delivered to a warehouse
  // (see Logistics.deliverToDepot), not the instant the blast resolves.
  addBlastFragments(state.logistics, result.fragments, state.navGrid);

  // Store drill holes before clearing (needed by renderer for per-hole detonation timing)
  ctx.lastBlastHoles = [...state.drillHoles];

  // Report figure only: explosives were already paid when each charge order
  // was placed (charge.ts, #1341), so the blast itself never touches cash.
  const spent = plannedChargesCost(state.chargesByHole);
  const wetReport = classifyWetChargedHoles(plan.charges, wetHoleIds);
  const report = buildBlastReport(
    result, state.tickCount, spent, thisBlastAccidents,
    wetReport, secondaryReports,
  );
  state.lastBlastReport = report;

  // Clear drill plan after blast (holes are consumed)
  resetPlanState(state);

  // Leftover drill orders target holes the blast no longer waits for: cancel
  // them (preflight warns first, FIRE is not gated on them — #1346).
  const cancelledDrillOrders = cancelOutstandingDrillActions(state);

  // Re-emit for the cleared region now that the consumed holes are gone from
  // state.drillHoles: executeBlast's own `terrain:updated` emit (above, inside
  // executeBlast) fires before this clear, so NavGridSync's patch from that
  // first emit still sees the blasted holes as live obstacles. A corrective
  // `nav:occupancy_changed` emit, scoped to the same region, re-patches the
  // NavGrid with the now-accurate (hole-free) occupant list — mirrors the
  // pre-#1146 manual patch call, which ran after this same clear for the same
  // reason. Using `nav:occupancy_changed` instead of `terrain:updated` here
  // means the renderer (subscribed only to `terrain:updated`) does not
  // double-remesh for what carves zero further voxels.
  if (result.clearedVoxels > 0) {
    ctx.emitter.emit('nav:occupancy_changed', { region: regionForColumns(result.clearedRegion, ctx.grid!) });
  }

  // Every footprint a detonation cleared is free ground for navigation, as
  // `build destroy` reports it.
  for (const outcome of secondaryOutcomes) {
    for (const a of outcome.accidents) {
      if (a.type !== 'building_destroyed') continue;
      const gone = destroyedFootprints.get(a.entityId);
      if (gone) emitFootprintOccupancyChanged(ctx, gone.x, gone.z, gone.sizeX, gone.sizeZ);
    }
  }

  return {
    success: true,
    output: [
      t('mining.blast.report_header'),
      `Rating: ${report.rating.toUpperCase()}`,
      ...(report.ratingCap
        ? [t(`mining.blast.rating_cap_${report.ratingCap}`, { base: report.baseRating?.toUpperCase() ?? '' })]
        : []),
      `Cleared voxels: ${result.clearedVoxels}`,
      `Cracked voxels: ${result.crackedVoxels}`,
      `Fragments: ${result.fragmentCount}`,
      `Average fragment size: ${result.averageFragmentSize.toFixed(3)} m³`,
      `Oversized fragments: ${result.oversizedFragments}`,
      `Projections: ${result.projectionCount}`,
      ...(result.vibrationAtVillages.length > 0
        ? [t('mining.blast.max_village_vibration', { value: villageVibration.toFixed(4) })]
        : []),
      ...(wetReport.wet.length > 0
        ? [t('mining.blast.wet_holes', { wet: wetReport.wet.length, fizzled: wetReport.fizzled.length })]
        : []),
      `Furthest throw: ${result.maxThrowDistance.toFixed(1)} m`,
      ...(cancelledDrillOrders > 0
        ? [t('mining.blast.cancelled_drill_orders', { count: cancelledDrillOrders })]
        : []),
      `Total rock volume: ${result.totalRockVolume.toFixed(1)} m³`,
      `Total ore value: $${result.totalOreValue.toFixed(0)}`,
      ...(result.destroyedBuildings.length > 0
        ? [`Buildings destroyed: ${result.destroyedBuildings.map(b => `${b.type} #${b.buildingId}`).join(', ')}`]
        : []),
      ...secondaryReports.map(r => t('mining.blast.secondary_blast', { kg: r.explosivesKg, id: r.buildingId, casualties: r.casualties })),
    ].join('\n'),
  };
}
