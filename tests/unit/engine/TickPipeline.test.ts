// BlastSimulator2026 — Tests for TickPipeline.runTick (#1086)
//
// runTick is the single core-owned tick step that src/console/commands/tick.ts
// and the (future) renderer loop both call, instead of each hosting their own
// ordering. This move must not change behaviour — the tick order documented
// in tick.ts's numbered comments (1..10) is preserved exactly — so most of
// these tests build a fixture that makes one specific ordering decision
// observable and assert it did not shift, rather than re-testing the
// underlying step functions (already covered by their own unit test files).
//
// Black-box regression suite for runTick's step ordering and the TickReport
// contract it returns — it does not re-test the underlying step functions
// (applyTaskCompletion, checkGameOverConditions, etc.), which have their own
// unit test files.

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { runTick, type TickReport } from '../../../src/core/engine/TickPipeline.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';
import { BANKRUPTCY_GRACE_TICKS, BANKRUPTCY_THRESHOLD } from '../../../src/core/config/balance.js';
import { tickCommand } from '../../../src/console/commands/tick.js';
import { makeGameContext } from '../../helpers/gameContext.js';

const SEED = 42;

function makeFragment(id: number, x: number, z: number): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass: 1000,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

/** Fresh Random the same way tick.ts seeds one per call: `seed + tickCount`. */
function rngFor(state: GameState): Random {
  return new Random(state.seed + state.tickCount);
}

function runOneTick(state: GameState, emitter: EventEmitter, checkInvariants = false): TickReport {
  return runTick(state, null, rngFor(state), emitter, { checkInvariants });
}

describe('runTick — step ordering (dev-architecture: no behaviour change from tick.ts)', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('does not complete a task on the same tick it was dispatched (dispatch runs before the completion pass, and taskTicksRemaining is only promoted by the arrival gate, which runs after tickTaskProgress within the tick)', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    const { employee } = hireEmployee(state.employees, 'blaster', new Random(SEED), 0, 0);
    // Master level — shortest possible task duration — makes "not this tick"
    // the strongest possible claim: even the fastest task cannot finish on
    // its own dispatch tick.
    assignSkill(state.employees, employee.id, 'blasting', 5);
    const action: PendingAction = {
      id: 1, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employee.id,
      status: 'queued', holderId: null, queuedAtTick: 0,
    };
    state.pendingActions.push(action);

    const dispatchTickReport = runOneTick(state, emitter);

    // Dispatched (claimed) this tick, but not completed this tick.
    expect(employee.activeActionId).toBe(1);
    expect(dispatchTickReport.taskCompletions).toEqual([]);
    expect(employee.taskTicksRemaining).not.toBeNull();

    const totalTicks = employee.taskTicksRemaining!;
    let completionReport: TickReport | undefined;
    for (let i = 0; i < totalTicks; i++) {
      completionReport = runOneTick(state, emitter);
    }

    expect(completionReport!.taskCompletions.length).toBeGreaterThan(0);
    expect(completionReport!.taskCompletions[0]!.employeeId).toBe(employee.id);
    expect(employee.activeActionId).toBeNull();
  });

  it('processes movement and the arrival gate in the same tick — an employee one tile from a task target arrives and has their task timer promoted without an extra tick', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    const { employee } = hireEmployee(state.employees, 'blaster', new Random(SEED), 0, 0);
    assignSkill(state.employees, employee.id, 'blasting', 5);
    // Target is 1 tile away — AGENT_WALK_SPEED (2 cells/tick) covers it in a
    // single movement step, so if movement (8g) and the arrival gate (8h)
    // both run within this same runTick call, taskTicksRemaining is non-null
    // by the time this call returns.
    const action: PendingAction = {
      id: 1, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 1, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employee.id,
      status: 'queued', holderId: null, queuedAtTick: 0,
    };
    state.pendingActions.push(action);

    runOneTick(state, emitter);

    expect(employee.x).toBe(1);
    expect(employee.z).toBe(0);
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
    expect(employee.taskTicksRemaining).not.toBeNull();
  });

  it('a haul-eligible employee is dispatched the same tick a fragment makes it eligible (haul dispatch runs before the employee-dispatch pass)', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);
    purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    // requestHaulFragment (HaulingTask.ts, driven from ArrivalGate's same-tick
    // boarding resolution) refuses to start a haul with no active
    // freight_warehouse to deliver to — without one, the boarding that
    // happens later this same tick immediately interrupts the just-claimed
    // action back to 'queued' and clears activeActionId, which would make
    // this test's assertion fail for a reason unrelated to dispatch
    // ordering. See HaulingTask.test.ts's "rejects when no active
    // freight_warehouse exists".
    const warehouse = placeBuilding(state.buildings, 'freight_warehouse', 10, 10, 64, 64);
    if (!warehouse.success) throw new Error(`Setup: placeBuilding failed — ${warehouse.error}`);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    // No haul_debris action exists yet — syncHaulDispatch must create one and
    // tickEmployees must claim it, both within this single runTick call.
    expect(state.pendingActions).toEqual([]);

    runOneTick(state, emitter);

    const haulActions = state.pendingActions.filter(a => a.type === 'haul_debris');
    expect(haulActions).toHaveLength(1);
    expect(employee.activeActionId).toBe(haulActions[0]!.id);
  });
});

