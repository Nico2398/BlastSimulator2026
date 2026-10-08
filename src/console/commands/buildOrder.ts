// BlastSimulator2026 — Console command for ordering a new building (#556)
// Confirming a placement validates/charges exactly as `buildCommand`'s
// default case did before this issue, then queues a `place_building`
// PendingAction at the target instead of creating the building immediately —
// mirrors PlannedRamp's order-then-work pattern (#555).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  getBuildingDef,
  getDefSize,
  isCrewlessBuilding,
  isSingleTierType,
  placeBuilding,
  isPlacementBlockedByResearch,
  checkFootprintPlacement,
  type BuildingType,
  type BuildingTier,
} from '../../core/entities/Building.js';
import type { GameState, PlannedBuilding } from '../../core/state/GameState.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { getSurfaceY } from '../../core/entities/BuildingPlacement.js';
import { dispatchPlaceBuildingAction } from '../../core/engine/PlaceBuildingAction.js';
import { settleBuiltFootprint } from '../../core/engine/BuildingTaskHelpers.js';
import { terrainReservations } from '../../core/entities/PlacementReservations.js';
import { buildingFootprintOccupants } from '../../core/nav/NavGridSync.js';
import { findBuildingApproachCell, isApproachCellStranded, isOnBuildingRing } from '../../core/nav/BuildingApproach.js';

import { refusalText } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';
import { claimForAction, cellsInRect } from './siteExpansion.js';
import { siteBounds, emitFootprintOccupancyChanged, relocateFootprintOccupants, makeFootprintRegion } from './buildingHelpers.js';

/**
 * Re-point every other still-approaching `place_building` order's target at
 * a ring cell that is still actually reachable (#1200 finding). Placing a
 * new footprint can strand an EARLIER order's already-dispatched ring cell,
 * not just its own — the new footprint may be the one thing that was still
 * connecting that cell to the rest of the map (nav-path-following-visual's
 * three-office pocket trap: the second office's builder was pointed at a
 * ring cell the third office's footprint later sealed off). An order whose
 * builder has already arrived (`'in_progress'`) is left alone: they need no
 * route back out to keep working in place. `findBuildingApproachCell`
 * itself decides where a genuinely stranded target moves to —
 * `isApproachCellStranded` gates whether a given order needs that at all, so
 * an order whose already-dispatched target is still perfectly reachable is
 * left untouched even when a fresh pick would land somewhere else (#1200
 * finding: rerouting on every such difference, not just an actual
 * stranding, repoints an already-fine builder's walk on essentially every
 * order placed while an earlier one is still pending — ordinary
 * multi-building construction, confirmed as the source of widespread
 * tick/cash/death-count drift across full-level playthroughs).
 */
function rescueStrandedApproachTargets(ctx: GameContext, state: GameState, justOrderedActionId: number): void {
  const navGrid = state.navGrid;
  if (!navGrid) return;
  for (const action of state.pendingActions) {
    if (action.type !== 'place_building' || action.id === justOrderedActionId || action.status === 'in_progress') continue;
    const order = state.plannedBuildings.find(pb => pb.id === action.payload['buildingOrderId']);
    if (!order) continue;
    if (!isApproachCellStranded(navGrid, { x: order.x, z: order.z }, action.targetX, action.targetZ)) continue;
    const def = getBuildingDef(order.type, order.tier);
    const reachable = findBuildingApproachCell(navGrid, { x: order.x, z: order.z }, def, order.x, order.z);
    action.targetX = reachable.x;
    action.targetZ = reachable.z;
    action.targetY = ctx.grid ? getSurfaceY(ctx.grid, reachable.x, reachable.z) : action.targetY;
  }
}

/**
 * Order a new building at (x, z): validates and charges as `buildCommand`'s
 * default case does today, then queues one `place_building` action instead
 * of placing the building immediately.
 */
