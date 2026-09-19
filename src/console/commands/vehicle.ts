// BlastSimulator2026 — Console vehicle command

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { GameState } from '../../core/state/GameState.js';
import {
  purchaseVehicle,
  destroyVehicle,
  getAllVehicleRoles,
  getVehicleDefByTier,
  computeScrapResidualValue,
  canAssignDriver,
  vehicleDriverId,
  getVehicleReservation,
  resolveVehicleDriver,
  type VehicleRole,
  type VehicleTier,
} from '../../core/entities/Vehicle.js';
import { findAvailableDriverForReposition } from '../../core/entities/VehicleDriverAssignment.js';
import { computeVehicleStatus } from '../../core/entities/VehicleStatus.js';
import { alight } from '../../core/engine/Mount.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { moveTo } from '../../core/engine/MoveTo.js';
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
        const driverId = vehicleDriverId(v);
        const driverInfo = driverId !== null ? `driver:#${driverId}` : 'driver:none';
        const driver = resolveVehicleDriver(v, state.employees.employees);
        const status = computeVehicleStatus(v, state.vehicles, driver).kind;
        lines.push(`  [${v.id}] ${v.type} at (${v.x},${v.z}) status: ${status} HP: ${v.hp} ${driverInfo}`);
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
      // wall off a pocket of "nearest" traversable tiles from the rest of the
      // map (#437: driver boarding walks to the vehicle, and nothing can path
      // onto an unreachable tile), or bury the point in a fragment field
      // whose cells still read 'walkable' but that no driver can step through
      // (#954). findNearestSpawnCell rules out all three — see its own doc
      // for why the anchor it snaps against is derived rather than the
      // literal corner this call site used to assume (#1151). Same call, same
      // reasons, as the employee hire spawn point in employees.ts.
      const { x: spawnX, z: spawnZ } = state.navGrid
        ? NavGrid.findNearestSpawnCell(state.navGrid, rawSpawnX, rawSpawnZ)
        : { x: rawSpawnX, z: rawSpawnZ };
      // Deducts the same `cost` the guard above tested, so the checked amount
      // and the charged amount can never drift apart.
      const { vehicle } = purchaseVehicle(state.vehicles, type, spawnX, spawnZ, tier);
      state.cash -= cost;
      addExpense(state.finances, cost, 'equipment', `Buy ${type}`, state.tickCount);
      return { success: true, output: t('vehicle.buy_success', { type, id: vehicle.id, cost }) };
    }
    case 'driver': {
      const vehicleId = parseInt(args[1] ?? '', 10);
      if (isNaN(vehicleId)) {
        return { success: false, output: t('vehicle.driver_usage') };
      }
      if (args[2] === 'none') {
        const result = alight(state, vehicleId, ctx.emitter);
        if (!result.success) {
          return { success: false, output: result.error };
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
      // Validates licence/availability now — the same canAssignDriver check
      // Mount.board re-runs at arrival time (#1089) — so a request that can
      // never succeed (unlicensed employee, vehicle already has a driver) is
      // rejected immediately rather than only once the employee has walked
      // all the way there. The employee still must physically walk to the
      // vehicle before they actually become its driver — resolved by
      // tickLocomotion's own board arrival step once they arrive.
      const eligible = canAssignDriver(state.vehicles, state.employees, vehicleId, employeeId);
      if (!eligible.success) {
        return { success: false, output: eligible.error };
      }
      const result = moveTo(state, employeeId, { vehicleId });
      if (!result.success) {
        return { success: false, output: result.error };
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
    case 'reposition': {
      return repositionVehicleCommand(state, args);
    }
    default:
      return { success: false, output: t('vehicle.usage') };
  }
}

// ── reposition subcommand (#1092) ──

/**
 * `vehicle reposition <id> <x> <z>` — drive a vehicle somewhere with no work
 * attached (Itinerary's `reposition` Goal, planned by `planItinerary`). The
 * one entry point for that, replacing the display-only `assign task:moving`
 * and `move` subcommands this file used to carry (#1092).
 *
 * The driver is whoever is already aboard; with the vehicle empty, the
 * nearest idle licensed employee is picked and walks over to board it
 * (`findAvailableDriverForReposition`). Refused outright while the vehicle is
 * reserved for a task — repositioning it would strand that work mid-flight.
 */
function repositionVehicleCommand(state: GameState, args: string[]): CommandResult {
  const id = parseInt(args[1] ?? '', 10);
  const x = Number(args[2]);
  const z = Number(args[3]);
  if (isNaN(id) || !Number.isFinite(x) || !Number.isFinite(z) || args[2] === undefined || args[3] === undefined) {
    return { success: false, output: t('vehicle.reposition_usage') };
  }

  const vehicle = state.vehicles.vehicles.find(v => v.id === id);
  if (!vehicle) return { success: false, output: t('vehicle.not_found', { id }) };

  if (getVehicleReservation(state.vehicles, vehicle.id) !== null) {
    return { success: false, output: t('vehicle.reposition_reserved', { id }) };
  }

  const driverId = vehicleDriverId(vehicle)
    ?? findAvailableDriverForReposition(vehicle, state.vehicles, state.employees)?.id
    ?? null;
  if (driverId === null) {
    return { success: false, output: t('vehicle.reposition_no_driver', { id }) };
  }

  const result = moveTo(state, driverId, { x, z }, { via: vehicle.id });
  if (!result.success) {
    return { success: false, output: result.error };
  }
  return { success: true, output: t('vehicle.reposition_success', { id, x, z }) };
}