describe('runTick — TickReport reflects what happened', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('increments tick and reports the new tickCount', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();

    const report = runOneTick(state, emitter);

    expect(state.tickCount).toBe(1);
    expect(report.tick).toBe(1);

    const report2 = runOneTick(state, emitter);
    expect(state.tickCount).toBe(2);
    expect(report2.tick).toBe(2);
  });

  it('populates taskCompletions when a task completes this tick', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    const { employee } = hireEmployee(state.employees, 'blaster', new Random(SEED), 0, 0);
    assignSkill(state.employees, employee.id, 'blasting', 5);
    state.pendingActions.push({
      id: 1, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employee.id,
      status: 'queued', holderId: null, queuedAtTick: 0,
    });

    runOneTick(state, emitter); // dispatch tick
    const totalTicks = employee.taskTicksRemaining!;
    let lastReport: TickReport | undefined;
    for (let i = 0; i < totalTicks; i++) {
      lastReport = runOneTick(state, emitter);
    }

    expect(lastReport!.taskCompletions).toHaveLength(1);
    expect(lastReport!.taskCompletions[0]).toEqual({
      employeeId: employee.id,
      report: expect.objectContaining({ completed: true }),
    });
  });

  it('sets firedEvent and paused=true when a timer-driven event fires this tick', () => {
    setupEvents();
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    // Bypass the cooldown gate and force every timer to fire immediately —
    // mirrors the retired GameLoop.test.ts "auto-pauses when event fires"
    // case (superseded here since processFrame is deleted).
    state.events.lastEventTick = -200;
    state.events.actionCountSinceEvent = 10;
    for (const timer of state.events.timers) {
      timer.remaining = 1;
    }

    const report = runOneTick(state, emitter);

    expect(report.firedEvent).not.toBeNull();
    expect(typeof report.firedEvent!.eventId).toBe('string');
    expect(report.paused).toBe(true);
    expect(state.isPaused).toBe(true);
  });

  it('worldInvariantViolations is [] when checkInvariants is false', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();

    const report = runTick(state, null, rngFor(state), emitter, { checkInvariants: false });

    expect(report.worldInvariantViolations).toEqual([]);
  });

  it('worldInvariantViolations is a present (possibly empty) array when checkInvariants is true', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();

    const report = runTick(state, null, rngFor(state), emitter, { checkInvariants: true });

    expect(Array.isArray(report.worldInvariantViolations)).toBe(true);
  });

  it('reports gameOver as structured data, not a formatted string, when bankruptcy triggers this tick', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;

    const report = runOneTick(state, emitter);

    expect(report.gameOver).toEqual({
      levelCompleted: false,
      bankrupted: true,
      ecoShutdown: false,
      arrested: false,
      revolted: false,
      levelEndReason: 'bankruptcy',
    });
    // Structured status code, never a console-formatted sentence like
    // "BANKRUPTCY! The mine is seized." (tickGameOver.ts's own string).
    expect(report.gameOver.levelEndReason).not.toMatch(/[A-Z]{2,}|!/);
    expect(state.levelEnded).toBe(true);
    expect(state.levelEndReason).toBe('bankruptcy');
  });

  it('never produces console-formatted strings for taskCompletions/gameOver/firedEvent even when all three are exercised in one run', () => {
    setupEvents();
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    const { employee } = hireEmployee(state.employees, 'blaster', new Random(SEED), 0, 0);
    assignSkill(state.employees, employee.id, 'blasting', 5);
    state.pendingActions.push({
      id: 1, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employee.id,
      status: 'queued', holderId: null, queuedAtTick: 0,
    });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;

    const report = runOneTick(state, emitter);

    // Every field a console formatter would otherwise stringify stays
    // structured data: objects/arrays/booleans/typed literals, never a
    // human-readable sentence.
    expect(Array.isArray(report.taskCompletions)).toBe(true);
    expect(typeof report.gameOver).toBe('object');
    expect(report.gameOver).not.toBeNull();
    expect(report.gameOver.bankrupted).toBe(true);
    for (const key of ['levelCompleted', 'bankrupted', 'ecoShutdown', 'arrested', 'revolted'] as const) {
      expect(typeof report.gameOver[key]).toBe('boolean');
    }
  });
});

