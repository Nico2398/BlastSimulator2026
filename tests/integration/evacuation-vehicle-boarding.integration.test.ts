// BlastSimulator2026 — Integration test: Sound the Horn boards a driverless
// vehicle instead of stranding it outright (#1042).
//
// Before this fix, `clearZone` (Zone.ts) treated every driverless vehicle in
// the zone as automatically stranded, with no check for a qualified nearby
// employee. This exercises the real console/tick orchestration path — no
// mocked reachability check, no direct calls into evacuateZone/clearZone —
// so it proves the whole pipeline (zone clear -> tickEmployees ->
// tickLocomotion) actually drives a boarded vehicle clear.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { purchaseVehicle, vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../src/core/entities/Employee.js';
import { Random } from '../../src/core/math/Random.js';
import { isInZone, isZoneClear, type ZoneBounds } from '../../src/core/entities/Zone.js';
import { tickLocomotion } from '../../src/core/engine/Locomotion.js';
import { moveTo } from '../../src/core/engine/MoveTo.js';
import { createGame } from '../../src/core/state/GameState.js';
import { tickUntil, tickResolvingEvents } from './helpers.js';

describe('Evacuation vehicle boarding (#1042)', () => {
  it('boards and drives out a driverless vehicle with a qualified reachable employee, while a driverless vehicle nobody can crew stays stranded', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:60')).toMatchObject({ success: true });
    const state: GameState = ctx.state!;

    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 30, z2: 30 };

    // Vehicle A: driverless, boardable — a qualified employee stands right
    // next to it, inside the zone.
    const { vehicle: boardable } = purchaseVehicle(state.vehicles, 'rock_digger', 20, 20);
    const rng = new Random(1042);
    const { employee: boarder } = hireEmployee(state.employees, 'driller', rng, 21, 21);
    assignSkill(state.employees, boarder.id, 'driving.excavator', 1);

    // Vehicle B: driverless, and no qualified/reachable employee exists
    // anywhere in the game — must stay stranded.
    const { vehicle: strandedVehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 25, 25);

    const result = run(`zone clear x1:${zone.x1} y1:${zone.z1} x2:${zone.x2} y2:${zone.z2}`);
    expect(result).toMatchObject({ success: true });

    tickUntil(run, () => !isInZone(boardable.x, boardable.z, zone), 400);

    // Vehicle A made it out, driven by the qualified employee who boarded it.
    expect(isInZone(boardable.x, boardable.z, zone)).toBe(false);

    // Vehicle B never got a driver and never left — genuinely stranded, not
    // merely slow.
    expect(vehicleDriverId(strandedVehicle)).toBeNull();
    expect(isInZone(strandedVehicle.x, strandedVehicle.z, zone)).toBe(true);

    // The zone reads clear of everything reachable — only the genuinely
    // stranded vehicle (and nothing else) still sits inside it.
    expect(isZoneClear(zone, state.vehicles, state.employees)).toBe(false);
  });

  // #1087: boarding now resolves from an adjacent tile (Chebyshev distance
  // <= 1), not only exact cell equality — the same relaxation Mount.board
  // applies. moveTo + tickLocomotion (#1089's own boarding path) is
  // exercised directly here (rather than through the full zone-clear ->
  // pathfind -> arrive pipeline above) so the employee's arrival position
  // can be pinned to exactly one tile off the vehicle's own cell,
  // deterministically.
  it('boards a vehicle when the employee arrives one tile away (Chebyshev distance 1), not only on the vehicle\'s exact cell', () => {
    const state = createGame({ seed: 1042 });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const rng = new Random(1042);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 6, 6); // diagonal, Chebyshev distance 1

    // #1089: boarding itself now resolves inside tickLocomotion's own
    // itinerary walk (Locomotion.ts), not tickArrivalGate — moveTo builds
    // the real board leg (arrival: 'adjacent'), already satisfied here.
    const moveResult = moveTo(state, employee.id, { vehicleId: vehicle.id });
    expect(moveResult.success).toBe(true);
    tickLocomotion(state);

    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.pendingDriverVehicleId).toBeNull();
  });
});

