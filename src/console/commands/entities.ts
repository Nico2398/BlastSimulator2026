// BlastSimulator2026 — Console commands for entities (Phase 5)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  moveBuilding,
  getAllBuildingTypes,
  getBuildingDef,
  getDefSize,
  getMoveCost,
  getDemolishCost,
  getUpgradeCost,
  isPlacementBlockedByResearch,
  checkFootprintPlacement,
  type BuildingType,
  type Building,
  type BuildingTier,
  type FootprintOccupant,
} from '../../core/entities/Building.js';
import { warehouseStoredKg } from '../../core/economy/FreightWarehouses.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { defineZone, isZoneClear, type ZoneBounds } from '../../core/entities/Zone.js';
import { evacuateZone } from '../../core/engine/Evacuation.js';
import { queueDemolition, isDemolitionOrdered } from '../../core/engine/BuildingDemolition.js';
import { findBuildingApproachCell } from '../../core/nav/BuildingApproach.js';
import { getSurfaceY } from '../../core/entities/BuildingPlacement.js';

import { requireGame, noEmployeesMessage, refusalText } from './commandUtils.js';
import { claimForAction, cellsInRect } from './siteExpansion.js';
import {
  makeFootprintRegion, levelBuildingFootprint, siteBounds, refreshLogisticsCapacity,
  emitFootprintOccupancyChanged, relocateFootprintOccupants,
} from './buildingHelpers.js';
import { orderBuildingCommand } from './buildOrder.js';
import { t } from '../../core/i18n/I18n.js';
import { terrainReservations } from '../../core/entities/PlacementReservations.js';

// The employee command moved to ./employees.ts; re-exported so existing imports
// and the runner registration keep resolving from here.
export { employeeCommand } from './employees.js';

// ── build command ──

/** Where a Building Destroyer walks to demolish `building`: its approach-ring cell and that cell's surface height. */
function demolitionSite(ctx: GameContext, building: Building): { approach: { x: number; z: number }; targetY: number } {
  const def = getBuildingDef(building.type, building.tier);
  const approach = findBuildingApproachCell(ctx.state!.navGrid, { x: building.x, z: building.z }, def, building.x, building.z);
  return { approach, targetY: ctx.grid ? getSurfaceY(ctx.grid, approach.x, approach.z) : 0 };
}

