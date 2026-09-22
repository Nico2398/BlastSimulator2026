// BlastSimulator2026 — Task-completion world effects (#1086)
//
// Core-owned relocation of src/console/commands/tickTaskCompletion.ts's
// resolveTaskCompletion: applies the world-mutating side effects of a
// just-completed task (carve a ramp segment, land a drilled hole, place a
// building, resolve a survey, ...) and reports what happened structurally,
// rather than pushing console-formatted strings.

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Employee } from '../entities/Employee.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { TaskProgressResult } from './TaskProgress.js';
import type { TaskCompletionReport } from './TickPipeline.js';
import { Random } from '../math/Random.js';
import { completeVehicleGatedAction } from './VehicleReservation.js';
import { estimateSurveyResult, applySeismicSurveyDamage, type SurveyMethod } from '../mining/SurveyCalc.js';
import { landDrilledHole } from '../mining/DrillPlan.js';
import { landLoadedCharge } from '../mining/ChargePlan.js';
import { carveRampSegment, type RampSegmentDef } from '../mining/Ramp.js';
import { carveLevelColumns } from '../mining/LevelGround.js';
import { NavGrid } from '../nav/NavGrid.js';
import { toFullHeightRegion } from '../nav/NavGridSync.js';
import { placeBuilding, getDefSize, getBuildingDef } from '../entities/Building.js';
import { addIncome } from '../economy/Finance.js';
import {
  makeFootprintRegion, makeLevelFootprintRegion, levelBuildingFootprint,
  siteBoundsForGrid, refreshLogisticsCapacity,
} from './BuildingTaskHelpers.js';

/**
 * Apply the world effects of `emp`'s just-completed task (per `progress`)
 * and report what happened, structurally.
 */
