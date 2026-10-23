// BlastSimulator2026 — Integration: an armed blast names a walker who cannot move out (#1990).
// Constructed state (#1937 stops the sandbox route at drilling): an employee inside the danger zone, on a
// cell ringed by fragment debris, with the cells beyond the debris genuinely blocked (#2077: evacuation walkers now
// cross rubble and vehicle cells, so only a blocked/void ring strands). No route exists, so the
// order Zone.clearZone issues (allowUnreachable) succeeds but the walk fails every tick. The real console
// tick loop (move -> tickDetonation) must name him as stranded within the bound instead of "1 left".
//
// Approximation: the parked vehicle is modelled by the nav grid's vehicleOccupied flag on a ring of cells
// (what a parked vehicle sets on the cells it covers), not by a vehicle entity, because a vehicle entity
// inside the zone would itself be evacuated or stranded and confound the verdict under test.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { addHole } from '../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../src/core/mining/ChargePlan.js';
import { hireEmployee } from '../../src/core/entities/Employee.js';
import { Random } from '../../src/core/math/Random.js';
import {
  DETONATION_REEVACUATE_INTERVAL_TICKS, DETONATION_STUCK_WALKER_FAILURE_TICKS,
} from '../../src/core/config/balance.js';
import { armDetonation, detonationPhase } from '../../src/core/engine/DetonationSequence.js';

const SIZE = 80;
const CENTER = 20; // hole and employee; danger zone is the box (5,5)-(35,35)
const DEBRIS_RADIUS = 4;
const VEHICLE_RING = 5;

function flatNav(): NavGrid {
  const vg = new VoxelGrid(SIZE, SIZE);
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      vg.setVoxel(x, 0, z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0, oreDensities: {}, fractureModifier: 1.0,
      });
    }
  }
  return NavGrid.buildNavGrid(vg, [], []);
}

/** Debris on every cell within DEBRIS_RADIUS of the centre, a blocked ring just outside it (#2077: rubble alone no longer strands). */
function boxIn(nav: NavGrid): void {
  for (let dx = -VEHICLE_RING; dx <= VEHICLE_RING; dx++) {
    for (let dz = -VEHICLE_RING; dz <= VEHICLE_RING; dz++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      if (ring <= DEBRIS_RADIUS) nav.addFragmentOccupant(CENTER + dx, CENTER + dz);
      else nav.cellAt(CENTER + dx, CENTER + dz)!.type = 'blocked';
    }
  }
}

function boxedInArmedState() {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:80')).toMatchObject({ success: true });
  const state: GameState = ctx.state!;
  state.navGrid = flatNav();
  boxIn(state.navGrid);
  const counter = { nextHoleId: 1 };
  const hole = addHole(counter, state.drillHoles, CENTER, CENTER, 8, 0.15);
  const charge = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in charge) state.chargesByHole[hole.id] = charge.charge;
  const walker = hireEmployee(state.employees, 'surveyor', new Random(42), CENTER, CENTER).employee;
  expect(armDetonation(state).success).toBe(true);
  return { run: (cmd: string) => runner.run(cmd), state, walker };
}

describe('Detonation with a walker boxed in by debris and a blocked ring (#1990, #2077)', () => {
  it('names the boxed-in employee as stranded within the failure bound plus one re-evacuation interval', () => {
    const { run, state, walker } = boxedInArmedState();
    const budget = DETONATION_STUCK_WALKER_FAILURE_TICKS + DETONATION_REEVACUATE_INTERVAL_TICKS + 1;
    for (let i = 0; i < budget; i++) {
      expect(run('tick 1')).toMatchObject({ success: true });
    }
    expect(walker.alive).toBe(true);
    expect(Math.round(walker.x)).toBe(CENTER); // he never got out
    expect(Math.round(walker.z)).toBe(CENTER);
    // A blocked ring has no route at all: clearZone cannot order the walk, so he is named stranded outright.
    expect(detonationPhase(state)).toEqual({ kind: 'stranded', names: [walker.name] });
  });

  it('stays stranded (never silently waiting) over many more re-evacuation intervals', () => {
    const { run, state, walker } = boxedInArmedState();
    for (let i = 0; i < 6 * DETONATION_REEVACUATE_INTERVAL_TICKS; i++) run('tick 1');
    expect(detonationPhase(state)).toEqual({ kind: 'stranded', names: [walker.name] });
    expect(state.pendingDetonation!.strandedEmployeeIds).toContain(walker.id);
  });
});
