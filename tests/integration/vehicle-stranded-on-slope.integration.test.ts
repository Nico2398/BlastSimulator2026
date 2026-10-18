// BlastSimulator2026 — Integration test: a drill rig mid-hop over a sealed pit cell (#1687)
//
// Original repro (console runner, `main` at commit 2636683): `sandbox start
// biome:green_foothills difficulty:easy seed:7 staffed:true`, then a 3x3
// drill_plan. The driller boarded the rig at (2,9), drove (2,10), (2,11) and
// stopped at (2.6, 11.47); every later findPath started from the rounded cell
// and found no route, so isMoveStuck flipped on, the claim was abandoned,
// re-claimed and abandoned again, and all 9 drill_hole orders read
// target_unreachable forever.
//
// Terrain on `main` no longer produces that pit at seed 7, so the pit is
// constructed here deterministically instead: the staffed rig is driven toward
// its first hole until it is mid-hop, the mover is nudged to a position within
// the committed hop whose nearest nav cell is NOT a hop endpoint, and that cell
// is raised into a spike so every step into/out of it exceeds NAV_MAX_SLOPE_RATIO
// (the hop's own endpoints stay legal). This is the closest deterministic
// stand-in for the live terrain; it places the mover rather than reaching the
// position through natural driving.
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { findPath } from '../../src/core/nav/Pathfinding.js';
import { estimateLegDistance } from '../../src/core/engine/PlanItinerary.js';
import { playContracts, playTick, tickUntil, clearBlastZone, type Run, stockWarehouse } from '../helpers/playthrough.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';

const MAX_TICKS = 600;

function startStaffed(): { run: (cmd: string) => { success: boolean; output: string }; ctx: GameContext } {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  const started = run('sandbox start biome:green_foothills difficulty:easy seed:7 staffed:true');
  expect(started.success, started.output).toBe(true);
  return { run, ctx };
}

/** The staffed rig's current driver, once the driller has boarded and committed to a hop toward the leg destination. */
function drivingRig(state: GameState) {
  for (const emp of state.employees.employees) {
    if (emp.locomotion.kind !== 'mounted') continue;
    const { vehicleId } = emp.locomotion;
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
    if (vehicle?.type !== 'drill_rig') continue;
    if (emp.committedWaypointX == null || emp.committedOriginX == null) continue;
    if (emp.committedDestX == null || emp.committedDestZ == null) continue;
    return { emp, vehicle };
  }
  return null;
}