export function applyTaskCompletion(
  state: GameState,
  grid: VoxelGrid | null,
  emp: Employee,
  progress: TaskProgressResult,
  emitter: EventEmitter,
): TaskCompletionReport {
  const report: TaskCompletionReport = {
    completed: progress.completed,
    levelUps: progress.levelUps,
  };

  if (progress.completed) {
    // A completed 'dig_ramp_segment' task lands here — one segment of an
    // ordered ramp is carved into the grid only once a qualified digger
    // has actually finished excavating it, not the instant the ramp was
    // ordered (#555, mirrors the 'drill_hole' branch below). A segment
    // whose cells were already cleared by something else (a blast,
    // another ramp) carves zero voxels but is still marked done.
    //
    // Runs BEFORE the generic vehicle-continuity block below (#945): that
    // block's tryContinueVehicleGatedAction call looks for a same-role
    // follow-up already claimable — for a ramp, isRampSegmentClaimable
    // gates the next segment on THIS segment's own tracker.done. Marking it
    // done here, first, is what lets the driver's own next-segment
    // continuity actually find a follow-up the instant this one finishes;
    // done second (as it used to run, after the continuity attempt already
    // failed to find anything claimable) meant every single segment
    // dismounted the driver and forced a fresh walk-and-reboard for the
    // next one — confirmed live via #945's tutorial box-cut repro
    // (needs.integration.test.ts's own "boards the rock_digger vehicle no
    // more than twice" acceptance case), which boarded once per segment
    // (12 times for a 12-segment ramp) purely from this ordering gap, with
    // no rest/fatigue interruption involved at all.
    if (progress.actionType === 'dig_ramp_segment' && progress.actionPayload && grid) {
      const rampId = progress.actionPayload['rampId'] as number;
      const segmentIndex = progress.actionPayload['segmentIndex'] as number;
      const cells = progress.actionPayload['cells'] as RampSegmentDef['cells'];
      const region = progress.actionPayload['region'] as RampSegmentDef['region'];
      const ramp = state.plannedRamps.find(r => r.id === rampId);
      const tracker = ramp?.segments.find(s => s.index === segmentIndex);

      if (ramp && tracker) {
        carveRampSegment(grid, { cells, region }, emitter);
        tracker.done = true;
        tracker.carvedCount = tracker.cells.length;
        // Progressive carving (#946) clears a segment's cells over the
        // preceding ticks via TaskProgress.ts's per-tick slice carve, so by
        // the time this completion tick runs every cell in the segment is
        // already carved — carveRampSegment's own idempotent density
        // recheck genuinely returns 0 here, not a bug. tracker.cells.length
        // is the segment's true total, which is what actually got cleared.
        let rampFullyDone = false;
        if (ramp.segments.every(s => s.done)) {
          rampFullyDone = true;
          const rampIdx = state.plannedRamps.findIndex(r => r.id === rampId);
          if (rampIdx !== -1) state.plannedRamps.splice(rampIdx, 1);
        }
        const voxelsFilled = tracker.cells.filter(c => c.fillTarget !== undefined).length;
        const voxelsCleared = tracker.cells.length - voxelsFilled;
        report.rampSegment = { rampId, segmentIndex, voxelsCleared, voxelsFilled, rampFullyDone };
      }
    }

    // A completed 'level_ground' task lands here — the ordered rectangle is
    // carved into the grid only once a qualified digger has actually
    // finished the work, not the instant it was ordered (#1009, mirrors the
    // 'dig_ramp_segment' branch above). Unlike a ramp, a level-ground order
    // is one atomic PendingAction, so there's no per-segment tracker to mark
    // done — carving (which emits `terrain:updated`, keeping the NavGrid in
    // sync via NavGridSync) is the entire completion side effect.
    if (progress.actionType === 'level_ground' && progress.actionPayload && grid) {
      const columns = progress.actionPayload['columns'] as { x: number; z: number }[];
      const targetY = progress.actionPayload['targetY'] as number;
      const carveResult = carveLevelColumns(grid, columns, targetY, emitter);
      report.groundLevelled = { voxelsCleared: carveResult.voxelsCleared };
    }

    // Any completed non-rest action — skill-required (survey, etc.) or
    // not (a null-skill general_work dispatch), vehicle-gated or on-foot —
    // routes through tickTaskProgress and carries an actionId here.
    // completeVehicleGatedAction (VehicleReservation.ts, #1090) owns both
    // releasing any vehicle reservation (a safe no-op when this action
    // never reserved one) and removing the completed action's record/ghost
    // (completePendingAction) — one call handles every action type, not just
    // vehicle-gated ones, since resolveActionCost/planItinerary already own
    // picking any same-role follow-up and no continuity fast path is needed
    // here any more.
    if (progress.actionId !== undefined) {
      completeVehicleGatedAction(state, emp, progress.actionId);
    }

    // A completed 'survey' task resolves here — after the surveyor has
    // actually walked to and worked the site, not the instant it was
    // claimed (#437).
    if (progress.actionType === 'survey' && progress.actionPayload && grid) {
      const method = progress.actionPayload['method'] as SurveyMethod;
      const centerX = progress.actionPayload['centerX'] as number;
      const centerZ = progress.actionPayload['centerZ'] as number;
      const skillLevel = emp.qualifications.find(q => q.category === 'geology')?.proficiencyLevel ?? 1;
      const surveyResult = estimateSurveyResult(grid, {
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
      report.survey = { method, centerX, centerZ };
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
        if (state.navGrid && grid) {
          const cx = Math.floor(drilled.x);
          const cz = Math.floor(drilled.z);
          NavGrid.patchNavGrid(state.navGrid, grid, state.buildings.buildings, state.drillHoles, {
            minX: cx, maxX: cx, minZ: cz, maxZ: cz,
          });
        }
        report.drillHole = { holeId: drilled.id, x: drilled.x, z: drilled.z };
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
        report.chargeLoaded = { holeId, explosiveId: loaded.explosiveId, amountKg: loaded.amountKg };
      }
    }

    // A completed 'place_building' task lands here — the site becomes a real
    // building only once construction has actually finished, not the instant
    // the order was confirmed (#556, mirrors the 'dig_ramp_segment' branch
    // above). The footprint stays reserved for the order's whole lifetime
    // (checkFootprintPlacement counts every PlannedBuilding as an occupant),
    // so bounds/occupancy failing here should be unreachable — but a reserved
    // (planned, not-yet-built) site is not blast-protected the way a
    // completed building is: a blast that reshapes the ground under a site
    // mid-construction can make the flatness check (#1008) newly fail here.
    // The refund/cancel branch below already handles that gracefully, same
    // as it does the (unreachable) bounds/occupancy case — no new
    // control-flow needed, just passing the grid through.
    if (progress.actionType === 'place_building' && progress.actionPayload) {
      const buildingOrderId = progress.actionPayload['buildingOrderId'] as number;
      const orderIdx = state.plannedBuildings.findIndex(pb => pb.id === buildingOrderId);
      const order = orderIdx !== -1 ? state.plannedBuildings[orderIdx] : undefined;

      if (order) {
        const bounds = siteBoundsForGrid(grid);
        const result = placeBuilding(
          state.buildings, order.type, order.x, order.z,
          bounds.width, bounds.depth, order.tier, bounds.originX, bounds.originZ,
          order.buildingId, grid ?? undefined,
        );

        if (result.success) {
          state.plannedBuildings.splice(orderIdx, 1);
          refreshLogisticsCapacity(state);
          let footprintRegion: ReturnType<typeof makeFootprintRegion> | undefined;
          let footprintLevelled = 0;
          if (grid) {
            const { sizeX, sizeZ } = getDefSize(getBuildingDef(order.type, order.tier));
            footprintRegion = makeFootprintRegion(order.x, order.z, sizeX, sizeZ);
            // Construction ends by cutting the ground under the footprint down
            // to its lowest column (#1008 refinement). Placement tolerates a
            // one-level slope (BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD) so siting
            // a building is not a tile-by-tile hunt for perfectly level
            // ground; this is the other half of that bargain — the finished
            // building stands on flat ground regardless, rather than on the
            // step it was allowed to straddle. Runs AFTER placeBuilding's own
            // levelness re-check above, never before: carving first would make
            // that check trivially pass and silently swallow a site a blast
            // wrecked mid-construction, which is exactly what it exists to
            // catch. A footprint already level carves nothing.
            //
            // The CARVE region is `makeLevelFootprintRegion` — widened by one
            // column on the maxX/maxZ sides — because the building's mesh
            // spans one column further than its occupancy footprint (#1144).
            // The TARGET height, though, is computed from the narrower TRUE
            // footprint only (`levelGroundRect`'s `targetRect` param, #1144
            // follow-up): the building's own pad height must come from ground
            // this building actually occupies, never from whatever the extra
            // skirt column's untouched natural terrain happens to be. Coupling
            // them — deriving targetY from the widened rect too — was the
            // actual bug the previous fix (reverting the widen outright)
            // papered over: a low skirt column dragged targetY down further
            // than this building's own footprint required, over-cutting the
            // skirt and exaggerating the height step against whatever gets
            // placed next door onto that same skirt column (the tutorial's
            // living_quarters-then-driving_center placement, #945/#928) or
            // onto the row a later tier upgrade of this same building grows
            // onto (buildings.integration.test.ts). With the target pinned to
            // the true footprint, the widened carve only ever cuts the skirt
            // down to a height this building's own footprint already settled
            // on — never further.
            //
            // `levelBuildingFootprint` (BuildingTaskHelpers.ts) also guards the
            // widened skirt against an ALREADY-STANDING neighbour: two
            // buildings placed touching with zero gap can put this building's
            // widened skirt column exactly on the neighbour's own TRUE
            // footprint, and carving it would silently lower an edge row of
            // that neighbour's pad (#1144 review finding 1).
            const levelRegion = makeLevelFootprintRegion(order.x, order.z, sizeX, sizeZ);
            const levelled = levelBuildingFootprint(grid, order.x, order.z, sizeX, sizeZ, state.buildings.buildings, emitter);
            footprintLevelled = levelled.voxelsCleared;
            // Emitted after the carve (unconditionally — even a footprint
            // already flat still needs its occupancy reflected), so the
            // NavGrid cells around the site (including the widened skirt
            // column the carve just touched) carry their new surface heights
            // (isStepClimbable reads them) and not the pre-construction
            // ones. NavGridSync patches on nav:occupancy_changed; no direct
            // call here.
            emitter.emit('nav:occupancy_changed', { region: toFullHeightRegion(levelRegion, grid) });
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
              // avoidOccupancy: true (#954 follow-up fix): this relocates a
              // living, foot-travelling employee, so the same fragment-/
              // vehicle-occupancy rule their own foot travel obeys (#954)
              // must gate the cell they get relocated onto — otherwise this
              // sweep could "rescue" them from a newly-blocked footprint
              // straight into a fragment-boxed spot with the same problem.
              // See NavGrid.findNearestReachableCell's own doc comment.
              const nearest = NavGrid.findNearestReachableCell(state.navGrid, 0, 0, other.x, other.z, true);
              other.x = nearest.x;
              other.z = nearest.z;
            }
          }
          report.building = {
            outcome: 'built',
            type: order.type,
            tier: order.tier,
            buildingId: result.building!.id,
            x: order.x,
            z: order.z,
            footprintLevelled,
          };
        } else {
          state.cash += order.cost;
          addIncome(state.finances, order.cost, 'refund',
            `Construction cancelled: ${order.type} T${order.tier} (${result.error})`, state.tickCount);
          state.plannedBuildings.splice(orderIdx, 1);
          report.building = {
            outcome: 'failed',
            type: order.type,
            tier: order.tier,
            x: order.x,
            z: order.z,
            error: result.error!,
            refund: order.cost,
          };
        }
      }
    }
  }

  return report;
}
