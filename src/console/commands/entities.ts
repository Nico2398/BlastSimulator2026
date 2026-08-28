// BlastSimulator2026 — Console commands for entities (Phase 5)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  placeBuilding,
  destroyBuilding,
  moveBuilding,
  getAllBuildingTypes,
  getBuildingDef,
  getDefSize,
  getMoveCost,
  getDemolishCost,
  getUpgradeCost,
  isPlacementBlockedByResearch,
  type BuildingType,
  type BuildingTier,
} from '../../core/entities/Building.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { defineZone, isZoneClear, type ZoneBounds } from '../../core/entities/Zone.js';
import { evacuateZone } from '../../core/engine/Evacuation.js';

import { requireGame, noEmployeesMessage } from './commandUtils.js';
import { claimForAction, cellsInRect } from './siteExpansion.js';
import { makeFootprintRegion, siteBounds, patchNavGrid, refreshLogisticsCapacity } from './buildingHelpers.js';
import { orderBuildingCommand } from './buildOrder.js';

// The employee command moved to ./employees.ts; re-exported so existing imports
// and the runner registration keep resolving from here.
export { employeeCommand } from './employees.js';

// ── build command ──

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
        return { success: true, output: 'No buildings placed.' };
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
      if (isNaN(id)) return { success: false, output: 'Usage: build destroy <id>' };
      const toDestroy = state.buildings.buildings.find(b => b.id === id);
      if (!toDestroy) return { success: false, output: `Building #${id} not found.` };
      const destroyDef = getBuildingDef(toDestroy.type, toDestroy.tier);
      const demolishCost = getDemolishCost(toDestroy);
      if (state.cash < demolishCost) {
        return {
          success: false,
          output: `Insufficient funds: need $${formatMoney(demolishCost)}, have $${formatMoney(state.cash)}`,
        };
      }
      state.cash -= demolishCost;
      addExpense(state.finances, demolishCost, 'construction', `Demolish ${toDestroy.type} #${id}`, state.tickCount);
      destroyBuilding(state.buildings, id);
      refreshLogisticsCapacity(state);
      // Patch NavGrid for removed building footprint
      if (ctx.grid) {
        const { sizeX, sizeZ } = getDefSize(destroyDef);
        patchNavGrid(state, ctx.grid, makeFootprintRegion(toDestroy.x, toDestroy.z, sizeX, sizeZ));
      }
      return { success: true, output: `Building #${id} demolished. Cost: $${demolishCost}` };
    }
    case 'upgrade': {
      const id = parseInt(args[1] ?? '', 10);
      if (isNaN(id)) return { success: false, output: 'Usage: build upgrade <id>' };
      const toUpgrade = state.buildings.buildings.find(b => b.id === id);
      if (!toUpgrade) return { success: false, output: `Building #${id} not found.` };
      if (toUpgrade.tier >= 3) return { success: false, output: `Building #${id} is already at max tier (T3).` };
      const nextTier = (toUpgrade.tier + 1) as BuildingTier;
      if (isPlacementBlockedByResearch(state.buildings, toUpgrade.type, nextTier)) {
        return { success: false, output: `Tier ${nextTier} ${toUpgrade.type} is not researched — research required before upgrade.` };
      }
      const oldDef = getBuildingDef(toUpgrade.type, toUpgrade.tier);
      const newDef = getBuildingDef(toUpgrade.type, nextTier);
      const totalCost = getUpgradeCost(toUpgrade, nextTier);
      if (state.cash < totalCost) {
        return {
          success: false,
          output: `Insufficient funds: need $${formatMoney(totalCost)}, have $${formatMoney(state.cash)}`,
        };
      }
      const { x, z, type: upgradeType } = toUpgrade;
      destroyBuilding(state.buildings, id);
      const upBounds = siteBounds(ctx);
      const upgradeResult = placeBuilding(
        state.buildings, upgradeType, x, z,
        upBounds.width, upBounds.depth, nextTier, upBounds.originX, upBounds.originZ,
      );
      if (!upgradeResult.success) {
        return { success: false, output: `Upgrade failed: ${upgradeResult.error}` };
      }
      state.cash -= totalCost;
      addExpense(state.finances, totalCost, 'construction', `Upgrade ${upgradeType} to T${nextTier}`, state.tickCount);
      refreshLogisticsCapacity(state);
      // Patch NavGrid covering both old and new footprint (size may change between tiers)
      if (ctx.grid) {
        const maxX = Math.max(getDefSize(oldDef).sizeX, getDefSize(newDef).sizeX);
        const maxZ = Math.max(getDefSize(oldDef).sizeZ, getDefSize(newDef).sizeZ);
        patchNavGrid(state, ctx.grid, makeFootprintRegion(x, z, maxX, maxZ));
      }
      return {
        success: true,
        output: `Upgraded ${upgradeType} #${id} to T${nextTier} (new #${upgradeResult.building!.id}). Cost: $${totalCost}`,
      };
    }
    case 'move': {
      const id = parseInt(args[1] ?? '', 10);
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id) || toCoords.length < 2 || toCoords.some(isNaN)) {
        return { success: false, output: 'Usage: build move <id> to:x,z' };
      }
      const building = state.buildings.buildings.find(b => b.id === id);
      if (!building) return { success: false, output: `Building #${id} not found.` };
      const moveDef = getBuildingDef(building.type, building.tier);
      const { sizeX, sizeZ } = getDefSize(moveDef);
      const moveCost = getMoveCost(building);
      if (state.cash < moveCost) {
        return {
          success: false,
          output: `Insufficient funds: need $${formatMoney(moveCost)}, have $${formatMoney(state.cash)}`,
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
        plannedOccupants,
      );
      if (!result.success) return { success: false, output: result.error! };
      state.cash -= result.cost!;
      addExpense(state.finances, result.cost!, 'construction', `Relocate building #${id}`, state.tickCount);
      refreshLogisticsCapacity(state);
      // Patch NavGrid for old and new positions
      if (ctx.grid) {
        patchNavGrid(state, ctx.grid, makeFootprintRegion(oldX, oldZ, sizeX, sizeZ));
        patchNavGrid(state, ctx.grid, makeFootprintRegion(toCoords[0]!, toCoords[1]!, sizeX, sizeZ));
      }
      return { success: true, output: `Building #${id} moved. Cost: $${result.cost}` };
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
        return { success: false, output: `Unknown subcommand or building type: "${sub}". Use: build (list|destroy|upgrade|move|types|<type> at:x,z [tier:N])` };
      }
      const atCoords = (named['at'] ?? '').split(',').map(Number);
      if (atCoords.length < 2 || atCoords.some(isNaN)) {
        return { success: false, output: `Usage: build ${type} at:x,z [tier:1|2|3]` };
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
    lines.push(`  [${e.id}] ${e.name.padEnd(20)} — hunger: ${e.hunger}  fatigue: ${e.fatigue}  break: ${e.breakNeed}`);
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
      `  Nuisance:   ${s.nuisance.toFixed(1)}`,
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
        return { success: false, output: 'Usage: zone clear x1:10 y1:10 x2:30 y2:30' };
      }
      const bounds: ZoneBounds = { x1, z1, x2, z2 };
      defineZone(state.zone, bounds);
      // Evacuate the normalized bounds defineZone just stored (state.zone.activeZone),
      // not the raw, possibly-unordered `bounds` the player/UI passed in.
      const result = evacuateZone(state, state.zone.activeZone!);
      return {
        success: true,
        output: `Zone cleared. Moved ${result.orderedVehicleIds.length} vehicles and ${result.orderedEmployeeIds.length} employees.`,
      };
    }
    case 'status': {
      if (!state.zone.activeZone) {
        return { success: true, output: 'No safety zone defined.' };
      }
      const z = state.zone.activeZone;
      const clear = isZoneClear(z, state.vehicles, state.employees);
      return {
        success: true,
        output: `Zone: (${z.x1},${z.z1}) to (${z.x2},${z.z2}) — ${clear ? 'CLEAR' : 'NOT CLEAR'}`,
      };
    }
    default:
      return { success: false, output: 'Usage: zone (clear|status)' };
  }
}


