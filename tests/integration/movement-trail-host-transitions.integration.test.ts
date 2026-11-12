// BlastSimulator2026 — Integration: host transitions never relocate a movement trail (#1588)
//
// Replays the interactive tutorial scenario headlessly (command mode, the same
// engine `npm run scenarios` uses) and, after every tick batch, checks that an
// employee who boarded, alighted, entered or left a host has an unrelocated
// trail carrying one marker per transition, and that every leave was announced
// with `employee:left_building`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createGameEngine } from '../../scripts/shared/command-runner.js';
import { findWaitUntilAction } from '../../scripts/shared/command-runner.js';
import { resolveRepeatCount } from '../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { runCommand } from '../../src/console/createRunner.js';
import { serializeGameState } from '../../src/console-api.js';
import { hasLevelEnded } from '../../src/core/engine/GameOverConditions.js';
import {
  MOVEMENT_TRAIL_MAX_POINTS, isSameTrailPoint, trailArcLength, type MovementTrail, type TrailHostEvent,
} from '../../src/core/entities/MovementTrail.js';

type Tally = Record<TrailHostEvent, Map<number, number>>;
const newTally = (): Tally => ({ board: new Map(), alight: new Map(), enter: new Map(), leave: new Map() });
const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) ?? 0) + 1);

describe('movement trail host transitions over the tutorial-interactive replay (#1588)', () => {
  it('no board/alight/enter/leave relocates a trail, and every leave emits employee:left_building', () => {
    const def = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/scenario-defs/tutorial-interactive.json'), 'utf8')) as { steps: ScenarioStepDef[] };
    const engine = createGameEngine();
    const { ctx } = engine;

    let events = newTally();
    ctx.emitter.on('employee:mounted', e => bump(events.board, e.employeeId));
    ctx.emitter.on('employee:alighted', e => bump(events.alight, e.employeeId));
    ctx.emitter.on('employee:entered_building', e => bump(events.enter, e.employeeId));
    ctx.emitter.on('employee:left_building', e => bump(events.leave, e.employeeId));

    const totals: Record<TrailHostEvent, number> = { board: 0, alight: 0, enter: 0, leave: 0 };
    const problems: string[] = [];

    const checkBatch = (label: string) => {
      const state = ctx.state;
      if (!state) return;
      for (const emp of state.employees.employees) {
        const trail = emp.walkTrail;
        if (!trail) continue;
        const markers = { board: 0, alight: 0, enter: 0, leave: 0 } as Record<TrailHostEvent, number>;
        for (const m of trail.hostMarkers) markers[m.event]++;
        const transitions = (['board', 'alight', 'enter', 'leave'] as const).reduce((n, k) => n + (events[k].get(emp.id) ?? 0), 0);
        if (transitions === 0) continue;
        for (const k of ['board', 'alight', 'enter', 'leave'] as const) totals[k] += events[k].get(emp.id) ?? 0;
        if (trail.relocated) problems.push(`${label}: employee ${emp.id} trail relocated across a host transition`);
        if (trail.points.length >= MOVEMENT_TRAIL_MAX_POINTS) continue; // markers may have been trimmed
        for (const k of ['board', 'alight', 'enter', 'leave'] as const) {
          const expected = events[k].get(emp.id) ?? 0;
          if (markers[k] !== expected) problems.push(`${label}: employee ${emp.id} has ${markers[k]} '${k}' marker(s), expected ${expected}`);
        }
      }
    };

    const runTracked = (cmd: string, label: string) => {
      events = newTally();
      // Re-point the listeners' target: handlers close over `events` by variable, so reassigning is enough.
      const insideBefore = new Set(
        (ctx.state?.employees.employees ?? []).filter(e => e.locomotion.kind === 'inside').map(e => e.id),
      );
      const result = runCommand(engine, cmd);
      if (cmd.startsWith('tick')) {
        checkBatch(label);
        // A one-tick batch: whoever was inside and is not any more must have announced leaving.
        if (cmd === 'tick 1') {
          for (const emp of ctx.state?.employees.employees ?? []) {
            if (insideBefore.has(emp.id) && emp.locomotion.kind !== 'inside' && emp.alive && !events.leave.get(emp.id)) {
              problems.push(`${label}: employee ${emp.id} left a building without employee:left_building`);
            }
          }
        }
      }
      return result;
    };

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i]!;
      if (step.interactionOnly) continue;
      if (ctx.state && hasLevelEnded(ctx.state)) break;
      const wait = findWaitUntilAction(step);
      if (wait) {
        for (let n = 0; n < wait.maxTicks; n++) {
          runTracked('tick 1', `step ${i} wait tick ${n}`);
          const dump = serializeGameState(ctx) as Record<string, unknown> | null;
          if (dump && dump[wait.field] === wait.equals) break;
          if (ctx.state?.events.pendingEvent) runCommand(engine, 'event choose 0');
          if (ctx.state && hasLevelEnded(ctx.state)) break;
        }
        continue;
      }
      // A multi-tick batch is checked tick by tick: an idle worker standing in a mover's way is stepped off its route
      // (a teleport, flagged on the trail, by design), and inside one long batch that would be pinned on an unrelated
      // board/alight/enter/leave of the same batch.
      const ticks = /^tick (\d+)$/.exec(step.command);
      for (let r = 0; r < resolveRepeatCount(step); r++) {
        if (ticks) for (let n = 0; n < Number(ticks[1]); n++) runTracked('tick 1', `step ${i} (${step.command}) tick ${n}`);
        else runTracked(step.command, `step ${i} (${step.command})`);
      }
    }

    expect(problems).toEqual([]);
    // The replay must actually exercise the transitions it claims to check.
    expect(totals.board).toBeGreaterThan(0);
    expect(totals.alight).toBeGreaterThan(0);
    expect(totals.enter).toBeGreaterThan(0);
    expect(totals.leave).toBeGreaterThan(0);
  }, 280_000);
});


