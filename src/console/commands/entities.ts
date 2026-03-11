// BlastSimulator2026 — Console commands for entities (Phase 5)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  placeBuilding,
  destroyBuilding,
  moveBuilding,
  getAllBuildingTypes,
  getBuildingDef,
  type BuildingType,
} from '../../core/entities/Building.js';
import {
  purchaseVehicle,
  assignVehicle,
  moveVehicle,
  getAllVehicleTypes,
  type VehicleType,
  type VehicleTask,
} from '../../core/entities/Vehicle.js';
import {
  hireEmployee,
  giveRaise,
  fireEmployee,
  type EmployeeRole,
} from '../../core/entities/Employee.js';
import { addExpense } from '../../core/economy/Finance.js';
import { Random } from '../../core/math/Random.js';
import { defineZone, clearZone, isZoneClear, type ZoneBounds } from '../../core/entities/Zone.js';

function requireGame(ctx: GameContext): CommandResult | null {
  if (!ctx.state) return { success: false, output: 'No game loaded. Use new_game first.' };
  return null;
}

const GRID_SIZE = 64;

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
        const def = getBuildingDef(b.type);
        lines.push(`  [${b.id}] ${b.type} at (${b.x},${b.z}) HP: ${b.hp}/${def.maxHp}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    case 'destroy': {
      const id = parseInt(args[1] ?? '', 10);
      if (isNaN(id)) return { success: false, output: 'Usage: build destroy <id>' };
      if (!destroyBuilding(state.buildings, id)) {
        return { success: false, output: `Building #${id} not found.` };
      }
      return { success: true, output: `Building #${id} destroyed.` };
    }
    case 'move': {
      const id = parseInt(args[1] ?? '', 10);
      const toCoords = (named['to'] ?? '').split(',').map(Number);
      if (isNaN(id) || toCoords.length < 2 || toCoords.some(isNaN)) {
        return { success: false, output: 'Usage: build move <id> to:x,z' };
      }
      const result = moveBuilding(state.buildings, id, toCoords[0]!, toCoords[1]!, GRID_SIZE, GRID_SIZE);
      if (!result.success) return { success: false, output: result.error! };
      addExpense(state.finances, result.cost!, 'construction', `Relocate building #${id}`, state.tickCount);
      return { success: true, output: `Building #${id} moved. Cost: $${result.cost}` };
    }
    case 'types': {
      const lines = ['Building types:'];
      for (const type of getAllBuildingTypes()) {
        const def = getBuildingDef(type);
        lines.push(`  ${type} — $${def.constructionCost} | ${def.sizeX}x${def.sizeZ} | HP: ${def.maxHp}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    default: {
      // Try to place: build <type> at:x,z
      const type = sub as BuildingType;
      if (!getAllBuildingTypes().includes(type)) {
        return { success: false, output: `Unknown subcommand or building type: "${sub}". Use: build (list|destroy|move|types|<type> at:x,z)` };
      }
      const atCoords = (named['at'] ?? '').split(',').map(Number);
      if (atCoords.length < 2 || atCoords.some(isNaN)) {
        return { success: false, output: `Usage: build ${type} at:x,z` };
      }
      const result = placeBuilding(state.buildings, type, atCoords[0]!, atCoords[1]!, GRID_SIZE, GRID_SIZE);
      if (!result.success) return { success: false, output: result.error! };
      addExpense(state.finances, result.cost!, 'construction', `Build ${type}`, state.tickCount);
      return { success: true, output: `Built ${type} #${result.building!.id} at (${atCoords[0]},${atCoords[1]}). Cost: $${result.cost}` };
    }
  }
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
        return { success: true, output: 'No vehicles.' };
      }
      const lines = ['Fleet:'];
      for (const v of state.vehicles.vehicles) {
        lines.push(`  [${v.id}] ${v.type} at (${v.x},${v.z}) task: ${v.task} HP: ${v.hp}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    case 'buy': {
      const type = (args[1] ?? '') as VehicleType;
      if (!getAllVehicleTypes().includes(type)) {
        return { success: false, output: `Usage: vehicle buy (${getAllVehicleTypes().join('|')})` };
      }
      const { vehicle, cost } = purchaseVehicle(state.vehicles, type);
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
    default:
      return { success: false, output: 'Usage: vehicle (list|buy|assign|move)' };
  }
}

// ── employee command ──

export function employeeCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'list';
  const rng = new Random(state.seed + state.tickCount);

  switch (sub) {
    case 'list': {
      if (state.employees.employees.length === 0) {
        return { success: true, output: 'No employees.' };
      }
      const lines = ['Employees:'];
      for (const e of state.employees.employees) {
        const status = !e.alive ? 'DEAD' : e.injured ? 'INJURED' : 'OK';
        const union = e.unionized ? ' [UNION]' : '';
        lines.push(`  [${e.id}] ${e.name} (${e.role}) $${e.salary}/cycle morale:${e.morale} ${status}${union}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    case 'hire': {
      const role = (named['role'] ?? '') as EmployeeRole;
      const validRoles: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
      if (!validRoles.includes(role)) {
        return { success: false, output: `Usage: employee hire role:(${validRoles.join('|')})` };
      }
      const { employee, hiringCost } = hireEmployee(state.employees, role, rng);
      addExpense(state.finances, hiringCost, 'salaries', `Hire ${role}: ${employee.name}`, state.tickCount);
      return { success: true, output: `Hired ${employee.name} (${role}). Cost: $${hiringCost}` };
    }
    case 'raise': {
      const id = parseInt(args[1] ?? '', 10);
      const amount = parseFloat(named['amount'] ?? '0');
      if (isNaN(id) || amount <= 0) {
        return { success: false, output: 'Usage: employee raise <id> amount:500' };
      }
      if (!giveRaise(state.employees, id, amount)) {
        return { success: false, output: `Employee #${id} not found.` };
      }
      return { success: true, output: `Raise of $${amount} given to employee #${id}.` };
    }
    case 'fire': {
      const id = parseInt(args[1] ?? '', 10);
      if (isNaN(id)) return { success: false, output: 'Usage: employee fire <id>' };
      const result = fireEmployee(state.employees, id);
      if (!result.success) return { success: false, output: result.error! };
      return { success: true, output: `Employee #${id} fired.` };
    }
    default:
      return { success: false, output: 'Usage: employee (list|hire|raise|fire)' };
  }
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
