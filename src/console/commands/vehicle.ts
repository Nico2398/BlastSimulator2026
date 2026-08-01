// BlastSimulator2026 — Console vehicle command

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  purchaseVehicle,
  assignVehicle,
  moveVehicle,
  getAllVehicleRoles,
  type VehicleRole,
  type VehicleTask,
  type VehicleTier,
} from '../../core/entities/Vehicle.js';
import { requestBoardVehicle } from '../../core/entities/VehicleBoarding.js';
import { requestHaulFragment } from '../../core/economy/HaulingTask.js';
import { addExpense } from '../../core/economy/Finance.js';
import { SPAWN_RING_SIZE, SPAWN_TILE_SPACING } from '../../core/config/balance.js';
import { NavGrid } from '../../core/nav/NavGrid.js';

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
  if (!ctx.state) return { success: false, output: 'No game loaded. Use new_game first.' };
  const state = ctx.state;
  const sub = args[0] ?? 'list';

  switch (sub) {
    case 'list': {
      if (state.vehicles.vehicles.length === 0) {
        return { success: true, output: 'No vehicles.' };
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
        return { success: false, output: `Usage: vehicle buy (${getAllVehicleRoles().join('|')})` };
      }
      const tier = parseVehicleTierArg(named);
      if (tier === null) {
        return { success: false, output: 'Usage: vehicle buy <role> tier:(1|2|3)' };
      }
      // Spawn near grid centre, staggered per fleet index so newly purchased
      // vehicles land on distinct tiles instead of stacking on the depot
      // point — every prior purchase overlapped at one tile, occluding all
      // but the tallest mesh (#411).
      const baseX = state.world ? state.world.sizeX / 2 : 32;
      const baseZ = state.world ? state.world.sizeZ / 2 : 32;
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
      const { vehicle, cost } = purchaseVehicle(state.vehicles, type, spawnX, spawnZ, tier);
      state.cash -= cost;
      addExpense(state.finances, cost, 'equipment', `Buy ${type}`, state.tickCount);
      return { success: true, output: `Purchased ${type} #${vehicle.id}. Cost: $${cost}` };
    }
    case 'assign': {
      const id = parseInt(args[1] ?? '', 10);
      const task = (named['task'] ?? 'idle') as VehicleTask;
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id)) return { success: false, output: 'Usage: vehicle assign <id> task:transport from:x,z to:x,z' };
      const targetX = toCoords.length >= 2 && !toCoords.some(isNaN) ? toCoords[0] : undefined;
      const targetZ = toCoords.length >= 2 && !toCoords.some(isNaN) ? toCoords[1] : undefined;
      if (!assignVehicle(state.vehicles, id, task, targetX, targetZ)) {
        return { success: false, output: `Vehicle #${id} not found.` };
      }
      return { success: true, output: `Vehicle #${id} assigned to ${task}.` };
    }
    case 'move': {
      const id = parseInt(args[1] ?? '', 10);
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id) || toCoords.length < 2 || toCoords.some(isNaN)) {
        return { success: false, output: 'Usage: vehicle move <id> to:x,z' };
      }
      if (!moveVehicle(state.vehicles, id, toCoords[0]!, toCoords[1]!)) {
        return { success: false, output: `Vehicle #${id} not found.` };
      }
      return { success: true, output: `Vehicle #${id} moving to (${toCoords[0]},${toCoords[1]}).` };
    }
    case 'driver': {
      const vehicleId = parseInt(args[1] ?? '', 10);
      const employeeId = parseInt(args[2] ?? '', 10);
      if (isNaN(vehicleId) || isNaN(employeeId)) {
        return { success: false, output: 'Usage: vehicle driver <vehicleId> <employeeId>' };
      }
      if (!state.vehicles.vehicles.find(v => v.id === vehicleId)) {
        return { success: false, output: `Vehicle #${vehicleId} not found.` };
      }
      // Validates licence/availability now, but the employee must physically
      // walk to the vehicle before they actually become its driver — resolved
      // by ArrivalGate.tickArrivalGate once they arrive (#437).
      const result = requestBoardVehicle(state, vehicleId, employeeId);
      if (!result.success) {
        return { success: false, output: result.error! };
      }
      return { success: true, output: `Driver #${employeeId} walking to vehicle #${vehicleId} to board.` };
    }
    case 'haul': {
      const vehicleId = parseInt(args[1] ?? '', 10);
      const fragmentId = parseInt(named['fragment'] ?? '', 10);
      if (isNaN(vehicleId) || isNaN(fragmentId)) {
        return { success: false, output: 'Usage: vehicle haul <vehicleId> fragment:<fragmentId>' };
      }
      // Sets intent only — the vehicle must physically drive to the fragment
      // before loading it, then to the depot before unloading — resolved by
      // ArrivalGate.tickArrivalGate/tickHaulingProgress each tick (#437).
      const result = requestHaulFragment(state, vehicleId, fragmentId);
      if (!result.success) {
        return { success: false, output: result.error! };
      }
      return { success: true, output: `Vehicle #${vehicleId} hauling fragment #${fragmentId}.` };
    }
    default:
      return { success: false, output: 'Usage: vehicle (list|buy|assign|move|driver|haul)' };
  }
}
