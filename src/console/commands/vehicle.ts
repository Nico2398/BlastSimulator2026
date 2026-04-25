// BlastSimulator2026 — Console vehicle command

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  purchaseVehicle,
  assignVehicle,
  assignDriver,
  moveVehicle,
  getAllVehicleRoles,
  type VehicleRole,
  type VehicleTask,
} from '../../core/entities/Vehicle.js';
import { addExpense } from '../../core/economy/Finance.js';

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
      // Spawn near grid centre so vehicles are visible from default camera
      const spawnX = state.world ? state.world.sizeX / 2 : 32;
      const spawnZ = state.world ? state.world.sizeZ / 2 : 32;
      const { vehicle, cost } = purchaseVehicle(state.vehicles, type, spawnX, spawnZ);
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
      const result = assignDriver(state.vehicles, state.employees, vehicleId, employeeId);
      if (!result.success) {
        return { success: false, output: result.error! };
      }
      return { success: true, output: `Driver #${employeeId} assigned to vehicle #${vehicleId}.` };
    }
    default:
      return { success: false, output: 'Usage: vehicle (list|buy|assign|move|driver)' };
  }
}
