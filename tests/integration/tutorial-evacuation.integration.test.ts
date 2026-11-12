// @vitest-environment jsdom
//
// BlastSimulator2026 — Integration test: the tutorial's evacuation (#2230)
//
// Human playtest of the tutorial shot: after DETONATE the crew "dithers" — somebody who already left the danger
// zone is sent back in to fetch a driverless vehicle, evacuees swap destinations while still walking, two of them
// are handed the same cell, and the zone takes far longer to empty than the walk out needs.
//
// This replays the commands of scripts/scenario-defs/tutorial-interactive.json up to the charge wait (nine charged
// holes), arms the shot with `blast detonate` and ticks one tick at a time until the shot fires, watching every
// employee and vehicle. The scenario file is read as data so the replay cannot drift from it
// (same pattern as tutorial-drill-route.integration.test.ts).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRunner } from '../../src/console/createRunner.js';
import { computeDangerZone, isInZone, type ZoneBounds } from '../../src/core/entities/Zone.js';
import { vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { canDriveTier } from '../../src/core/entities/VehicleDriverAssignment.js';
import { isMounted } from '../../src/core/entities/EmployeeLocomotion.js';
import { BLAST_DANGER_MARGIN_M } from '../../src/core/config/balance.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { Run } from '../helpers/playthrough.js';

interface ScenarioStep { command?: string }

/** The shot must fire (zone clear) in fewer ticks than this after arming; the playtest measured 89. */
const MAX_TICKS_TO_CLEAR = 89;
/** Safety cap on the watch loop: a shot that never fires fails the clear-time check instead of hanging. */
const WATCH_CAP_TICKS = 400;

interface Observation {
  /** Ticks from arming until the armed shot was consumed (fired); WATCH_CAP_TICKS when it never was. */
  ticksToClear: number;
  reEntries: string[];
  destinationChanges: string[];
  sharedDestinations: string[];
  driverlessMoves: string[];
  evacuees: number;
  /** zone.evacuatedEmployeeIds after the first tick of the evacuation, and once the shot has fired. */
  listedAfterHorn: number[];
  listedAfterFire: number[];
  /** The employees standing in the zone when the horn sounded. */
  orderedOutIds: number[];
}

/** An evacuee this close to the destination they were heading for has arrived. */
const ARRIVED_WITHIN_M = 2;

/**
 * True when `employeeId` is licensed for a driverless vehicle still in the danger zone and every other employee
 * holding that licence has also left it: nobody else could rescue the vehicle (Contract C1 exception).
 */
function isOnlyRescuerLeft(state: GameState, employeeId: number, hasLeft: ReadonlySet<number>): boolean {
  const zone = state.zone.activeZone;
  const emp = state.employees.employees.find(e => e.id === employeeId);
  if (!zone || !emp) return false;
  return state.vehicles.vehicles.some(v =>
    vehicleDriverId(v) === null && isInZone(v.x, v.z, zone) && canDriveTier(emp, v.type, v.tier)
    && state.employees.employees.every(e =>
      e.id === employeeId || !e.alive || !canDriveTier(e, v.type, v.tier) || hasLeft.has(e.id) || isMounted(e.locomotion)));
}

function cellOf(x: number, z: number): string {
  return `${Math.round(x)},${Math.round(z)}`;
}

/** The cell an employee's current itinerary ends on, or null with no itinerary. */
function finalDestination(state: GameState, employeeId: number): { x: number; z: number } | null {
  const emp = state.employees.employees.find(e => e.id === employeeId);
  const legs = emp?.itinerary?.legs;
  if (!legs || legs.length === 0) return null;
  const last = legs[legs.length - 1]!;
  return { x: last.destX, z: last.destZ };
}

function replayTutorialShot(): Observation {
  const steps = (JSON.parse(readFileSync('scripts/scenario-defs/tutorial-interactive.json', 'utf8')) as { steps: ScenarioStep[] }).steps;
  const { runner, ctx } = createRunner();
  const run: Run = (cmd) => runner.run(cmd);
  const state = () => ctx.state!;

  const tick = (n: number, done: () => boolean = () => false) => {
    for (let i = 0; i < n && !done(); i++) {
      if (state().events.pendingEvent) run('event choose 0');
      run('tick 1');
    }
  };

  // Replay up to and including the 9-charge wait; guard steps shift indices, so find it by content.
  const lastIndex = steps.findIndex(s => /^wait_until field:chargedCount equals:9\b/.test(s.command ?? ''));
  expect(lastIndex, 'charge wait step present').toBeGreaterThan(0);
  for (let i = 0; i <= lastIndex; i++) {
    const command = steps[i]!.command!;
    const wait = /^wait_until field:(\w+) equals:(\d+) max_ticks:(\d+)/.exec(command);
    if (wait) {
      const [, field, value, max] = wait;
      const read = () => field === 'holeCount' ? state().drillHoles.length
        : field === 'chargedCount' ? Object.keys(state().chargesByHole).length
          : state().buildings.buildings.length;
      tick(Number(max), () => read() === Number(value));
      continue;
    }
    if (command === 'state') continue;
    if (command.startsWith('event choose') && !state().events.pendingEvent) continue;
    const result = run(command);
    expect(result.success, `step ${i} "${command}": ${result.output}`).toBe(true);
    if (command.startsWith('survey ')) tick(90);
  }
  expect(Object.keys(state().chargesByHole).length, 'all nine holes charged').toBe(9);
  if (state().events.pendingEvent) run('event choose 0');

  // Arm the shot. The danger zone is read now: firing removes the holes it is computed from.
  const zone = computeDangerZone(state().drillHoles, BLAST_DANGER_MARGIN_M) as ZoneBounds;
  expect(zone, 'danger zone over the charged pattern').not.toBeNull();
  const arm = run('blast detonate');
  expect(arm.success, `blast detonate: ${arm.output}`).toBe(true);
  expect(state().pendingDetonation, 'shot armed').not.toBeNull();

  const obs: Observation = {
    ticksToClear: WATCH_CAP_TICKS, reEntries: [], destinationChanges: [], sharedDestinations: [], driverlessMoves: [], evacuees: 0,
    listedAfterHorn: [], listedAfterFire: [], orderedOutIds: [],
  };

  // Everyone standing in the zone when the horn sounds is ordered out by the evacuation.
  const orderedOut = new Set(state().employees.employees.filter(e => e.alive && isInZone(e.x, e.z, zone)).map(e => e.id));
  obs.evacuees = orderedOut.size;
  obs.orderedOutIds = [...orderedOut];
  const hasLeft = new Set<number>();
  const lastDest = new Map<number, { x: number; z: number }>();
  const lastVehiclePos = new Map(state().vehicles.vehicles.map(v => [v.id, { x: v.x, z: v.z }]));
  // A driver steps off in the very tick the vehicle arrives, so a move counts as driverless only when nobody sat in the
  // seat at either end of the tick.
  const hadDriver = new Map(state().vehicles.vehicles.map(v => [v.id, vehicleDriverId(v) !== null]));

  const observe = (t: number) => {
    const s = state();
    for (const emp of s.employees.employees) {
      if (!emp.alive) continue;
      const inside = isInZone(emp.x, emp.z, zone);
      if (orderedOut.has(emp.id)) {
        if (!inside) hasLeft.add(emp.id);
        else if (hasLeft.has(emp.id)) {
          // Report the walk back in once, not every tick of it.
          hasLeft.delete(emp.id);
          // Contract C1 exception: a driverless vehicle nobody else licensed for it can fetch is planned for the
          // employee who left (three vehicles, two licensed drivers in the tutorial crew).
          if (isOnlyRescuerLeft(s, emp.id, hasLeft)) continue;
          obs.reEntries.push(`tick ${t}: employee ${emp.id} re-entered the zone at ${emp.x.toFixed(1)},${emp.z.toFixed(1)}`);
        }
      }
    }
    // Destinations of everyone still in the zone, or heading out of it.
    const heading = new Map<string, number>();
    for (const emp of s.employees.employees) {
      if (!emp.alive || !orderedOut.has(emp.id)) continue;
      const dest = finalDestination(s, emp.id);
      const previous = lastDest.get(emp.id);
      if (dest !== null) {
        // An evacuee who has reached the previous destination and is sent on a new trip in the same tick has not
        // changed destination mid-journey.
        const arrived = previous !== undefined && Math.hypot(emp.x - previous.x, emp.z - previous.z) <= ARRIVED_WITHIN_M;
        if (previous && !arrived && cellOf(previous.x, previous.z) !== cellOf(dest.x, dest.z)
          && !isInZone(previous.x, previous.z, zone) && !emp.isMoveStuck && emp.moveConsecutiveFailures === 0) {
          obs.destinationChanges.push(`tick ${t}: employee ${emp.id} destination ${cellOf(previous.x, previous.z)} -> ${cellOf(dest.x, dest.z)}`);
        }
        lastDest.set(emp.id, dest);
        const key = cellOf(dest.x, dest.z);
        const other = heading.get(key);
        if (other !== undefined) obs.sharedDestinations.push(`tick ${t}: employees ${other} and ${emp.id} both head to ${key}`);
        else heading.set(key, emp.id);
      } else {
        lastDest.delete(emp.id);
      }
    }
    for (const v of s.vehicles.vehicles) {
      const before = lastVehiclePos.get(v.id);
      const driverNow = vehicleDriverId(v) !== null;
      if (before && (before.x !== v.x || before.z !== v.z) && !driverNow && hadDriver.get(v.id) === false) {
        obs.driverlessMoves.push(`tick ${t}: vehicle ${v.id} (${v.type}) moved with no driver`);
      }
      lastVehiclePos.set(v.id, { x: v.x, z: v.z });
      hadDriver.set(v.id, driverNow);
    }
  };

  for (let t = 1; t <= WATCH_CAP_TICKS; t++) {
    if (state().events.pendingEvent) run('event choose 0');
    run('tick 1');
    observe(t);
    if (t === 1) obs.listedAfterHorn = [...(state().zone.evacuatedEmployeeIds ?? [])];
    if (state().pendingDetonation === null) {
      obs.listedAfterFire = [...(state().zone.evacuatedEmployeeIds ?? [])];
      obs.ticksToClear = t;
      break;
    }
  }
  return obs;
}

describe('tutorial evacuation (#2230)', () => {
  const obs = replayTutorialShot();

  it('has somebody to evacuate: the crew stands in the danger zone when the horn sounds', () => {
    expect(obs.evacuees).toBeGreaterThan(0);
  });

  it('the evacuation lists the crew it ordered out, and the list is emptied once the shot has fired', () => {
    expect(obs.orderedOutIds.length).toBeGreaterThan(0);
    expect(obs.listedAfterHorn.length).toBeGreaterThan(0);
    expect(obs.ticksToClear).toBeLessThan(WATCH_CAP_TICKS);
    expect(obs.listedAfterFire).toEqual([]);
  });

  it('nobody who left the danger zone is sent back in', () => {
    expect(obs.reEntries).toEqual([]);
  });

  it('no evacuee changes destination while it is making progress', () => {
    expect(obs.destinationChanges).toEqual([]);
  });

  it('no two evacuees are sent to the same cell', () => {
    expect(obs.sharedDestinations).toEqual([]);
  });

  it('no vehicle moves without a driver', () => {
    expect(obs.driverlessMoves).toEqual([]);
  });

  it(`the zone empties and the shot fires in fewer than ${MAX_TICKS_TO_CLEAR} ticks after arming`, () => {
    expect(obs.ticksToClear).toBeLessThan(MAX_TICKS_TO_CLEAR);
  });
});
