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
  isPlacementBlockedByResearch,
  getStorageCapacity,
  type BuildingType,
  type BuildingTier,
} from '../../core/entities/Building.js';
import { addExpense } from '../../core/economy/Finance.js';
import { syncLogisticsCapacity } from '../../core/economy/Logistics.js';
import { NavGrid } from '../../core/nav/NavGrid.js';
import type { BlastRegion } from '../../core/mining/BlastExecution.js';
import { defineZone, clearZone, isZoneClear, type ZoneBounds } from '../../core/entities/Zone.js';
import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';

import { requireGame, NO_EMPLOYEES_MSG } from './commandUtils.js';
import { claimForAction, cellsInRect } from './siteExpansion.js';
import { DEFAULT_GRID_SIZE } from './world.js';

// The employee command moved to ./employees.ts; re-exported so existing imports
// and the runner registration keep resolving from here.
export { employeeCommand } from './employees.js';

function makeFootprintRegion(x: number, z: number, sizeX: number, sizeZ: number): BlastRegion {
  return { minX: x, maxX: x + sizeX - 1, minZ: z, maxZ: z + sizeZ - 1 };
}

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists — which
 * `requireGame` already rules out for every caller here.
 */
function siteBounds(ctx: GameContext): { width: number; depth: number; originX: number; originZ: number } {
  const grid = ctx.grid;
  if (!grid) return { width: DEFAULT_GRID_SIZE, depth: DEFAULT_GRID_SIZE, originX: 0, originZ: 0 };
  return { width: grid.sizeX, depth: grid.sizeZ, originX: grid.minX, originZ: grid.minZ };
}

function patchNavGrid(state: GameState, grid: VoxelGrid, region: BlastRegion): void {
  if (state.navGrid) {
    NavGrid.patchNavGrid(state.navGrid, grid, state.buildings.buildings, state.drillHoles, region);
  }
}

/** Re-derive logistics storage capacity from the current warehouse total. Call after any building mutation (build/destroy/upgrade/move). */
function refreshLogisticsCapacity(state: GameState): void {
  syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
}

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
      state.cash -= destroyDef.demolishCost;
      addExpense(state.finances, destroyDef.demolishCost, 'construction', `Demolish ${toDestroy.type} #${id}`, state.tickCount);
      destroyBuilding(state.buildings, id);
      refreshLogisticsCapacity(state);
      // Patch NavGrid for removed building footprint
      if (ctx.grid) {
        const { sizeX, sizeZ } = getDefSize(destroyDef);
        patchNavGrid(state, ctx.grid, makeFootprintRegion(toDestroy.x, toDestroy.z, sizeX, sizeZ));
      }
      return { success: true, output: `Building #${id} demolished. Cost: $${destroyDef.demolishCost}` };
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
      const totalCost = oldDef.demolishCost + newDef.constructionCost;
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
      const oldX = building.x;
      const oldZ = building.z;
      const moveClaim = claimForAction(
        ctx,
        cellsInRect(toCoords[0]!, toCoords[1]!, toCoords[0]! + sizeX - 1, toCoords[1]! + sizeZ - 1),
        'move a building',
      );
      if (!moveClaim.ok) return { success: false, output: moveClaim.output! };
      const moveBounds = siteBounds(ctx);
      const result = moveBuilding(
        state.buildings, id, toCoords[0]!, toCoords[1]!,
        moveBounds.width, moveBounds.depth, moveBounds.originX, moveBounds.originZ,
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
      // Try to place: build <type> at:x,z [tier:N]
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
      const { sizeX: footprintX, sizeZ: footprintZ } = getDefSize(getBuildingDef(type, tier));
      const placeClaim = claimForAction(
        ctx,
        cellsInRect(atCoords[0]!, atCoords[1]!, atCoords[0]! + footprintX - 1, atCoords[1]! + footprintZ - 1),
        'build',
      );
      if (!placeClaim.ok) return { success: false, output: placeClaim.output! };
      const placeBounds = siteBounds(ctx);
      const result = placeBuilding(
        state.buildings, type, atCoords[0]!, atCoords[1]!,
        placeBounds.width, placeBounds.depth, tier, placeBounds.originX, placeBounds.originZ,
      );
      if (!result.success) return { success: false, output: result.error! };
      state.cash -= result.cost!;
      addExpense(state.finances, result.cost!, 'construction', `Build ${type} T${tier}`, state.tickCount);
      refreshLogisticsCapacity(state);
      // Patch NavGrid for new building footprint
      if (ctx.grid) {
        const { sizeX, sizeZ } = getDefSize(getBuildingDef(type, tier));
        patchNavGrid(state, ctx.grid, makeFootprintRegion(atCoords[0]!, atCoords[1]!, sizeX, sizeZ));
      }
      return { success: true, output: `Built ${type} T${tier} #${result.building!.id} at (${atCoords[0]},${atCoords[1]}). Cost: $${result.cost}` };
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
    return { success: true, output: NO_EMPLOYEES_MSG };
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
      const result = clearZone(bounds, state.vehicles, state.employees);
      return {
        success: true,
        output: `Zone cleared. Moved ${result.movedVehicles} vehicles and ${result.movedEmployees} employees.`,
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