describe('a drill rig mid-hop over a sealed pit cell keeps drilling (#1687)', () => {
  it('drills every planned hole, never stuck, no pending order stays target_unreachable while reachable', () => {
    const { run, ctx } = startStaffed();
    const state = ctx.state!;
    const plan = run('drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:30,20');
    expect(plan.success, plan.output).toBe(true);
    const total = state.plannedDrillHoles.length + state.pendingActions.filter(a => a.type === 'drill_hole').length;
    expect(total).toBeGreaterThan(0);

    // Drive until the rig is mid-hop.
    let rig = drivingRig(state);
    for (let i = 0; i < 200 && !rig; i++) {
      run('tick 1');
      rig = drivingRig(state);
    }
    expect(rig, 'the staffed rig never started a committed drive').not.toBeNull();
    const { emp, vehicle } = rig!;
    const grid = state.navGrid!;

    // Find a position inside the committed hop whose nearest cell is not an endpoint.
    const ox = emp.committedOriginX!, oz = emp.committedOriginZ!;
    const wx = emp.committedWaypointX!, wz = emp.committedWaypointZ!;
    const segLen = Math.hypot(wx - ox, wz - oz);
    let placed: { x: number; z: number; px: number; pz: number } | null = null;
    for (const t of [0.4, 0.5, 0.6, 0.3, 0.7]) {
      for (const off of [0.45, -0.45, 0.35, -0.35]) {
        const nx = -(wz - oz) / segLen, nz = (wx - ox) / segLen;
        const x = ox + (wx - ox) * t + nx * off;
        const z = oz + (wz - oz) * t + nz * off;
        if (Math.hypot(x - ox, z - oz) >= segLen) continue;
        const px = grid.clampX(x), pz = grid.clampZ(z);
        const isEndpoint = (px === ox && pz === oz) || (px === wx && pz === wz);
        if (!isEndpoint && grid.cellAt(px, pz)) { placed = { x, z, px, pz }; break; }
      }
      if (placed) break;
    }
    expect(placed, 'no mid-hop position over a non-endpoint cell').not.toBeNull();

    // Seal the pit: raise the cell so every step in/out exceeds the slope limit.
    const pit = grid.cellAt(placed!.px, placed!.pz)!;
    pit.surfaceY = (pit.surfaceY ?? 0) + 12;
    emp.x = placed!.x; emp.z = placed!.z;
    vehicle.x = placed!.x; vehicle.z = placed!.z;

    // Fixture sanity: from the pit cell no route exists, from the hop origin one does.
    const dest = { x: emp.committedDestX!, z: emp.committedDestZ! };
    expect(findPath(grid, { agentId: emp.id, fromX: placed!.px, fromZ: placed!.pz, toX: dest.x, toZ: dest.z, avoidVehicles: false }).found).toBe(false);

    let everStuck = false;
    for (let i = 0; i < MAX_TICKS; i++) {
      run('tick 1');
      if (emp.isMoveStuck) everStuck = true;
      expectNoWorldInvariantViolations(state);
      if (state.plannedDrillHoles.length === 0 && !state.pendingActions.some(a => a.type === 'drill_hole')) break;
    }

    expect(everStuck, 'the driller went stuck over the sealed pit').toBe(false);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
    expect(state.pendingActions.some(a => a.blockedReason === 'target_unreachable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #1851: a debris hauler stopped mid-hop on a crater rim stays routable.
//
// red_canyon seed 42, #1747's standard opening. At t896 the only debris hauler
// stopped at (36.29, 42.71), mid-hop between rim cells (37,42) and (36,43); the
// planner floored that to the crater-floor corner (36,42) and found no route
// out, while the grid rounds it to (36,43). Nobody could board or drive it
// again and no ore reached the warehouse.
// ---------------------------------------------------------------------------

const REPRO_START_TICK = 846;
const REPRO_END_TICK = 1100;
/** Tick the hauler used to strand at on the buggy build. */
const STRANDED_AT_TICK = 896;
/** Planner targets probed from the hauler: the depot leg and a point near its stop. */
const PROBE_TARGETS = [{ x: 7, z: 19 }, { x: 30, z: 43 }, { x: 36, z: 46 }];

/** #1747's standard opening on red_canyon: orders are given, the opening crew drills and charges, the zone is cleared, the blast fires. */
function playRedCanyonOpening(): { run: Run; ctx: GameContext } {
  const { runner, ctx } = createRunner();
  const run: Run = (cmd: string) => runner.run(cmd);
  const state = (): GameState => ctx.state!;
  const ok = (cmd: string) => {
    const res = run(cmd);
    expect(res.success, `${cmd}: ${res.output}`).toBe(true);
  };
  ok('sandbox start biome:red_canyon difficulty:easy seed:42');
  ok('weather set sunny');
  ok('time resume');
  ok('build living_quarters at:30,48');
  ok('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:36,32');
  tickUntil(run, state(), 800, () => state().plannedDrillHoles.length === 0);
  expect(stockWarehouse(run, state(), 'krackle', 72).success).toBe(true); // stock-covered: no delivery wait (#1895)
  ok('charge hole:* explosive:krackle amount:8 stemming:2.5');
  tickUntil(run, state(), EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state().plannedChargesByHole).length === 0);
  clearBlastZone(run, state());
  ok('blast detonate');
  ok('build_ramp start:40,12 end:40,31 depth:8');
  return { run, ctx };
}

function storedOreKg(state: GameState): number {
  return state.logistics.storedMassKg + Object.values(state.collectedOre).reduce((a, b) => a + b, 0);
}

describe('a debris hauler stopped mid-hop on a crater rim stays routable (#1851)', () => {
  it('red_canyon seed 42: no hauler is routable from its rounded cell yet stranded at its raw position, and ore keeps arriving after t896', () => {
    const { run, ctx } = playRedCanyonOpening();
    const state = ctx.state!;
    const grid = state.navGrid!;

    // Ordinary play up to the point the repro was traced from.
    while (state.tickCount < REPRO_START_TICK && state.tickCount < REPRO_END_TICK) {
      playTick(run, state);
      playContracts(run, state);
    }

    let inflowAfterStrand = 0;
    let lastStored = storedOreKg(state);
    const strandedProbes: string[] = [];
    let probedHaulers = 0;

    while (state.tickCount < REPRO_END_TICK) {
      playTick(run, state);
      playContracts(run, state);
      expectNoWorldInvariantViolations(state);

      const stored = storedOreKg(state);
      if (state.tickCount > STRANDED_AT_TICK && stored > lastStored) inflowAfterStrand += stored - lastStored;
      lastStored = stored;

      for (const vehicle of state.vehicles.vehicles) {
        if (vehicle.type !== 'debris_hauler') continue;
        probedHaulers++;
        const cx = grid.clampX(vehicle.x), cz = grid.clampZ(vehicle.z);
        for (const target of PROBE_TARGETS) {
          const fromRounded = estimateLegDistance(state, 'exact', vehicle.id, cx, cz, target.x, target.z, false);
          if (fromRounded === null) continue; // its rounded cell has no route either: not this bug
          const fromRaw = estimateLegDistance(state, 'exact', vehicle.id, vehicle.x, vehicle.z, target.x, target.z, false);
          if (fromRaw === null) {
            strandedProbes.push(`t${state.tickCount} hauler #${vehicle.id} at (${vehicle.x}, ${vehicle.z}) -> (${target.x},${target.z})`);
          }
        }
      }
    }

    expect(probedHaulers, 'the opening never produced a debris hauler to probe').toBeGreaterThan(0);
    expect(strandedProbes.slice(0, 5), `${strandedProbes.length} probes from positions the planner cannot route from although their rounded cell can (first 5 shown)`).toEqual([]);
    expect(inflowAfterStrand, `ore/warehouse stock gained after t${STRANDED_AT_TICK}`).toBeGreaterThan(0);
  }, 300_000);
});
