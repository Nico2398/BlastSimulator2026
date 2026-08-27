// BlastSimulator2026 — Task-completion resolution for the per-tick loop
// Split from events.ts's tickCommand (#695).

import type { GameContext } from './world.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Employee } from '../../core/entities/Employee.js';
import type { TaskProgressResult } from '../../core/engine/GameLoop.js';
import { EventEmitter } from '../../core/state/EventEmitter.js';
import { Random } from '../../core/math/Random.js';
import { tryContinueVehicleGatedAction } from '../../core/engine/GameLoop.js';
import { completePendingAction } from '../../core/engine/TaskDispatch.js';
import { releaseVehicleOnCompletion } from '../../core/engine/VehicleReservation.js';
import { estimateSurveyResult, applySeismicSurveyDamage, type SurveyMethod } from '../../core/mining/SurveyCalc.js';
import { landDrilledHole } from '../../core/mining/DrillPlan.js';
import { landLoadedCharge } from '../../core/mining/ChargePlan.js';
import { carveRampSegment, type RampSegmentDef } from '../../core/mining/Ramp.js';
import { NavGrid } from '../../core/nav/NavGrid.js';
import { placeBuilding, getDefSize, getBuildingDef } from '../../core/entities/Building.js';
import { addIncome } from '../../core/economy/Finance.js';
import { makeFootprintRegion, siteBounds, patchNavGrid as patchBuildingNavGrid, refreshLogisticsCapacity } from './buildingHelpers.js';

