// BlastSimulator2026 — Integration tests: per-plan hole diameter (#1934)
//
// `drill_plan grid|add … diameter:<mm>` picks 89 / 127 / 165 mm. A diameter
// needs a rig that can bore it (tier 1 / 2 / 3), the way depth does, and the
// hole's diameter scales its charge capacity.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';

function staffedGame() {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  // Tier-2 / tier-3 rigs cost more than the starting cash.
  ctx.state!.cash = 1_000_000;
  return { run, state: ctx.state! };
}

describe('drill_plan diameter option (#1934)', () => {
  it('refuses a 127 mm grid on a tier-1 fleet and leaves the plan untouched', () => {
    const { run, state } = staffedGame();
    const result = run('drill_plan grid rows:1 cols:2 spacing:4 depth:8 diameter:127 start:14,14');
    expect(result.success).toBe(false);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
  });

  it('refuses drill_plan add at 127 mm on a tier-1 fleet', () => {
    const { run, state } = staffedGame();
    expect(run('drill_plan add x:14 z:14 depth:8 diameter:127').success).toBe(false);
    expect(state.plannedDrillHoles).toHaveLength(0);
  });

  it('accepts a 127 mm grid once a tier-2 rig is owned, storing diameter 0.127 on every hole', () => {
    const { run, state } = staffedGame();
    expect(run('vehicle buy drill_rig tier:2').success).toBe(true);
    const result = run('drill_plan grid rows:1 cols:2 spacing:4 depth:8 diameter:127 start:14,14');
    expect(result.success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(2);
    for (const h of state.plannedDrillHoles) expect(h.diameter).toBeCloseTo(0.127, 9);
  });

  it('queued drill_hole actions carry the diameter so reservation can pick a capable rig', () => {
    const { run, state } = staffedGame();
    run('vehicle buy drill_rig tier:2');
    run('drill_plan add x:14 z:14 depth:8 diameter:127');
    const action = state.pendingActions.find(a => a.type === 'drill_hole')!;
    expect(action.payload['diameter']).toBeCloseTo(0.127, 9);
  });

  it('165 mm still needs a tier-3 rig with a tier-2 rig owned', () => {
    const { run } = staffedGame();
    run('vehicle buy drill_rig tier:2');
    expect(run('drill_plan add x:14 z:14 depth:8 diameter:165').success).toBe(false);
    run('vehicle buy drill_rig tier:3');
    expect(run('drill_plan add x:14 z:14 depth:8 diameter:165').success).toBe(true);
  });

  it('accepts the metre spelling diameter:0.089 on a tier-1 fleet', () => {
    const { run, state } = staffedGame();
    expect(run('drill_plan add x:14 z:14 depth:8 diameter:0.089').success).toBe(true);
    expect(state.plannedDrillHoles[0]!.diameter).toBeCloseTo(0.089, 9);
  });

  it('no diameter option keeps the 89 mm default', () => {
    const { run, state } = staffedGame();
    expect(run('drill_plan add x:14 z:14 depth:8').success).toBe(true);
    expect(state.plannedDrillHoles[0]!.diameter).toBeCloseTo(0.089, 9);
  });

  it('refuses a diameter that is not one of the options, even with a tier-3 rig', () => {
    const { run, state } = staffedGame();
    run('vehicle buy drill_rig tier:3');
    expect(run('drill_plan add x:14 z:14 depth:8 diameter:100').success).toBe(false);
    expect(run('drill_plan grid rows:1 cols:1 spacing:4 depth:8 diameter:100 start:20,20').success).toBe(false);
    expect(run('drill_plan add x:14 z:14 depth:8 diameter:0').success).toBe(false);
    expect(run('drill_plan add x:14 z:14 depth:8 diameter:-89').success).toBe(false);
    expect(state.plannedDrillHoles).toHaveLength(0);
  });
});

describe('charge capacity follows the drilled hole diameter (#1934)', () => {
  function withDrilledHole(diameter: number) {
    const { run, state } = staffedGame();
    state.drillHoles.push({ id: 'H1', x: 14, z: 14, depth: 8, diameter });
    return { run, state };
  }

  it('refuses a 16 kg load in an 8 m, 89 mm hole', () => {
    const { run } = withDrilledHole(0.089);
    expect(run('charge hole:H1 explosive:boomite amount:16 stemming:2').success).toBe(false);
  });

  it('accepts a 16 kg load in an 8 m, 127 mm hole', () => {
    const { run } = withDrilledHole(0.127);
    expect(run('charge hole:H1 explosive:boomite amount:16 stemming:2').success).toBe(true);
  });
});
