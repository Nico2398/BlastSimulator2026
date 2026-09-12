// BlastSimulator2026 — Integration test: Sound the Horn boards a driverless
// vehicle instead of stranding it outright (#1042).
//
// Before this fix, `clearZone` (Zone.ts) treated every driverless vehicle in
// the zone as automatically stranded, with no check for a qualified nearby
// employee. This exercises the real console/tick orchestration path — no
// mocked reachability check, no direct calls into evacuateZone/clearZone —
// so it proves the whole pipeline (zone clear -> tickEmployees ->
// tickArrivalGate -> tickVehicle) actually drives a boarded vehicle clear.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../src/core/entities/Employee.js';
import { Random } from '../../src/core/math/Random.js';
import { isInZone, isZoneClear, type ZoneBounds } from '../../src/core/entities/Zone.js';
import { tickUntil } from './helpers.js';

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
    expect(strandedVehicle.driverId).toBeNull();
    expect(isInZone(strandedVehicle.x, strandedVehicle.z, zone)).toBe(true);

    // The zone reads clear of everything reachable — only the genuinely
    // stranded vehicle (and nothing else) still sits inside it.
    expect(isZoneClear(zone, state.vehicles, state.employees)).toBe(false);
  });
});
