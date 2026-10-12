// BlastSimulator2026 — Fixtures for the game audio director tests
// A director environment built on the shared recording player and a manual clock,
// and builders that make a real GameState and put entities into it.

import type { Listener, WorldPoint } from '../../../../src/audio/AudioPlayer.js';
import type { BlastInfo } from '../../../../src/audio/director/blastPlan.js';
import { createDirectorEnv } from '../../../../src/audio/director/env.js';
import type { DirectorEnv, EntityPositionFn } from '../../../../src/audio/director/types.js';
import type { ActionType, GameState, PendingAction, PendingActionStatus } from '../../../../src/core/state/GameState.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { hireEmployee, type Employee, type EmployeeRole } from '../../../../src/core/entities/Employee.js';
import { purchaseVehicle, type Vehicle, type VehicleRole } from '../../../../src/core/entities/Vehicle.js';
import type { Building, BuildingType } from '../../../../src/core/entities/Building.js';
import { Random } from '../../../../src/core/math/Random.js';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';

/** A fragment that drops onto `to` from a few metres up: it visibly moves, so the blast's rain counts it. */
export function fallingTo(to: WorldPoint, timing: { delayS: number; durationS: number; impactSpeed: number }): BlastInfo['flights'][number] {
  return { ...timing, from: { x: to.x, y: 4, z: to.z }, to: { x: to.x, y: 0, z: to.z } };
}

export function listenerAt(x: number, z: number, viewDistance = 40): Listener {
  return { x, z, rightX: 1, rightZ: 0, viewDistance };
}

export interface Harness {
  readonly player: RecordingPlayer;
  readonly random: Random;
  readonly clock: { nowS: number };
  readonly env: DirectorEnv;
  /** Replace the listener the environment reports. */
  setListener(listener: Listener | null): void;
  setState(state: GameState | null): void;
  advance(seconds: number): void;
}

/** A director environment on a recording player and a clock the test advances. */
export function makeHarness(options: { listener?: Listener | null; state?: GameState | null; entityPosition?: EntityPositionFn; seed?: number } = {}): Harness {
  const player = new RecordingPlayer();
  const clock = { nowS: 0 };
  player.now = () => clock.nowS;
  let listener: Listener | null = options.listener === undefined ? listenerAt(0, 0) : options.listener;
  let state: GameState | null = options.state ?? null;
  const random = new Random(options.seed ?? 42);
  const env = createDirectorEnv({
    player,
    random,
    now: () => clock.nowS,
    listener: () => listener,
    state: () => state,
    entityPosition: options.entityPosition,
  });
  return {
    player,
    random,
    clock,
    env,
    setListener: next => { listener = next; },
    setState: next => { state = next; },
    advance: seconds => { clock.nowS += seconds; },
  };
}

export function makeState(): GameState {
  return createGame({ seed: 7 });
}

export function addEmployee(state: GameState, x: number, z: number, role: EmployeeRole = 'driller'): Employee {
  return hireEmployee(state.employees, role, new Random(3), x, z).employee;
}

/** Put an employee to work on an action of this type. */
export function startWorking(employee: Employee, type: ActionType, ticks = 10): void {
  employee.taskTicksRemaining = ticks;
  employee.activeTaskTotalTicks = ticks;
  employee.pendingActionType = type;
}

export function addVehicle(state: GameState, role: VehicleRole, x: number, z: number): Vehicle {
  return purchaseVehicle(state.vehicles, role, x, z).vehicle;
}

/** Seat an employee in a vehicle, as the mount code leaves them. */
export function mount(state: GameState, employee: Employee, vehicle: Vehicle): void {
  vehicle.occupantIds.push(employee.id);
  employee.x = vehicle.x;
  employee.z = vehicle.z;
  void state;
}

export function addBuilding(state: GameState, type: BuildingType, x: number, z: number): Building {
  const building: Building = { id: state.buildings.nextId++, type, tier: 1, x, z, hp: 100, active: true, occupantIds: [] };
  state.buildings.buildings.push(building);
  return building;
}

export function addAction(state: GameState, type: ActionType, status: PendingActionStatus = 'in_progress', holderId: number | null = null): PendingAction {
  const action: PendingAction = {
    id: state.nextPendingActionId++,
    type,
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0,
    targetZ: 0,
    targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status,
    holderId,
    queuedAtTick: state.tickCount,
  };
  state.pendingActions.push(action);
  return action;
}

export function removeAction(state: GameState, id: number): void {
  state.pendingActions = state.pendingActions.filter(a => a.id !== id);
}

export function advanceTicks(state: GameState, ticks: number): void {
  state.tickCount += ticks;
}
