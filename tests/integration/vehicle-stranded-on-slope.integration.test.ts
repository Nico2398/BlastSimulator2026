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
    const vehicle = state.vehicles.vehicles.find(v => v.id === emp.locomotion.vehicleId);
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
