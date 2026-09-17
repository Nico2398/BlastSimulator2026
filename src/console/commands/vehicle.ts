// BlastSimulator2026 — Console vehicle command

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  purchaseVehicle,
  assignVehicle,
  destroyVehicle,
  getAllVehicleRoles,
  getVehicleDefByTier,
  computeScrapResidualValue,
  canAssignDriver,
  type VehicleRole,
  type VehicleTask,
  type VehicleTier,
} from '../../core/entities/Vehicle.js';
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
      //
      // avoidOccupancy: true (#954 follow-up fix): a raw spawn point can also
      // land inside a dense post-blast fragment field — still 'walkable' by
      // cell type, so the reachability check above alone would accept it
      // unmoved, but with every neighbour fragment-occupied no driver could
      // ever walk up to board it (foot travel avoids occupied cells, #954),
      // stranding the vehicle exactly as "always reachable on foot" above
      // promises it never should be. Same hazard, same fix as the employee
      // hire spawn point right above this file's own sibling in
      // employees.ts — see that call site's own comment for the live repro.
      const { x: spawnX, z: spawnZ } = state.navGrid
        ? NavGrid.findNearestReachableCell(state.navGrid, 0, 0, rawSpawnX, rawSpawnZ, true)
        : { x: rawSpawnX, z: rawSpawnZ };
      // Deducts the same `cost` the guard above tested, so the checked amount
      // and the charged amount can never drift apart.
      const { vehicle } = purchaseVehicle(state.vehicles, type, spawnX, spawnZ, tier);
      state.cash -= cost;
      addExpense(state.finances, cost, 'equipment', `Buy ${type}`, state.tickCount);
      return { success: true, output: t('vehicle.buy_success', { type, id: vehicle.id, cost }) };
    }
    // TODO(#1092): `assign task:moving` and `move` both exist only to install
    // a reposition itinerary on a vehicle's driver — the target end-state is
    // `reposition` below as the one entry point for "drive this vehicle
    // somewhere with no work attached," with these two subcommands removed
    // once callers (tutorial stages, scenario defs) migrate to it.
    case 'assign': {
      const id = parseInt(args[1] ?? '', 10);
      const task = (named['task'] ?? 'idle') as VehicleTask;
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id)) return { success: false, output: t('vehicle.assign_usage') };
      const target = state.vehicles.vehicles.find(v => v.id === id);
      if (!target) {
        return { success: false, output: t('vehicle.not_found', { id }) };
      }
      // Same rationale as `move` (#947): canTickVehicle never advances a
      // driverless vehicle, so staging task='moving' here would silently
      // no-op instead of walking. Refuse instead of accepting it quietly.
      if (task === 'moving' && target.driverId === null) {
        return { success: false, output: t('vehicle.move_no_driver', { id }) };
      }
      const targetX = toCoords.length >= 2 && !toCoords.some(isNaN) ? toCoords[0] : undefined;
      const targetZ = toCoords.length >= 2 && !toCoords.some(isNaN) ? toCoords[1] : undefined;
      // #1089: an employee is the only mobile agent — vehicle.task/targetX/Z
      // are written only for display now (Locomotion.ts's writeVehiclePosition),
      // and nothing reads them to drive movement any more. A `task:moving`
      // assign with real coordinates must install an itinerary on the
      // driver via moveTo the same way `move` below does, or the vehicle
      // (already confirmed driven, above) silently never moves — exactly
      // the #1089 fixer-pass regression `move` itself already hit. A task
      // other than 'moving', or 'moving' with no `to:` coords, stays a
      // plain display-field assignment — nothing to drive toward.
      if (task === 'moving' && targetX !== undefined && targetZ !== undefined) {
        const result = moveTo(state, target.driverId!, { x: targetX, z: targetZ });
        if (!result.success) {
          return { success: false, output: result.error };
        }
        return { success: true, output: t('vehicle.assign_success', { id, task }) };
      }
      // `target` above already confirmed a vehicle with `id` exists, and
      // nothing mutates `state.vehicles` between that lookup and here, so
      // assignVehicle cannot fail its own not-found check — its boolean
      // return is not re-checked (same reasoning as `move`'s fix, #947).
      assignVehicle(state.vehicles, id, task, targetX, targetZ);
      return { success: true, output: t('vehicle.assign_success', { id, task }) };
    }
    // TODO(#1092): superseded by `reposition` below — see the `assign` case's
    // own TODO for the target end-state.
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
      // #1089: drive the vehicle's own driver there via moveTo — the only
      // entry point that installs an itinerary Locomotion actually walks.
      // moveVehicle (Vehicle.ts) only ever wrote vehicle.task/targetX/Z,
      // which Locomotion now writes for display only (writeVehiclePosition)
      // and never reads to move anything — calling it here left the
      // vehicle sitting at its spawn point forever despite reporting
      // "moving" (confirmed live: level1-playthrough-win.json's own
      // corridor-clearing `vehicle move` steps never actually relocated the
      // blocking vehicles, silently defeating the scenario's own documented
      // deadlock workaround).
      const result = moveTo(state, target.driverId, { x: toCoords[0]!, z: toCoords[1]! });
      if (!result.success) {
        return { success: false, output: result.error };
      }
      return { success: true, output: t('vehicle.move_success', { id, x: toCoords[0]!, z: toCoords[1]! }) };
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
      return repositionVehicleCommand(ctx, args);
    }
    default:
      return { success: false, output: t('vehicle.usage') };
  }
}

// ── reposition subcommand (#1092) ──

/**
 * `vehicle reposition <id> <x> <z>` — the target end-state for driving a
 * vehicle somewhere with no work attached (Itinerary's `reposition` Goal,
 * already planned by `planItinerary`), replacing `assign task:moving` and
 * `move` above once callers migrate — see those cases' own TODOs.
 */
function repositionVehicleCommand(_ctx: GameContext, _args: string[]): CommandResult {
  // TODO: implement (#1092) — parse <id> <x> <z>, find an available driver
  // via findAvailableDriverForReposition (VehicleDriverAssignment.ts), then
  // moveTo(state, driver.id, { x, z }, { via: id }) same as `move` above.
  throw new Error('not implemented');
}
