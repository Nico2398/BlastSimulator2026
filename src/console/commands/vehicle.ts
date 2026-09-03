// BlastSimulator2026 — Console vehicle command

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  purchaseVehicle,
  assignVehicle,
  moveVehicle,
  unassignDriver,
  destroyVehicle,
  getAllVehicleRoles,
  getVehicleDefByTier,
  computeScrapResidualValue,
  type VehicleRole,
  type VehicleTask,
  type VehicleTier,
} from '../../core/entities/Vehicle.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { requestBoardVehicle } from '../../core/entities/VehicleBoarding.js';
import { requestHaulFragment } from '../../core/economy/HaulingTask.js';
import { requestBreakBoulder } from '../../core/economy/BoulderBreaking.js';
import { addExpense, addIncome } from '../../core/economy/Finance.js';
import { SPAWN_RING_SIZE, SPAWN_TILE_SPACING } from '../../core/config/balance.js';
import { NavGrid } from '../../core/nav/NavGrid.js';
import { requireGame } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';

// ── tier arg parsing ──

/**
 * Parses and validates the `tier:` named arg for `vehicle buy` (default 1;
 * only 1|2|3 accepted, matching the role-validation branch below). Returns
 * the parsed tier, or `null` when the arg is present but not 1|2|3. Called
 * from the `buy` case below, which threads the result into purchaseVehicle.
 */
export function parseVehicleTierArg(named: Record<string, string>): VehicleTier | null {
  const raw = named['tier'];
  if (raw === undefined) return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || (parsed !== 1 && parsed !== 2 && parsed !== 3)) return null;
  return parsed;
}

// ── vehicle command ──