// ── #2230: an evacuee who left the zone is not sent back in, and nobody shares a cell ─────────────────────────────

describe('Evacuation does not shuttle the crew in and out (#2230)', () => {
  const ZONE: ZoneBounds = { x1: 10, z1: 10, x2: 30, z2: 30 };
  const ZONE_COMMAND = `zone clear x1:${ZONE.x1} y1:${ZONE.z1} x2:${ZONE.x2} y2:${ZONE.z2}`;
  /** The detonation sequence re-issues its evacuation order this often (DETONATION_REEVACUATE_INTERVAL_TICKS). */
  const REEVACUATE_EVERY = 10;
  const MAX_TICKS = 800;

  interface Watch { reEntries: string[]; driverlessMoves: string[]; vehiclesOutAt: number | null }

  /** Sounds the horn, re-issues it every REEVACUATE_EVERY ticks, and watches the people who stood in the zone at the start. */
  function evacuateAndWatch(state: GameState, run: (cmd: string) => unknown, watchedIds: number[]): Watch {
    const watch: Watch = { reEntries: [], driverlessMoves: [], vehiclesOutAt: null };
    const hasLeft = new Set<number>();
    const lastPos = new Map(state.vehicles.vehicles.map(v => [v.id, { x: v.x, z: v.z, driven: vehicleDriverId(v) !== null }]));
    expect(run(ZONE_COMMAND)).toMatchObject({ success: true });
    for (let t = 1; t <= MAX_TICKS; t++) {
      if (t % REEVACUATE_EVERY === 0) run(ZONE_COMMAND);
      tickResolvingEvents(run);
      for (const id of watchedIds) {
        const emp = state.employees.employees.find(e => e.id === id)!;
        const inside = isInZone(emp.x, emp.z, ZONE);
        if (!inside) hasLeft.add(id);
        else if (hasLeft.has(id)) {
          hasLeft.delete(id);
          watch.reEntries.push(`tick ${t}: employee ${id} went back into the zone at ${emp.x.toFixed(1)},${emp.z.toFixed(1)}`);
        }
      }
      for (const v of state.vehicles.vehicles) {
        const before = lastPos.get(v.id)!;
        const driven = vehicleDriverId(v) !== null;
        if ((before.x !== v.x || before.z !== v.z) && !driven && !before.driven) {
          watch.driverlessMoves.push(`tick ${t}: vehicle ${v.id} moved with no driver`);
        }
        lastPos.set(v.id, { x: v.x, z: v.z, driven });
      }
      if (state.vehicles.vehicles.every(v => !isInZone(v.x, v.z, ZONE))) {
        watch.vehiclesOutAt = t;
        // Let the order lapse: a few more ticks show nobody is sent back after the last vehicle is out.
        for (let extra = 0; extra < 3 * REEVACUATE_EVERY; extra++) {
          if ((t + extra) % REEVACUATE_EVERY === 0) run(ZONE_COMMAND);
          tickResolvingEvents(run);
          for (const id of watchedIds) {
            const emp = state.employees.employees.find(e => e.id === id)!;
            if (isInZone(emp.x, emp.z, ZONE) && hasLeft.has(id)) watch.reEntries.push(`after the last vehicle was out: employee ${id} went back in`);
          }
        }
        break;
      }
    }
    return watch;
  }

  it('the only excavator-licensed driver takes the stranded digger out first while a second driver fetches the hauler: nobody who left goes back in', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:60')).toMatchObject({ success: true });
    const state: GameState = ctx.state!;

    const { vehicle: hauler } = purchaseVehicle(state.vehicles, 'debris_hauler', 15, 15);
    const { vehicle: digger } = purchaseVehicle(state.vehicles, 'rock_digger', 20, 20);
    // 'driver' holds the truck and excavator licences; 'blaster' the truck licence only.
    const { employee: pilot } = hireEmployee(state.employees, 'driver', new Random(2230), hauler.x, hauler.z);
    hauler.occupantIds = [pilot.id];
    pilot.locomotion = { kind: 'mounted', vehicleId: hauler.id };
    hireEmployee(state.employees, 'blaster', new Random(2231), 50, 50);

    const watch = evacuateAndWatch(state, run, [pilot.id]);

    expect(watch.vehiclesOutAt, 'both vehicles leave the zone').not.toBeNull();
    expect(isInZone(hauler.x, hauler.z, ZONE)).toBe(false);
    expect(isInZone(digger.x, digger.z, ZONE)).toBe(false);
    expect(watch.reEntries).toEqual([]);
    expect(watch.driverlessMoves).toEqual([]);
  });

  it('with a single driver licensed for both vehicles, the one who left is still sent back for the second (nobody else can rescue it)', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:60')).toMatchObject({ success: true });
    const state: GameState = ctx.state!;

    const { vehicle: hauler } = purchaseVehicle(state.vehicles, 'debris_hauler', 15, 15);
    const { vehicle: digger } = purchaseVehicle(state.vehicles, 'rock_digger', 20, 20);
    const { employee: pilot } = hireEmployee(state.employees, 'driver', new Random(2232), hauler.x, hauler.z);
    hauler.occupantIds = [pilot.id];
    pilot.locomotion = { kind: 'mounted', vehicleId: hauler.id };

    const watch = evacuateAndWatch(state, run, [pilot.id]);

    expect(watch.vehiclesOutAt, 'both vehicles leave the zone').not.toBeNull();
    expect(isInZone(hauler.x, hauler.z, ZONE)).toBe(false);
    expect(isInZone(digger.x, digger.z, ZONE)).toBe(false);
    expect(watch.driverlessMoves).toEqual([]);
  });

  it('employees leaving the zone from the same spot arrive on pairwise distinct cells', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:60')).toMatchObject({ success: true });
    const state: GameState = ctx.state!;
    const rng = new Random(2233);
    const crew = [[15, 20], [16, 20], [17, 20], [18, 20]].map(([x, z]) => hireEmployee(state.employees, 'driller', rng, x!, z!).employee);

    expect(run(ZONE_COMMAND)).toMatchObject({ success: true });
    tickUntil(run, () => crew.every(e => !isInZone(e.x, e.z, ZONE)), 400);
    // Let each one finish its walk and settle.
    for (let i = 0; i < 20; i++) tickResolvingEvents(run);

    expect(crew.every(e => !isInZone(e.x, e.z, ZONE))).toBe(true);
    const cells = crew.map(e => `${Math.round(e.x)},${Math.round(e.z)}`);
    expect(new Set(cells).size).toBe(crew.length);
  });

  it('an evacuee keeps walking to the cell it was first given: the order repeated every few ticks does not move the goal', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:60')).toMatchObject({ success: true });
    const state: GameState = ctx.state!;
    const { employee } = hireEmployee(state.employees, 'driller', new Random(2234), 12, 20);

    expect(run(ZONE_COMMAND)).toMatchObject({ success: true });
    const goal = { x: employee.destinationX, z: employee.destinationZ };
    expect(goal.x).not.toBeNull();
    for (let t = 1; t <= 40 && isInZone(employee.x, employee.z, ZONE); t++) {
      tickResolvingEvents(run);
      if (t % 3 === 0) run(ZONE_COMMAND);
      if (employee.destinationX !== null && !employee.isMoveStuck && employee.moveConsecutiveFailures === 0) {
        expect({ x: employee.destinationX, z: employee.destinationZ }, `tick ${t}`).toEqual(goal);
      }
    }
    expect(isInZone(employee.x, employee.z, ZONE)).toBe(false);
  });
});
