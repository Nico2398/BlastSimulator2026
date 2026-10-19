// BlastSimulator2026 — `vehicle buy|upgrade` tier gate on progression sites (#1928)

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { getAllVehicleRoles, type VehicleRole } from '../../../src/core/entities/Vehicle.js';

const ROLES = getAllVehicleRoles();

function sandbox(grade: number, cash = 50_000_000) {
  const { runner, ctx } = createRunner();
  const started = runner.run(`sandbox start biome:desert_badlands seed:42 grade:${grade}`);
  expect(started.success, started.output).toBe(true);
  ctx.state!.events.eventFreqMultiplier = 0;
  ctx.state!.cash = cash;
  return { runner, state: ctx.state! };
}

function snapshot(s: ReturnType<typeof sandbox>['state']) {
  return { cash: s.cash, count: s.vehicles.vehicles.length, nextId: s.vehicles.nextId };
}

describe('vehicle tier gate (#1928)', () => {
  beforeAll(() => setLocale('en'));

  it.each(ROLES)('grade 1 refuses a tier-2 %s, naming both grades, with state untouched', (role: VehicleRole) => {
    const { runner, state } = sandbox(1);
    const before = snapshot(state);
    const r = runner.run(`vehicle buy ${role} tier:2`);
    expect(r.success).toBe(false);
    expect(r.output).toContain('Hobby Quarry Licence');
    expect(r.output).toContain('Licensed Quarry');
    expect(snapshot(state)).toEqual(before);
  });

  it.each(ROLES)('grade 2 sells a tier-2 %s but refuses tier 3 naming the grade-4 class', (role: VehicleRole) => {
    const { runner, state } = sandbox(2);
    expect(runner.run(`vehicle buy ${role} tier:2`).success).toBe(true);
    const before = snapshot(state);
    const r = runner.run(`vehicle buy ${role} tier:3`);
    expect(r.success).toBe(false);
    expect(r.output).toContain('Licensed Quarry');
    expect(r.output).toContain('Strategic National Excavation');
    expect(snapshot(state)).toEqual(before);
  });

  it.each(ROLES)('grade 4 sells a tier-3 %s', (role: VehicleRole) => {
    const { runner, state } = sandbox(4);
    const before = state.vehicles.vehicles.length;
    expect(runner.run(`vehicle buy ${role} tier:3`).success).toBe(true);
    expect(state.vehicles.vehicles.length).toBe(before + 1);
  });

  it('grade 0 still sells tier 1', () => {
    const { runner } = sandbox(0);
    expect(runner.run('vehicle buy debris_hauler').success).toBe(true);
    expect(runner.run('vehicle buy debris_hauler tier:1').success).toBe(true);
  });

  it('the grade check precedes the cash check', () => {
    const { runner, state } = sandbox(1, 0);
    const r = runner.run('vehicle buy debris_hauler tier:2');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Licensed Quarry');
    expect(r.output).not.toMatch(/insufficient|funds/i);
    expect(state.cash).toBe(0);
  });

  it('upgrade to tier 2 is refused at grade 1 with tier and cash unchanged', () => {
    const { runner, state } = sandbox(1);
    runner.run('vehicle buy debris_hauler');
    const v = state.vehicles.vehicles[state.vehicles.vehicles.length - 1]!;
    const cash = state.cash;
    const r = runner.run(`vehicle upgrade ${v.id}`);
    expect(r.success).toBe(false);
    expect(r.output).toContain('Licensed Quarry');
    expect(v.tier).toBe(1);
    expect(state.cash).toBe(cash);
  });

  it('at grade 2 upgrade to tier 2 works, then tier 3 is refused until grade 4', () => {
    const { runner, state } = sandbox(2);
    runner.run('vehicle buy debris_hauler');
    const v = state.vehicles.vehicles[state.vehicles.vehicles.length - 1]!;
    expect(runner.run(`vehicle upgrade ${v.id}`).success).toBe(true);
    expect(v.tier).toBe(2);
    const cash = state.cash;
    const r = runner.run(`vehicle upgrade ${v.id}`);
    expect(r.success).toBe(false);
    expect(r.output).toContain('Strategic National Excavation');
    expect(v.tier).toBe(2);
    expect(state.cash).toBe(cash);

    state.grade!.grade = 4;
    expect(runner.run(`vehicle upgrade ${v.id}`).success).toBe(true);
    expect(v.tier).toBe(3);
  });

  it('starting-kit vehicles can be scrapped at grade 0', () => {
    const { runner, state } = sandbox(0);
    const id = state.vehicles.vehicles[0]!.id;
    expect(runner.run(`vehicle scrap ${id}`).success).toBe(true);
  });

  it('a campaign game (no grade state) buys every tier as before', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(ctx.state!.grade).toBeUndefined();
    ctx.state!.cash = 50_000_000;
    for (const tier of [1, 2, 3]) {
      expect(runner.run(`vehicle buy debris_hauler tier:${tier}`).success, `tier ${tier}`).toBe(true);
    }
  });
});