export function vehicleCommand(
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
      if (state.vehicles.vehicles.length === 0) {
        return { success: true, output: t('vehicle.list_empty') };
      }
      const lines = ['Fleet:'];
      for (const v of state.vehicles.vehicles) {
        const driverInfo = v.driverId !== null ? `driver:#${v.driverId}` : 'driver:none';
        lines.push(`  [${v.id}] ${v.type} at (${v.x},${v.z}) task: ${v.task} HP: ${v.hp} ${driverInfo}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    case 'buy': {
      const type = (args[1] ?? '') as VehicleRole;
      if (!getAllVehicleRoles().includes(type)) {
        return { success: false, output: t('vehicle.buy_usage_role', { roles: getAllVehicleRoles().join('|') }) };
      }
      const tier = parseVehicleTierArg(named);
      if (tier === null) {
        return { success: false, output: t('vehicle.buy_usage_tier') };
      }
      // Checked before purchaseVehicle, which *mutates* — it pushes the
      // vehicle and bumps nextId before it can report a cost. Same predicate
      // and same cost source as the UI: FleetPanel disables the per-tier
      // dealership button on `cash < getVehicleDefByTier(role, tier).purchaseCost`,
      // and that is exactly the `cost` purchaseVehicle returns.
      const cost = getVehicleDefByTier(type, tier).purchaseCost;
      if (state.cash < cost) {
        return {
          success: false,
          output: t('console.insufficient_funds', {
            need: formatMoney(cost),
            have: formatMoney(state.cash),
          }),
        };
      }
      // Spawn near grid centre, staggered per fleet index so newly purchased
      // vehicles land on distinct tiles instead of stacking on the depot
      // point — every prior purchase overlapped at one tile, occluding all
      // but the tallest mesh (#411).
      const baseX = state.world ? state.world.minX + state.world.sizeX / 2 : 32;
      const baseZ = state.world ? state.world.minZ + state.world.sizeZ / 2 : 32;
      const fleetIndex = state.vehicles.vehicles.length;
      const rawSpawnX = baseX + (fleetIndex % SPAWN_RING_SIZE) * SPAWN_TILE_SPACING;
      const rawSpawnZ = baseZ + Math.floor(fleetIndex / SPAWN_RING_SIZE) * SPAWN_TILE_SPACING;
      // A blast can clear the grid centre down to a floorless 'void' column,
      // or wall off a pocket of "nearest" traversable tiles from the rest of
      // the map entirely — #437 regression: driver boarding now walks to the
      // vehicle instead of assigning instantly, and nothing can path onto an
      // unreachable tile. Snap the spawn point to the nearest NavGrid cell
      // that is actually path-connected to the map's main region (anchored
      // at a corner, since blast sites are never placed on the map edge) so
      // a freshly bought vehicle is always reachable on foot.
      const { x: spawnX, z: spawnZ } = state.navGrid
        ? NavGrid.findNearestReachableCell(state.navGrid, 0, 0, rawSpawnX, rawSpawnZ)
        : { x: rawSpawnX, z: rawSpawnZ };
      // Deducts the same `cost` the guard above tested, so the checked amount
      // and the charged amount can never drift apart.
      const { vehicle } = purchaseVehicle(state.vehicles, type, spawnX, spawnZ, tier);
      state.cash -= cost;
      addExpense(state.finances, cost, 'equipment', `Buy ${type}`, state.tickCount);
      return { success: true, output: t('vehicle.buy_success', { type, id: vehicle.id, cost }) };
    }
    case 'assign': {
      const id = parseInt(args[1] ?? '', 10);
      const task = (named['task'] ?? 'idle') as VehicleTask;
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id)) return { success: false, output: t('vehicle.assign_usage') };
      const targetX = toCoords.length >= 2 && !toCoords.some(isNaN) ? toCoords[0] : undefined;
      const targetZ = toCoords.length >= 2 && !toCoords.some(isNaN) ? toCoords[1] : undefined;
      if (!assignVehicle(state.vehicles, id, task, targetX, targetZ)) {
        return { success: false, output: t('vehicle.not_found', { id }) };
      }
      return { success: true, output: t('vehicle.assign_success', { id, task }) };
    }
    case 'move': {
      const id = parseInt(args[1] ?? '', 10);
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id) || toCoords.length < 2 || toCoords.some(isNaN)) {
        return { success: false, output: t('vehicle.move_usage') };
      }
      const target = state.vehicles.vehicles.find(v => v.id === id);
      if (!target) {
        return { success: false, output: t('vehicle.not_found', { id }) };
      }
      // canTickVehicle (EntityMovementTick.ts, #947) never advances a
      // driverless vehicle — staging task='moving' here would silently
      // no-op instead of walking, which is worse than today's (wrong, but
      // visible) unmanned drive. Refuse instead.
      if (target.driverId === null) {
        return { success: false, output: t('vehicle.move_no_driver', { id }) };
      }
      if (!moveVehicle(state.vehicles, id, toCoords[0]!, toCoords[1]!)) {
        return { success: false, output: t('vehicle.not_found', { id }) };
      }
      return { success: true, output: t('vehicle.move_success', { id, x: toCoords[0]!, z: toCoords[1]! }) };
    }
    case 'driver': {
      const vehicleId = parseInt(args[1] ?? '', 10);
      if (isNaN(vehicleId)) {
        return { success: false, output: t('vehicle.driver_usage') };
      }
      if (args[2] === 'none') {
        const result = unassignDriver(state.vehicles, vehicleId);
        if (!result.success) {
          return { success: false, output: result.error! };
        }
        return { success: true, output: t('vehicle.driver_unassign_success', { id: vehicleId }) };
      }
      const employeeId = parseInt(args[2] ?? '', 10);
      if (isNaN(employeeId)) {
        return { success: false, output: t('vehicle.driver_usage') };
      }
      if (!state.vehicles.vehicles.find(v => v.id === vehicleId)) {
        return { success: false, output: t('vehicle.not_found', { id: vehicleId }) };
      }
      // Validates licence/availability now, but the employee must physically
      // walk to the vehicle before they actually become its driver — resolved
      // by ArrivalGate.tickArrivalGate once they arrive (#437).
      const result = requestBoardVehicle(state, vehicleId, employeeId);
      if (!result.success) {
        return { success: false, output: result.error! };
      }
      return { success: true, output: t('vehicle.driver_board_success', { employeeId, vehicleId }) };
    }
    case 'haul': {
      const vehicleId = parseInt(args[1] ?? '', 10);
      const fragmentId = parseInt(named['fragment'] ?? '', 10);
      if (isNaN(vehicleId) || isNaN(fragmentId)) {
        return { success: false, output: t('vehicle.haul_usage') };
      }
      // Sets intent only — the vehicle must physically drive to the fragment
      // before loading it, then to the depot before unloading — resolved by
      // ArrivalGate.tickArrivalGate/tickHaulingProgress each tick (#437).
      const result = requestHaulFragment(state, vehicleId, fragmentId);
      if (!result.success) {
        return { success: false, output: result.error! };
      }
      return { success: true, output: t('vehicle.haul_success', { id: vehicleId, fragmentId }) };
    }
    case 'scrap': {
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      if (isNaN(id)) return { success: false, output: t('vehicle.scrap_usage') };
      const vehicle = state.vehicles.vehicles.find(v => v.id === id);
      if (!vehicle) return { success: false, output: t('vehicle.not_found', { id }) };
      const residualValue = computeScrapResidualValue(vehicle.type, vehicle.tier, vehicle.hp);
      destroyVehicle(state.vehicles, id);
      state.cash += residualValue;
      addIncome(state.finances, residualValue, 'refund', `Scrap ${vehicle.type} #${id}`, state.tickCount);
      return { success: true, output: t('vehicle.scrap_success', { id, value: residualValue }) };
    }
    case 'break': {
      const vehicleId = parseInt(args[1] ?? '', 10);
      const fragmentId = parseInt(named['fragment'] ?? '', 10);
      if (isNaN(vehicleId) || isNaN(fragmentId)) {
        return { success: false, output: t('vehicle.break_usage') };
      }
      // Sets intent only — the vehicle must physically drive to the boulder
      // before breaking it — resolved by ArrivalGate.tickArrivalGate/
      // tickBreakProgress each tick (#484).
      const result = requestBreakBoulder(state, vehicleId, fragmentId);
      if (!result.success) {
        return { success: false, output: result.error! };
      }
      return { success: true, output: t('vehicle.break_success', { id: vehicleId, fragmentId }) };
    }
    default:
      return { success: false, output: t('vehicle.usage') };
  }
}