export function resolveTaskCompletion(
  ctx: GameContext,
  state: GameState,
  emp: Employee,
  progress: TaskProgressResult,
  emitter: EventEmitter,
  lines: string[],
): void {
  if (progress.completed) {
    lines.push(`[tick ${state.tickCount}] TASK: ${emp.name} completed task.`);

    // Any completed non-rest action — skill-required (survey, etc.) or
    // not (a null-skill general_work dispatch) — routes through
    // tickTaskProgress and carries an actionId here; completePendingAction
    // removes the completing action's record and ghost, once the work has
    // actually finished, not at claim time (#547).
    if (progress.actionId !== undefined) {
      // #550: look the action up before completePendingAction removes
      // the record — nothing to look requiredVehicleRole up on
      // afterward. For a vehicle-gated action, try the scoped same-tick
      // continuity promotion first (tryContinueVehicleGatedAction) —
      // reassigns the just-finished vehicle straight to a same-role
      // follow-up already available to this employee, keeping them
      // mounted. Only when no follow-up qualifies does the vehicle get
      // unconditionally released/dismounted via releaseVehicleOnCompletion.
      const completingAction = state.pendingActions.find(a => a.id === progress.actionId);
      if (completingAction && completingAction.requiredVehicleRole !== null) {
        const continued = tryContinueVehicleGatedAction(state, emp, completingAction);
        if (!continued) releaseVehicleOnCompletion(state, emp, progress.actionId);
      }
      completePendingAction(state, progress.actionId);
    }

    // A completed 'survey' task resolves here — after the surveyor has
    // actually walked to and worked the site, not the instant it was
    // claimed (#437).
    if (progress.actionType === 'survey' && progress.actionPayload && ctx.grid) {
      const method = progress.actionPayload['method'] as SurveyMethod;
      const centerX = progress.actionPayload['centerX'] as number;
      const centerZ = progress.actionPayload['centerZ'] as number;
      const skillLevel = emp.qualifications.find(q => q.category === 'geology')?.proficiencyLevel ?? 1;
      const surveyResult = estimateSurveyResult(ctx.grid, {
        id: state.nextSurveyId++,
        method,
        centerX,
        centerZ,
        surveyorId: emp.id,
        skillLevel,
        completedTick: state.tickCount,
      }, new Random(state.seed + state.tickCount + emp.id));
      state.surveyResults.push(surveyResult);
      if (method === 'seismic') {
        const seismicAccidents = applySeismicSurveyDamage(state.buildings, centerX, centerZ, state.tickCount);
        state.damage.accidents.push(...seismicAccidents);
      }
      lines.push(`[tick ${state.tickCount}] ${method} survey complete at (${centerX}, ${centerZ}).`);
    }

    // A completed 'drill_hole' task lands here — the hole moves from
    // plannedDrillHoles into drillHoles only once the drill rig has
    // actually finished it, not the instant the plan was confirmed
    // (#553, mirrors the 'survey' branch above).
    if (progress.actionType === 'drill_hole' && progress.actionPayload) {
      const holeId = progress.actionPayload['holeId'] as string;
      const plannedIdx = state.plannedDrillHoles.findIndex(h => h.id === holeId);
      if (plannedIdx !== -1) {
        const [planned] = state.plannedDrillHoles.splice(plannedIdx, 1);
        const drilled = landDrilledHole(planned!);
        state.drillHoles.push(drilled);
        if (state.navGrid && ctx.grid) {
          const cx = Math.floor(drilled.x);
          const cz = Math.floor(drilled.z);
          NavGrid.patchNavGrid(state.navGrid, ctx.grid, state.buildings.buildings, state.drillHoles, {
            minX: cx, maxX: cx, minZ: cz, maxZ: cz,
          });
        }
        lines.push(`[tick ${state.tickCount}] Hole ${drilled.id} drilled at (${drilled.x}, ${drilled.z}).`);
      }
    }

    // A completed 'charge_hole' task lands here — the charge moves from
    // plannedChargesByHole into chargesByHole only once the blaster has
    // actually finished loading it, not the instant the order was placed
    // (#554, mirrors the 'drill_hole' branch above). No NavGrid patch —
    // charging doesn't change the navmesh.
    if (progress.actionType === 'charge_hole' && progress.actionPayload) {
      const holeId = progress.actionPayload['holeId'] as string;
      const planned = state.plannedChargesByHole[holeId];
      if (planned) {
        delete state.plannedChargesByHole[holeId];
        const loaded = landLoadedCharge(planned);
        state.chargesByHole[holeId] = loaded;
        lines.push(`[tick ${state.tickCount}] Charge loaded at ${holeId}: ${loaded.explosiveId} ${loaded.amountKg}kg.`);
      }
    }

    // A completed 'dig_ramp_segment' task lands here — one segment of an
    // ordered ramp is carved into the grid only once a qualified digger
    // has actually finished excavating it, not the instant the ramp was
    // ordered (#555, mirrors the 'drill_hole' branch above). A segment
    // whose cells were already cleared by something else (a blast,
    // another ramp) carves zero voxels but is still marked done.
    if (progress.actionType === 'dig_ramp_segment' && progress.actionPayload && ctx.grid) {
      const rampId = progress.actionPayload['rampId'] as number;
      const segmentIndex = progress.actionPayload['segmentIndex'] as number;
      const cells = progress.actionPayload['cells'] as RampSegmentDef['cells'];
      const region = progress.actionPayload['region'] as RampSegmentDef['region'];
      const ramp = state.plannedRamps.find(r => r.id === rampId);
      const tracker = ramp?.segments.find(s => s.index === segmentIndex);

      if (ramp && tracker) {
        const carveResult = carveRampSegment(ctx.grid, { index: segmentIndex, cells, region }, emitter);
        if (carveResult.voxelsCleared > 0 && region && state.navGrid) {
          NavGrid.patchNavGrid(state.navGrid, ctx.grid, state.buildings.buildings, state.drillHoles, region);
        }
        tracker.done = true;
        lines.push(`[tick ${state.tickCount}] Ramp #${rampId} segment ${segmentIndex} excavated: ${carveResult.voxelsCleared} voxels cleared.`);

        if (ramp.segments.every(s => s.done)) {
          const rampIdx = state.plannedRamps.findIndex(r => r.id === rampId);
          if (rampIdx !== -1) state.plannedRamps.splice(rampIdx, 1);
        }
      }
    }

    // A completed 'place_building' task lands here — the site becomes a real
    // building only once construction has actually finished, not the instant
    // the order was confirmed (#556, mirrors the 'dig_ramp_segment' branch
    // above). The footprint stays reserved for the order's whole lifetime
    // (checkFootprintPlacement counts every PlannedBuilding as an occupant),
    // so placeBuilding failing here should be unreachable — defensive-only,
    // mirroring how tick.ts refunds a Research Center task cancelled
    // mid-flight (destroyed while its task was still queued).
    if (progress.actionType === 'place_building' && progress.actionPayload) {
      const buildingOrderId = progress.actionPayload['buildingOrderId'] as number;
      const orderIdx = state.plannedBuildings.findIndex(pb => pb.id === buildingOrderId);
      const order = orderIdx !== -1 ? state.plannedBuildings[orderIdx] : undefined;

      if (order) {
        const bounds = siteBounds(ctx);
        const result = placeBuilding(
          state.buildings, order.type, order.x, order.z,
          bounds.width, bounds.depth, order.tier, bounds.originX, bounds.originZ,
          order.buildingId,
        );

        if (result.success) {
          state.plannedBuildings.splice(orderIdx, 1);
          refreshLogisticsCapacity(state);
          let footprintRegion: ReturnType<typeof makeFootprintRegion> | undefined;
          if (ctx.grid) {
            const { sizeX, sizeZ } = getDefSize(getBuildingDef(order.type, order.tier));
            footprintRegion = makeFootprintRegion(order.x, order.z, sizeX, sizeZ);
            patchBuildingNavGrid(state, ctx.grid, footprintRegion);
          }
          // The employee who just finished the work is standing on the
          // footprint they were building — the NavGrid patch above just
          // turned that footprint 'blocked', so their own tile is now
          // impassable. findPath refuses ANY route whose start cell is
          // impassable (Pathfinding.ts), so left alone they'd be
          // permanently stuck (never redispatchable) the instant their own
          // construction finished. Same relocate-to-nearest-reachable move
          // hire/vehicle-spawn already use when a spawn point lands on
          // unwalkable ground (#556 finding).
          //
          // #816: relocating only `emp` (the builder) left a genuine
          // livelock — any OTHER employee who merely happened to be idling
          // on this same tile (e.g. a freshly hired employee still parked at
          // the default spawn point a building later lands on) was left
          // behind on the newly-blocked footprint with nobody ever moving
          // them off it. Every subsequent pathfind FROM their position then
          // failed at Pathfinding.ts's start-impassable check regardless of
          // destination — including forceShiftRestIfNeededByPolicy's own
          // routing to the nearest living_quarters — so a proactive-rest
          // policy (continuous mode) permanently stranded that employee the
          // instant the footprint under them closed, direct-traced via
          // tutorial-interactive.json's own `set_policy mode:continuous` +
          // two-building-order sequence. Sweeping every employee standing on
          // the new footprint (not just the one whose PendingAction just
          // completed) closes the gap the same relocate-to-nearest-reachable
          // move already uses, just applied to everyone it actually affects.
          if (state.navGrid && footprintRegion) {
            const region = footprintRegion;
            for (const other of state.employees.employees) {
              if (!other.alive) continue;
              const cx = Math.round(other.x);
              const cz = Math.round(other.z);
              if (cx < region.minX || cx > region.maxX || cz < region.minZ || cz > region.maxZ) continue;
              const nearest = NavGrid.findNearestReachableCell(state.navGrid, 0, 0, other.x, other.z);
              other.x = nearest.x;
              other.z = nearest.z;
            }
          }
          lines.push(`[tick ${state.tickCount}] Built ${order.type} T${order.tier} #${result.building!.id} at (${order.x}, ${order.z}).`);
        } else {
          state.cash += order.cost;
          addIncome(state.finances, order.cost, 'refund',
            `Construction cancelled: ${order.type} T${order.tier} (${result.error})`, state.tickCount);
          state.plannedBuildings.splice(orderIdx, 1);
          lines.push(`[tick ${state.tickCount}] Construction of ${order.type} T${order.tier} failed at (${order.x}, ${order.z}): ${result.error}. $${order.cost} refunded.`);
        }
      }
    }
  }
  // Report every award that leveled up this tick (#622) — a vehicle-gated
  // action can grant XP in two categories in the same tick and both can
  // cross a level threshold; progress.leveledUp/skill/newLevel alone only
  // carry the first one.
  for (const levelUp of progress.levelUps) {
    lines.push(`[tick ${state.tickCount}] LEVELUP: ${emp.name} reached level ${levelUp.newLevel} in ${levelUp.skill}.`);
  }
}