export function orderBuildingCommand(
  ctx: GameContext,
  type: BuildingType,
  x: number,
  z: number,
  requestedTier: BuildingTier,
): CommandResult {
  const state = ctx.state!;
  const tier: BuildingTier = isSingleTierType(type) ? 1 : requestedTier;

  // Same two-stage order buildCommand's default case already documents:
  // research gate, then funds — both ahead of claimForAction/the footprint
  // check because those mutate (claim off-site land, reserve the site).
  if (isPlacementBlockedByResearch(state.buildings, type, tier)) {
    return { success: false, output: t('entities.build_not_researched', { tier, type }) };
  }

  const def = getBuildingDef(type, tier);
  if (state.cash < def.constructionCost) {
    return {
      success: false,
      output: t('console.insufficient_funds', {
        need: formatMoney(def.constructionCost),
        have: formatMoney(state.cash),
      }),
    };
  }

  const { sizeX: footprintX, sizeZ: footprintZ } = getDefSize(def);
  const claim = claimForAction(
    ctx,
    cellsInRect(x, z, x + footprintX - 1, z + footprintZ - 1),
    'build',
  );
  if (!claim.ok) return { success: false, output: claim.output! };

  const bounds = siteBounds(ctx);
  const occupants = buildingFootprintOccupants(state);
  const check = checkFootprintPlacement(
    occupants, type, x, z, tier, bounds.width, bounds.depth, bounds.originX, bounds.originZ, ctx.grid ?? undefined,
    terrainReservations(state),
  );
  if (!check.valid) return { success: false, output: refusalText(check) };

  // A crewless building (spoil heap, #1530) needs no builder: charged and placed
  // now, with no PlannedBuilding or place_building action.
  if (isCrewlessBuilding(type)) {
    const placed = placeBuilding(
      state.buildings, type, x, z, bounds.width, bounds.depth, tier, bounds.originX, bounds.originZ, undefined, ctx.grid ?? undefined,
    );
    if (!placed.success) return { success: false, output: placed.error! };
    state.cash -= def.constructionCost;
    addExpense(state.finances, def.constructionCost, 'construction', `Build ${type} T${tier}`, state.tickCount);
    settleBuiltFootprint(state, ctx.grid, ctx.emitter, x, z, footprintX, footprintZ);
    return {
      success: true,
      output: `${type} T${tier} placed at (${x},${z}). Cost: $${def.constructionCost}`,
    };
  }

  // Claim the order's own id and the finished building's id now, not when
  // the site completes: sites are built in parallel and land in whatever
  // order the crew reaches them, so numbering at completion would hand the
  // player ids in an order they never chose (and make `build destroy 1`
  // name a different building each run).
  const buildingOrderId = state.nextPlannedBuildingId++;
  const actionId = state.nextPendingActionId++;
  const plannedBuilding: PlannedBuilding = {
    id: buildingOrderId, buildingId: state.buildings.nextId++,
    type, tier, x, z, actionId, cost: def.constructionCost,
  };

  // The footprint blocks routing from the instant it is ordered (#1200),
  // synchronously — before any tick runs, and before the approach-ring
  // search just below, which must see it: a footprint can otherwise be the
  // one thing that seals off the very ring cell it is about to dispatch a
  // builder to, in this same command (#1200 finding —
  // nav-path-following-visual's three-office pocket trap). Reverted below
  // if the order ends up refused.
  state.plannedBuildings.push(plannedBuilding);
  emitFootprintOccupancyChanged(ctx, x, z, footprintX, footprintZ);

  // The builder's own walk target is the footprint's approach-ring cell.
  // findBuildingApproachCell (#1200) prefers a ring cell that is actually
  // connected to the map's main navigable region over the merely nearest
  // type-open one, so a pocket several orders jointly wall off gets routed
  // around instead of picked and then never reached. isOnBuildingRing still
  // catches the one case that leaves nothing to pick at all: every ring
  // cell blocked outright.
  const approach = ctx.grid ? findBuildingApproachCell(state.navGrid, { x, z }, def, x, z) : { x, z };
  if (state.navGrid && !isOnBuildingRing({ x, z }, def, approach.x, approach.z)) {
    state.plannedBuildings.pop();
    emitFootprintOccupancyChanged(ctx, x, z, footprintX, footprintZ);
    return { success: false, output: t('entities.build_no_approach') };
  }

  state.cash -= def.constructionCost;
  addExpense(state.finances, def.constructionCost, 'construction', `Build ${type} T${tier}`, state.tickCount);

  // Anyone caught standing on the new footprint is relocated off it.
  relocateFootprintOccupants(state, makeFootprintRegion(x, z, footprintX, footprintZ));

  // This order's own footprint can also strand an EARLIER order's builder,
  // not just its own approach cell — see rescueStrandedApproachTargets.
  rescueStrandedApproachTargets(ctx, state, actionId);

  // The builder's own walk target is the footprint's approach-ring cell
  // computed above, not the raw order origin (#1200) — the origin cell is
  // now blocked, so dispatching straight at it would send the crew to an
  // impassable tile. The building itself is still constructed and finalized
  // at the order's own (x, z) regardless of which ring cell this is
  // (TaskCompletionEffects.ts keys off PlannedBuilding.x/z, not this
  // action's target).
  const targetY = ctx.grid ? getSurfaceY(ctx.grid, approach.x, approach.z) : 0;

  // A build order queues silently even when the roster is empty (#556).
  dispatchPlaceBuildingAction(state, {
    actionId, buildingOrderId, tier, cost: def.constructionCost, footprint: def.footprint, approach, targetY,
  });

  return {
    success: true,
    output: `${type} T${tier} ordered at (${x},${z}). Cost: $${def.constructionCost}`,
  };
}