// ── Vehicle-side rider markers at batch sizes 1, 2, 4 and 8 (#2224) ─────────
// The simulation's timing is untouched, so what the renderer's shared timeline relies on is trail consistency:
// whenever a vehicle's driver boards or alights, the vehicle's own trail carries a rider marker naming that
// driver, and the marker's riderArc is the arc length of the rider's own trail at that transition.

interface DriverTransitions { boards: number; alights: number }

/** Arc length of `rider`'s trail up to the vehicle's position at the `nth` (0-based) vehicle-bound marker of `event`. */
function riderArcsAt(rider: MovementTrail, event: 'board' | 'alight'): number[] {
  const arcs: number[] = [];
  for (const m of rider.hostMarkers) {
    if (m.event !== event || m.hostKind !== 'vehicle') continue;
    const through = trailArcLength(rider.points.slice(0, m.pointIndex + 1));
    if (event === 'board') {
      arcs.push(through);
      continue;
    }
    // An alight hop is appended after the vehicle's final position unless the exit cell is that very cell.
    const atHost = isSameTrailPoint(rider.points[m.pointIndex]!, m.hostX, m.hostZ);
    arcs.push(atHost ? through : trailArcLength(rider.points.slice(0, m.pointIndex)));
  }
  return arcs;
}

describe.each(['tutorial-interactive', 'level1-playthrough-win', 'level2-playthrough-win'].flatMap(s => [1, 2, 4, 8].map(b => [s, b] as const)))('vehicle rider markers over the %s replay, batches of %i ticks (#2224)', (scenario, batchSize) => {
  it('every driver board/alight leaves a rider marker on the vehicle trail whose riderArc matches the rider trail', () => {
    const def = JSON.parse(readFileSync(resolve(__dirname, `../../scripts/scenario-defs/${scenario}.json`), 'utf8')) as { steps: ScenarioStepDef[] };
    const engine = createGameEngine();
    const { ctx } = engine;

    // vehicleId -> driver employee id, re-read from the state when a batch opens and kept up by the events inside it
    const driverOf = new Map<number, number>();
    const readDrivers = () => {
      driverOf.clear();
      for (const v of ctx.state?.vehicles.vehicles ?? []) if (v.occupantIds[0] !== undefined) driverOf.set(v.id, v.occupantIds[0]);
    };
    let batchEvents = new Map<number, DriverTransitions>(); // per vehicle, this batch
    const bumpDriver = (vehicleId: number, key: keyof DriverTransitions) => {
      const t = batchEvents.get(vehicleId) ?? { boards: 0, alights: 0 };
      t[key]++;
      batchEvents.set(vehicleId, t);
    };
    ctx.emitter.on('employee:mounted', e => {
      const vehicle = ctx.state?.vehicles.vehicles.find(v => v.id === e.vehicleId);
      if (vehicle && vehicle.occupantIds[0] === e.employeeId) {
        driverOf.set(e.vehicleId, e.employeeId);
        bumpDriver(e.vehicleId, 'boards');
      }
    });
    ctx.emitter.on('employee:alighted', e => {
      if (driverOf.get(e.vehicleId) === e.employeeId) {
        driverOf.delete(e.vehicleId);
        bumpDriver(e.vehicleId, 'alights');
      }
    });

    const problems: string[] = [];
    const verified = { boards: 0, alights: 0 };
    const observed = { boards: 0, alights: 0 };

    const checkBatch = (label: string) => {
      const state = ctx.state;
      if (!state) return;
      for (const vehicle of state.vehicles.vehicles) {
        const expected = batchEvents.get(vehicle.id);
        const trail = vehicle.walkTrail;
        if (!expected || !trail) continue;
        observed.boards += expected.boards;
        observed.alights += expected.alights;
        // A relocated or capped trail lost its early markers by design.
        if (trail.relocated || trail.points.length >= MOVEMENT_TRAIL_MAX_POINTS) continue;
        const withRider = trail.hostMarkers.filter(m => m.riderId !== undefined);
        const boards = withRider.filter(m => m.event === 'board');
        const alights = withRider.filter(m => m.event === 'alight');
        if (boards.length !== expected.boards) problems.push(`${label}: vehicle ${vehicle.id} has ${boards.length} rider board marker(s), expected ${expected.boards}`);
        if (alights.length !== expected.alights) problems.push(`${label}: vehicle ${vehicle.id} has ${alights.length} rider alight marker(s), expected ${expected.alights}`);
        for (const m of withRider) {
          if (typeof m.riderArc !== 'number' || !Number.isFinite(m.riderArc) || m.riderArc < 0) {
            problems.push(`${label}: vehicle ${vehicle.id} ${m.event} marker has riderArc ${String(m.riderArc)}`);
            continue;
          }
          const rider = state.employees.employees.find(e => e.id === m.riderId);
          const riderTrail = rider?.walkTrail;
          if (!rider || !riderTrail || riderTrail.relocated || riderTrail.points.length >= MOVEMENT_TRAIL_MAX_POINTS) continue;
          const arcs = riderArcsAt(riderTrail, m.event as 'board' | 'alight');
          if (!arcs.some(a => Math.abs(a - m.riderArc!) < 1e-6)) {
            problems.push(`${label}: vehicle ${vehicle.id} ${m.event} marker riderArc ${m.riderArc} matches none of the rider's trail arcs [${arcs.join(', ')}]`);
          } else if (m.event === 'board') verified.boards++;
          else verified.alights++;
        }
        // The arcs never run backwards for one rider: its first board precedes its last alight.
        const firstBoard = boards[0];
        const lastAlight = alights[alights.length - 1];
        if (firstBoard && lastAlight && firstBoard.riderId === lastAlight.riderId && firstBoard.riderArc! > lastAlight.riderArc! + 1e-6) {
          problems.push(`${label}: vehicle ${vehicle.id} rider ${firstBoard.riderId} boards at arc ${firstBoard.riderArc} after alighting at ${lastAlight.riderArc}`);
        }
      }
    };

    const runBatch = (ticks: number, label: string) => {
      batchEvents = new Map();
      readDrivers();
      runCommand(engine, `tick ${ticks}`);
      checkBatch(label);
    };
    const runTicks = (total: number, label: string) => {
      for (let left = total; left > 0; left -= batchSize) runBatch(Math.min(batchSize, left), label);
    };

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i]!;
      if (step.interactionOnly) continue;
      if (ctx.state && hasLevelEnded(ctx.state)) break;
      const wait = findWaitUntilAction(step);
      if (wait) {
        for (let n = 0; n < wait.maxTicks; n += batchSize) {
          runBatch(batchSize, `step ${i} wait batch ${n}`);
          const dump = serializeGameState(ctx) as Record<string, unknown> | null;
          if (dump && dump[wait.field] === wait.equals) break;
          if (ctx.state?.events.pendingEvent) runCommand(engine, 'event choose 0');
          if (ctx.state && hasLevelEnded(ctx.state)) break;
        }
        continue;
      }
      const ticks = /^tick (\d+)$/.exec(step.command);
      for (let r = 0; r < resolveRepeatCount(step); r++) {
        if (ticks) runTicks(Number(ticks[1]), `step ${i} (${step.command})`);
        else {
          batchEvents = new Map();
          runCommand(engine, step.command);
        }
      }
    }

    expect(problems).toEqual([]);
    // The replay must actually exercise driver boards and alights, and the markers must have been compared.
    expect(observed.boards).toBeGreaterThan(0);
    expect(observed.alights).toBeGreaterThan(0);
    expect(verified.boards).toBeGreaterThan(0);
    expect(verified.alights).toBeGreaterThan(0);
  }, 280_000);
});
