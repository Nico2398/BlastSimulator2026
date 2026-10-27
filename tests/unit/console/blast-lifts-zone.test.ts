// BlastSimulator2026 — A fired blast lifts the zone its evacuation cleared

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { fundForDeliveryWait } from '../../helpers/playthrough.js';

const SEED = 42;

/** Sandbox site with a 3x3 pattern drilled and charged, its zone cleared, ready to fire. */
function loadedSite() {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands difficulty:normal seed:${SEED}`).success).toBe(true);
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  const refresh = () => {
    fundForDeliveryWait(state);
    for (const e of state.employees.employees) e.fatigue = 100;
  };
  refresh();
  expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:36,30').success).toBe(true);
  expect(run('charge hole:* explosive:krackle amount:4 stemming:2').success).toBe(true);
  for (let i = 0; i < 5000 && !(state.drillHoles.length === 9 && Object.keys(state.chargesByHole).length === 9); i++) {
    refresh();
    run('tick 1');
  }
  expect(Object.keys(state.chargesByHole)).toHaveLength(9);
  expect(run('zone clear x1:28 z1:22 x2:52 z2:46').success).toBe(true);
  return { run, state };
}

describe('blast lifts the spent zone', () => {
  it('leaves no zone active once the blast has fired', () => {
    const { run, state } = loadedSite();
    expect(state.zone.activeZone).not.toBeNull();
    const r = run('blast');
    expect(r.success, r.output).toBe(true);
    expect(state.zone.activeZone).toBeNull();
  });

  it('strips the evacuation holds the zone stamped, so the next zone cannot re-arm them', () => {
    const { run, state } = loadedSite();
    const held = state.pendingActions.find(a => a.type !== 'drill_hole') ?? state.pendingActions[0];
    if (held) held.payload = { ...held.payload, evacuationHold: true };
    run('blast');
    expect(state.pendingActions.filter(a => a.payload['evacuationHold'] === true)).toEqual([]);
  });

  it('keeps the zone when the blast is refused (nothing charged)', () => {
    const { run, state } = loadedSite();
    run('blast');
    expect(run('zone clear x1:28 z1:22 x2:52 z2:46').success).toBe(true);
    expect(run('blast').success).toBe(false);
    expect(state.zone.activeZone).not.toBeNull();
  });
});
