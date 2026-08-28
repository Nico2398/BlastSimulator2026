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
  isPlacementBlockedByResearch,
  checkFootprintPlacement,
  type BuildingType,
  type BuildingTier,
  type FootprintOccupant,
} from '../../core/entities/Building.js';
import type { PlannedBuilding } from '../../core/state/GameState.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { getSurfaceY } from '../../core/entities/BuildingPlacement.js';
import { dispatchPendingAction } from '../../core/engine/TaskDispatch.js';
import { BUILDING_CONSTRUCTION_BASE_DURATION_TICKS, BUILDING_CONSTRUCTION_TIER_MULTIPLIER } from '../../core/config/balance.js';

import { claimForAction, cellsInRect } from './siteExpansion.js';
import { siteBounds } from './buildingHelpers.js';

/** Payload carried by a queued `place_building` PendingAction (#556). */
export interface PlaceBuildingActionPayload {
  buildingOrderId: number;
  cost: number;
  footprint: ReadonlyArray<readonly [number, number]>;
  durationTicks: number;
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
  tier: BuildingTier,
): CommandResult {
  const state = ctx.state!;

  // Same two-stage order buildCommand's default case already documents:
  // research gate, then funds — both ahead of claimForAction/the footprint
  // check because those mutate (claim off-site land, reserve the site).
  if (isPlacementBlockedByResearch(state.buildings, type, tier)) {
    return { success: false, output: `Tier ${tier} ${type} is not researched — research required before placement.` };
  }

  const def = getBuildingDef(type, tier);
  if (state.cash < def.constructionCost) {
    return {
      success: false,
      output: `Insufficient funds: need $${formatMoney(def.constructionCost)}, have $${formatMoney(state.cash)}`,
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
  const occupants: FootprintOccupant[] = [
    ...state.buildings.buildings.map(b => ({ type: b.type, tier: b.tier, x: b.x, z: b.z })),
    ...state.plannedBuildings.map(pb => ({ type: pb.type, tier: pb.tier, x: pb.x, z: pb.z })),
  ];
  const check = checkFootprintPlacement(
    occupants, type, x, z, tier, bounds.width, bounds.depth, bounds.originX, bounds.originZ,
  );
  if (!check.valid) return { success: false, output: check.error! };

  state.cash -= def.constructionCost;
  addExpense(state.finances, def.constructionCost, 'construction', `Build ${type} T${tier}`, state.tickCount);

  const buildingOrderId = state.nextPlannedBuildingId++;
  const targetY = ctx.grid ? getSurfaceY(ctx.grid, x, z) : 0;
  const durationTicks = Math.ceil(BUILDING_CONSTRUCTION_BASE_DURATION_TICKS * BUILDING_CONSTRUCTION_TIER_MULTIPLIER[tier]);
  const actionId = state.nextPendingActionId++;

  // skipQualificationCheck (#556, mirrors dig_ramp_segment/drill_hole/
  // charge_hole's #555/#553/#554 dispatch): a build order must queue
  // silently even when the roster is empty — construction needs no skill
  // and no vehicle (requiredSkill/requiredVehicleRole both null).
  dispatchPendingAction(state, {
    id: actionId,
    type: 'place_building',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: x,
    targetZ: z,
    targetY,
    payload: {
      buildingOrderId, cost: def.constructionCost, footprint: def.footprint, durationTicks,
    } satisfies PlaceBuildingActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });

  // Claim the finished building's id now, not when the site completes: sites are
  // built in parallel and land in whatever order the crew reaches them, so
  // numbering at completion would hand the player ids in an order they never
  // chose (and make `build destroy 1` name a different building each run).
  const plannedBuilding: PlannedBuilding = {
    id: buildingOrderId, buildingId: state.buildings.nextId++,
    type, tier, x, z, actionId, cost: def.constructionCost,
  };
  state.plannedBuildings.push(plannedBuilding);

  return {
    success: true,
    output: `${type} T${tier} ordered at (${x},${z}). Cost: $${def.constructionCost}`,
  };
}