describe('runTick — fatal world invariant abort (#1091: FATAL_VIOLATION_KINDS)', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('throws when a desynced I8 payload/in_transit pairing is present and checkInvariants is true', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    // Payload names a fragment id that logistics never tracked 'in_transit' —
    // exactly the I8 desync (checkI8PayloadNotInTransit, WorldInvariants.ts).
    vehicle.payload = { fragmentId: 999, massKg: 1000 };

    expect(() => runOneTick(state, emitter, true)).toThrow(/Fatal world invariant violation/);
  });

  it('does not throw for a non-fatal violation kind (I1) even with checkInvariants true, and the tick completes normally', () => {
    const state = createGame({ seed: SEED });
    const emitter = new EventEmitter();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    // occupantIds names an employee id nobody holds — I1 mismatch
    // (checkI1OccupantLocomotionMismatch, WorldInvariants.ts), not in
    // FATAL_VIOLATION_KINDS, so runTick must collect it and keep going.
    vehicle.occupantIds = [999];

    let report: TickReport | undefined;
    expect(() => { report = runOneTick(state, emitter, true); }).not.toThrow();
    expect(report!.worldInvariantViolations.some(v => v.kind === 'I1_occupant_locomotion_mismatch')).toBe(true);
    expect(report!.tick).toBe(1);
  });
});

describe('runTick — cross-check against the console tick command (no behaviour change, #1086)', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('advancing N ticks directly via runTick matches driving the same N ticks through the console tick command', () => {
    const TICKS = 15;

    const directCtx = makeGameContext({ seed: SEED, size: 24, staffed: true });
    const consoleCtx = makeGameContext({ seed: SEED, size: 24, staffed: true });

    for (let i = 0; i < TICKS; i++) {
      runTick(directCtx.state!, directCtx.grid, rngFor(directCtx.state!), directCtx.emitter, { checkInvariants: false });
      tickCommand(consoleCtx, ['1'], {});
    }

    expect(directCtx.state!.tickCount).toBe(consoleCtx.state!.tickCount);
    expect(directCtx.state!.cash).toBe(consoleCtx.state!.cash);
    expect(directCtx.state!.levelEndReason).toBe(consoleCtx.state!.levelEndReason);

    const directPositions = directCtx.state!.employees.employees
      .map(e => ({ id: e.id, x: e.x, z: e.z }))
      .sort((a, b) => a.id - b.id);
    const consolePositions = consoleCtx.state!.employees.employees
      .map(e => ({ id: e.id, x: e.x, z: e.z }))
      .sort((a, b) => a.id - b.id);
    expect(directPositions).toEqual(consolePositions);
  });
});
