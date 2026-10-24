// BlastSimulator2026 — Integration: an employee boxed in by rubble is stranded, not walked through it (#2094).
// A rubble ring is a management problem the player solves: haul a path clear, or press Fire anyway. No
// walk crosses fragment cells, evacuation included (the #954/#1090 guard), so the armed detonation reads
// 'stranded' with the walker's name, exactly as a walker walled in by blocked or void cells does.

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
  DETONATION_REEVACUATE_INTERVAL_TICKS, DETONATION_STUCK_WALKER_FAILURE_TICKS, BLAST_DANGER_MARGIN_M,
} from '../../src/core/config/balance.js';
import { armDetonation, detonationPhase } from '../../src/core/engine/DetonationSequence.js';
import { moveTo } from '../../src/core/engine/MoveTo.js';
import { computeDangerZone, isInZone } from '../../src/core/entities/Zone.js';

const SIZE = 80;
const CENTER = 20; // hole and employee; danger zone is the box around it
const RING = 2;

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

/** Apply `mark` to every cell within Chebyshev distance `radius` of (cx, cz). */
function forDisc(cx: number, cz: number, radius: number, mark: (x: number, z: number) => void): void {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) mark(cx + dx, cz + dz);
  }
}

/** Rubble on every cell within RING of the centre except the centre itself; all else clear. */
function rubbleRing(nav: NavGrid): void {
  forDisc(CENTER, CENTER, RING, (x, z) => {
    if (x !== CENTER || z !== CENTER) nav.addFragmentOccupant(x, z);
  });
}

/** Cells within RING of the centre (except the centre) become the given impassable type. */
function wallRing(nav: NavGrid, type: 'blocked' | 'void'): void {
  forDisc(CENTER, CENTER, RING, (x, z) => {
    if (x !== CENTER || z !== CENTER) nav.cellAt(x, z)!.type = type;
  });
}

function armedState(prepare: (nav: NavGrid) => void) {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:80')).toMatchObject({ success: true });
  const state: GameState = ctx.state!;
  state.navGrid = flatNav();
  prepare(state.navGrid);
  const counter = { nextHoleId: 1 };
  const hole = addHole(counter, state.drillHoles, CENTER, CENTER, 8, 0.15);
  const charge = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in charge) state.chargesByHole[hole.id] = charge.charge;
  const walker = hireEmployee(state.employees, 'blaster', new Random(42), CENTER, CENTER).employee;
  expect(armDetonation(state).success).toBe(true);
  return { run: (cmd: string) => runner.run(cmd), state, walker };
}

describe('An employee boxed in by rubble stays inside it (#2094)', () => {
  it('never crosses the ring: the blaster stays in the zone and is named stranded', () => {
    const { run, state, walker } = armedState(rubbleRing);
    const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M)!;
    expect(isInZone(walker.x, walker.z, zone)).toBe(true); // precondition: starts inside

    const budget = DETONATION_STUCK_WALKER_FAILURE_TICKS + DETONATION_REEVACUATE_INTERVAL_TICKS + 1;
    for (let i = 0; i < budget; i++) expect(run('tick 1')).toMatchObject({ success: true });
    expect(walker.alive).toBe(true);
    expect(Math.round(walker.x)).toBe(CENTER);
    expect(Math.round(walker.z)).toBe(CENTER);
    expect(isInZone(walker.x, walker.z, zone)).toBe(true);
    expect(detonationPhase(state)).toEqual({ kind: 'stranded', names: [walker.name] });
  });
});

describe('A walker walled in by blocked or void cells is stranded too', () => {
  for (const type of ['blocked', 'void'] as const) {
    it(`names a walker walled in by ${type} cells as stranded`, () => {
      const { run, state, walker } = armedState(nav => wallRing(nav, type));
      const budget = DETONATION_STUCK_WALKER_FAILURE_TICKS + DETONATION_REEVACUATE_INTERVAL_TICKS + 1;
      for (let i = 0; i < budget; i++) run('tick 1');
      expect(Math.round(walker.x)).toBe(CENTER);
      expect(Math.round(walker.z)).toBe(CENTER);
      expect(detonationPhase(state)).toEqual({ kind: 'stranded', names: [walker.name] });
    });
  }
});

describe('moveTo keeps the fragment guard (#954/#1090, #2094)', () => {
  it('refuses a route into a rubble-boxed target', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:80')).toMatchObject({ success: true });
    const state: GameState = ctx.state!;
    state.navGrid = flatNav();
    rubbleRing(state.navGrid);
    const walker = hireEmployee(state.employees, 'blaster', new Random(42), 50, 50).employee;
    expect(moveTo(state, walker.id, { x: CENTER, z: CENTER }).success).toBe(false);
  });
});