export function buildCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'list';

  switch (sub) {
    case 'list': {
      if (state.buildings.buildings.length === 0) {
        return { success: true, output: t('entities.build_list_empty') };
      }
      const lines = ['Buildings:'];
      for (const b of state.buildings.buildings) {
        const def = getBuildingDef(b.type, b.tier);
        lines.push(`  [${b.id}] ${b.type} T${b.tier} at (${b.x},${b.z}) HP: ${b.hp}/${def.maxHp}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    case 'destroy': {
      const id = parseInt(args[1] ?? '', 10);
      if (isNaN(id)) return { success: false, output: t('entities.build_destroy_usage') };
      const toDestroy = state.buildings.buildings.find(b => b.id === id);
      if (!toDestroy) return { success: false, output: t('entities.building_not_found', { id }) };
      if (isDemolitionOrdered(state, id)) {
        return { success: false, output: t('entities.build_demolish_already_ordered', { id }) };
      }
      const demolishCost = getDemolishCost(toDestroy);
      if (state.cash < demolishCost) {
        return {
          success: false,
          output: t('console.insufficient_funds', {
            need: formatMoney(demolishCost),
            have: formatMoney(state.cash),
          }),
        };
      }
      // The building stays standing and operating until a Building Destroyer
      // finishes the work (#1392); only the order is queued here.
      queueDemolition(state, toDestroy, { cost: demolishCost, rebuildOrderId: null, ...demolitionSite(ctx, toDestroy) });
      state.cash -= demolishCost;
      addExpense(state.finances, demolishCost, 'construction', `Demolish ${toDestroy.type} #${id}`, state.tickCount);
      const lostKg = toDestroy.type === 'explosive_warehouse' ? (toDestroy.storedExplosivesKg ?? 0) : 0;
      const destroyOutput = t('entities.build_destroy_ordered', { id, cost: demolishCost });
      const lostOreKg = toDestroy.type === 'freight_warehouse' ? Math.round(warehouseStoredKg(state.logistics, id)) : 0;
      const lines = [destroyOutput];
      if (lostKg > 0) lines.push(t('entities.build_destroy_lost_explosives', { kg: lostKg }));
      if (lostOreKg > 0) lines.push(t('entities.build_destroy_lost_ore', { kg: lostOreKg }));
      return { success: true, output: lines.join('\n') };
    }
    case 'upgrade': {
      const id = parseInt(args[1] ?? '', 10);
      if (isNaN(id)) return { success: false, output: t('entities.build_upgrade_usage') };
      const toUpgrade = state.buildings.buildings.find(b => b.id === id);
      if (!toUpgrade) return { success: false, output: t('entities.building_not_found', { id }) };
      if (toUpgrade.tier >= 3) return { success: false, output: t('entities.build_upgrade_max_tier', { id }) };
      if (isDemolitionOrdered(state, id)) {
        return { success: false, output: t('entities.build_demolish_already_ordered', { id }) };
      }
      const nextTier = (toUpgrade.tier + 1) as BuildingTier;
      if (isPlacementBlockedByResearch(state.buildings, toUpgrade.type, nextTier)) {
        return { success: false, output: t('entities.build_upgrade_not_researched', { tier: nextTier, type: toUpgrade.type }) };
      }
      const oldDef = getBuildingDef(toUpgrade.type, toUpgrade.tier);
      const newDef = getBuildingDef(toUpgrade.type, nextTier);
      const totalCost = getUpgradeCost(toUpgrade, nextTier);
      if (state.cash < totalCost) {
        return {
          success: false,
          output: t('console.insufficient_funds', {
            need: formatMoney(totalCost),
            have: formatMoney(state.cash),
          }),
        };
      }
      const { x, z, type: upgradeType } = toUpgrade;

      // Validate the NEW tier's footprint at order time: the larger tier can
      // run past the site bounds, overlap a neighbour or cover uneven ground
      // (#1008). Occupants exclude this building itself, which the
      // demolition clears before the rebuild; every other live building and
      // reserved construction site still counts.
      const upBounds = siteBounds(ctx);
      const upgradeOccupants: FootprintOccupant[] = [
        ...state.buildings.buildings.filter(b => b.id !== id).map(b => ({ type: b.type, tier: b.tier, x: b.x, z: b.z })),
        ...state.plannedBuildings.map(pb => ({ type: pb.type, tier: pb.tier, x: pb.x, z: pb.z })),
      ];
      const upgradeCheck = checkFootprintPlacement(
        upgradeOccupants, upgradeType, x, z, nextTier,
        upBounds.width, upBounds.depth, upBounds.originX, upBounds.originZ, ctx.grid ?? undefined,
        terrainReservations(state),
      );
      if (!upgradeCheck.valid) {
        return { success: false, output: t('entities.build_upgrade_failed', { error: refusalText(upgradeCheck) }) };
      }

      // Reserve the finished building under the SAME id: the planned site
      // blocks the larger footprint from now, and its place_building action
      // is dispatched when the demolition completes (#1392).
      const { sizeX: newSizeX, sizeZ: newSizeZ } = getDefSize(newDef);
      const { sizeX: oldSizeX, sizeZ: oldSizeZ } = getDefSize(oldDef);
      const rebuildOrderId = state.nextPlannedBuildingId++;
      state.plannedBuildings.push({
        id: rebuildOrderId, buildingId: id, type: upgradeType, tier: nextTier, x, z,
        actionId: state.nextPendingActionId++, cost: newDef.constructionCost,
      });
      // Anyone standing on the larger new footprint is put off it now, as the
      // old instant upgrade did.
      if (ctx.grid) {
        const maxX = Math.max(oldSizeX, newSizeX);
        const maxZ = Math.max(oldSizeZ, newSizeZ);
        emitFootprintOccupancyChanged(ctx, x, z, maxX, maxZ);
        relocateFootprintOccupants(state, makeFootprintRegion(x, z, maxX, maxZ));
      }
      queueDemolition(state, toUpgrade, { cost: totalCost, rebuildOrderId, ...demolitionSite(ctx, toUpgrade) });
      state.cash -= totalCost;
      addExpense(state.finances, totalCost, 'construction', `Upgrade ${upgradeType} to T${nextTier}`, state.tickCount);
      return { success: true, output: t('entities.build_upgrade_ordered', { id }) };
    }
    case 'move': {
      const id = parseInt(args[1] ?? '', 10);
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id) || toCoords.length < 2 || toCoords.some(isNaN)) {
        return { success: false, output: t('entities.build_move_usage') };
      }
      const building = state.buildings.buildings.find(b => b.id === id);
      if (!building) return { success: false, output: t('entities.building_not_found', { id }) };
      const moveDef = getBuildingDef(building.type, building.tier);
      const { sizeX, sizeZ } = getDefSize(moveDef);
      const moveCost = getMoveCost(building);
      if (state.cash < moveCost) {
        return {
          success: false,
          output: t('console.insufficient_funds', {
            need: formatMoney(moveCost),
            have: formatMoney(state.cash),
          }),
        };
      }
      const oldX = building.x;
      const oldZ = building.z;
      const moveClaim = claimForAction(
        ctx,
        cellsInRect(toCoords[0]!, toCoords[1]!, toCoords[0]! + sizeX - 1, toCoords[1]! + sizeZ - 1),
        'move a building',
      );
      if (!moveClaim.ok) return { success: false, output: moveClaim.output! };
      const moveBounds = siteBounds(ctx);
      const plannedOccupants = state.plannedBuildings.map(pb => ({ type: pb.type, tier: pb.tier, x: pb.x, z: pb.z }));
      const result = moveBuilding(
        state.buildings, id, toCoords[0]!, toCoords[1]!,
        moveBounds.width, moveBounds.depth, moveBounds.originX, moveBounds.originZ,
        plannedOccupants, ctx.grid ?? undefined, terrainReservations(state),
      );
      if (!result.success) return { success: false, output: refusalText(result) };
      state.cash -= result.cost!;
      addExpense(state.finances, result.cost!, 'construction', `Relocate building #${id}`, state.tickCount);
      refreshLogisticsCapacity(state);
      // Notify NavGridSync via nav:occupancy_changed for old and new positions
      if (ctx.grid) {
        // A relocated building lands on ground nothing has levelled yet, so its
        // new footprint gets the same cut a finished build does (#1008
        // refinement, tickTaskCompletion.ts). The vacated one is left as it is:
        // levelling is not undone by moving away from it.
        // levelBuildingFootprint (BuildingTaskHelpers.ts) carves and derives the
        // target height from the same true footprint — the building's mesh is
        // centred on it exactly (#1198), so there is no skirt beyond it to
        // widen the carve into or guard against a neighbour.
        levelBuildingFootprint(
          ctx.grid, toCoords[0]!, toCoords[1]!, sizeX, sizeZ, ctx.emitter,
        );
        emitFootprintOccupancyChanged(ctx, oldX, oldZ, sizeX, sizeZ);
        emitFootprintOccupancyChanged(ctx, toCoords[0]!, toCoords[1]!, sizeX, sizeZ);
        relocateFootprintOccupants(state, makeFootprintRegion(toCoords[0]!, toCoords[1]!, sizeX, sizeZ));
      }
      return { success: true, output: t('entities.build_move_success', { id, cost: result.cost! }) };
    }
    case 'types': {
      const lines = ['Building types:'];
      for (const type of getAllBuildingTypes()) {
        const def = getBuildingDef(type);
        const { sizeX, sizeZ } = getDefSize(def);
        lines.push(`  ${type} — $${def.constructionCost} | ${sizeX}x${sizeZ} | HP: ${def.maxHp}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    default: {
      // Try to order: build <type> at:x,z [tier:N]
      // #556: placement is no longer instant — orderBuildingCommand validates
      // and charges exactly as this case used to, then queues a
      // `place_building` action and a PlannedBuilding instead of creating the
      // building here. See buildOrder.ts.
      const type = sub as BuildingType;
      if (!getAllBuildingTypes().includes(type)) {
        return { success: false, output: t('entities.build_unknown_subcommand', { sub }) };
      }
      const atCoords = (named['at'] ?? '').split(',').map(Number);
      if (atCoords.length < 2 || atCoords.some(isNaN)) {
        return { success: false, output: t('entities.build_type_usage', { type }) };
      }
      const tierParam = parseInt(named['tier'] ?? '1', 10);
      const tier = ([1, 2, 3].includes(tierParam) ? tierParam : 1) as BuildingTier;
      return orderBuildingCommand(ctx, type, atCoords[0]!, atCoords[1]!, tier);
    }
  }
}

// ── needs command ──

export function needsCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  if (state.employees.employees.length === 0) {
    return { success: true, output: noEmployeesMessage() };
  }
  const lines = ['Employee Needs:'];
  for (const e of state.employees.employees) {
    lines.push(`  [${e.id}] ${e.name.padEnd(20)} — fatigue: ${e.fatigue}`);
  }
  return { success: true, output: lines.join('\n') };
}

// ── scores command ──

export function scoresCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const s = ctx.state!.scores;

  return {
    success: true,
    output: [
      'Scores (0-100):',
      `  Well-being: ${s.wellBeing.toFixed(1)}`,
      `  Safety:     ${s.safety.toFixed(1)}`,
      `  Ecology:    ${s.ecology.toFixed(1)}`,
      `  Neighbours: ${s.nuisance.toFixed(1)}`,
    ].join('\n'),
  };
}

// ── zone command ──

export function zoneCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

  switch (sub) {
    case 'clear': {
      const x1 = parseInt(named['x1'] ?? '', 10);
      const z1 = parseInt(named['y1'] ?? named['z1'] ?? '', 10);
      const x2 = parseInt(named['x2'] ?? '', 10);
      const z2 = parseInt(named['y2'] ?? named['z2'] ?? '', 10);
      if ([x1, z1, x2, z2].some(isNaN)) {
        return { success: false, output: t('entities.zone_clear_usage') };
      }
      const bounds: ZoneBounds = { x1, z1, x2, z2 };
      defineZone(state.zone, bounds);
      // Evacuate the normalized bounds defineZone just stored (state.zone.activeZone),
      // not the raw, possibly-unordered `bounds` the player/UI passed in.
      const result = evacuateZone(state, state.zone.activeZone!);
      return {
        success: true,
        output: t('entities.zone_clear_success', {
          vehicleCount: result.orderedVehicleIds.length,
          employeeCount: result.orderedEmployeeIds.length,
        }),
      };
    }
    case 'status': {
      if (!state.zone.activeZone) {
        return { success: true, output: t('entities.zone_status_none') };
      }
      const z = state.zone.activeZone;
      const clear = isZoneClear(z, state.vehicles, state.employees);
      return {
        success: true,
        output: `Zone: (${z.x1},${z.z1}) to (${z.x2},${z.z2}) — ${clear ? 'CLEAR' : 'NOT CLEAR'}`,
      };
    }
    default:
      return { success: false, output: t('entities.zone_usage') };
  }
}


