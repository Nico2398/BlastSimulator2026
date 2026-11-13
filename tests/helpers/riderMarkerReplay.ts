// BlastSimulator2026 — shared replay for the rider-marker integration tests (#2224)
// Replays a scenario headlessly at a given tick batch size and checks the vehicle-side rider markers.

import { expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createGameEngine, findWaitUntilAction } from '../../scripts/shared/command-runner.js';
import { resolveRepeatCount } from '../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { runCommand } from '../../src/console/createRunner.js';
import { serializeGameState } from '../../src/console-api.js';
import { hasLevelEnded } from '../../src/core/engine/GameOverConditions.js';
import {
  MOVEMENT_TRAIL_MAX_POINTS, isSameTrailPoint, trailArcLength, type MovementTrail,
} from '../../src/core/entities/MovementTrail.js';

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
    // A rider whose trail tail was not at the vehicle (the vehicle was placed, not driven) gains the jump to it.
    arcs.push(trailArcLength(rider.points.slice(0, m.pointIndex)));
    if (atHost) arcs.push(through);
  }
  return arcs;
}

export function replayRiderMarkers(scenario: string, batchSize: number): void {
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
        // The arcs never run backwards for one rider, in the order the transitions happened.
        const lastArc = new Map<number, number>();
        for (const m of withRider) {
          const before = lastArc.get(m.riderId!);
          if (before !== undefined && m.riderArc! < before - 1e-6) {
            problems.push(`${label}: vehicle ${vehicle.id} rider ${m.riderId} ${m.event} at arc ${m.riderArc} after arc ${before}`);
          }
          lastArc.set(m.riderId!, m.riderArc!);
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
}

