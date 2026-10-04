// #1306 — queued-order ghost colour follows the actors, in both directions, with no tick
// needed while paused, and is right the moment an order appears.
// Drives the real console command layer (createRunner): no DOM, no Three.js.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';

function pausedGame() {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('campaign start level:tutorial_pit cash:250000')).toMatchObject({ success: true });
  const state = ctx.state!;
  state.isPaused = true;
  return { run, state, ctx };
}

const buildGhost = (state: ReturnType<typeof pausedGame>['state']) =>
  state.ghostPreviews.find(g => g.type === 'place_building')!;

describe('order reachability colours (#1306)', () => {
  it('a new building order is red with no actor and carries its building info, before any tick', () => {
    const { run, state } = pausedGame();
    state.employees.employees.length = 0;

    expect(run('build freight_warehouse at:1,8')).toMatchObject({ success: true });

    const ghost = buildGhost(state);
    expect(ghost.building).toMatchObject({ type: 'freight_warehouse', tier: 1, x: 1, z: 8 });
    expect(ghost.unreachable).toBe(true);
  });

  it('hiring while paused turns it blue; firing turns it red again, both without a tick', () => {
    const { run, state } = pausedGame();
    state.employees.employees.length = 0;
    expect(run('build freight_warehouse at:1,8')).toMatchObject({ success: true });
    expect(buildGhost(state).unreachable).toBe(true);

    expect(run('employee hire role:driller')).toMatchObject({ success: true });
    expect(buildGhost(state).unreachable).toBe(false);

    const hired = state.employees.employees[0]!;
    expect(run(`employee fire ${hired.id}`)).toMatchObject({ success: true });
    expect(buildGhost(state).unreachable).toBe(true);
    expect(state.tickCount).toBe(0);
  });

  it('a save loaded before any tick comes back with correct colours', () => {
    const { run, state, ctx } = pausedGame();
    state.employees.employees.length = 0;
    expect(run('build freight_warehouse at:1,8')).toMatchObject({ success: true });
    expect(run('save slot:t1306')).toMatchObject({ success: true });
    const loaded = createRunner();
    expect(loaded.runner.run('load slot:t1306').success).toBe(true);
    void ctx;
    const ghost = loaded.ctx.state!.ghostPreviews.find(g => g.type === 'place_building')!;
    expect(ghost.unreachable).toBe(true);
    expect(ghost.building).toBeDefined();
  });
});
