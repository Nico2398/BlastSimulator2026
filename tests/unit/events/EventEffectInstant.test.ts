import { describe, it, expect } from 'vitest';
import { applyEventEffects } from '../../../src/core/events/EventEffectCatalog.js';
import { applyInstantEffect } from '../../../src/core/events/EventEffectInstant.js';
import { generateName } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { makeEffectWorld } from '../../helpers/eventEffectWorld.js';

const alive = (fx: ReturnType<typeof makeEffectWorld>) => fx.state.employees.employees.filter(e => e.alive);

describe('applyInstantEffect', () => {
  it('employee_leaves removes exactly one employee', () => {
    const fx = makeEffectWorld();
    const before = alive(fx).length;
    const out = applyInstantEffect({ type: 'employee_leaves', pick: 'random' }, fx.world, 0, fx.rng);
    expect(out.resultKeySuffix).toBe('');
    expect(fx.state.employees.employees.filter(e => e.alive).length).toBe(before - 1);
  });

  it('employee_leaves pick role removes one of that role', () => {
    const fx = makeEffectWorld();
    applyInstantEffect({ type: 'employee_leaves', pick: 'role', role: 'manager' }, fx.world, 0, fx.rng);
    expect(alive(fx).some(e => e.role === 'manager')).toBe(false);
  });

  it('employee_leaves pick junior removes the lowest-ranked employee', () => {
    const fx = makeEffectWorld();
    const before = alive(fx).length;
    const out = applyInstantEffect({ type: 'employee_leaves', pick: 'junior' }, fx.world, 0, fx.rng);
    expect(out.resultKeySuffix).toBe('');
    expect(alive(fx).length).toBe(before - 1);
  });

  it('employee_joins adds one employee of the role', () => {
    const fx = makeEffectWorld();
    const before = alive(fx).filter(e => e.role === 'driver').length;
    applyInstantEffect({ type: 'employee_joins', role: 'driver' }, fx.world, 5, fx.rng);
    expect(alive(fx).filter(e => e.role === 'driver').length).toBe(before + 1);
  });

  it('employee_joins without a role still hires one', () => {
    const fx = makeEffectWorld();
    const before = alive(fx).length;
    applyInstantEffect({ type: 'employee_joins' }, fx.world, 5, fx.rng);
    expect(alive(fx).length).toBe(before + 1);
  });

  it('employee_injured injures exactly one employee', () => {
    const fx = makeEffectWorld();
    applyInstantEffect({ type: 'employee_injured' }, fx.world, 0, fx.rng);
    expect(alive(fx).filter(e => e.injured)).toHaveLength(1);
  });

  it('fatigue_relief restores everyone to full', () => {
    const fx = makeEffectWorld();
    for (const e of fx.state.employees.employees) e.fatigue = 20;
    applyInstantEffect({ type: 'fatigue_relief' }, fx.world, 0, fx.rng);
    expect(alive(fx).every(e => e.fatigue >= 100)).toBe(true);
  });

  it('bonus_per_employee costs amount times living headcount', () => {
    const fx = makeEffectWorld();
    const n = alive(fx).length;
    const out = applyInstantEffect({ type: 'bonus_per_employee', amount: 200 }, fx.world, 0, fx.rng);
    expect(Math.abs(out.cashChange + out.cashSettled)).toBe(200 * n);
  });

  it('bonus_per_employee on an empty roster costs nothing', () => {
    const fx = makeEffectWorld({ empty: true });
    const out = applyInstantEffect({ type: 'bonus_per_employee', amount: 200 }, fx.world, 0, fx.rng);
    expect(out.cashChange + out.cashSettled).toBe(0);
  });

  it('vehicle_breakdown lowers hp of a vehicle', () => {
    const fx = makeEffectWorld();
    const v = fx.state.vehicles.vehicles[0]!;
    const hp = v.hp;
    // Asset damage is raised with its out_of_service modifier by the catalog, not the instant handler.
    applyEventEffects([{ type: 'vehicle_breakdown', hpLoss: 15, hours: 12 }], fx.world, 0, fx.rng);
    expect(v.hp).toBe(hp - 15);
  });
});

describe('employee_joins — unique names (#1886)', () => {
  it('takes a name absent from the roster and the hiring pool', () => {
    const fx = makeEffectWorld();
    const drawn = generateName(new Random(7));
    fx.state.hiringPool.candidates[0]!.name = drawn;
    applyInstantEffect({ type: 'employee_joins', role: 'driver' }, fx.world, 5, new Random(7));
    const joined = fx.state.employees.employees[fx.state.employees.employees.length - 1]!;
    expect(joined.name).not.toBe(drawn);
  });

  it('avoids the name of a living employee', () => {
    const fx = makeEffectWorld();
    const drawn = generateName(new Random(7));
    fx.state.employees.employees[0]!.name = drawn;
    applyInstantEffect({ type: 'employee_joins', role: 'driver' }, fx.world, 5, new Random(7));
    const joined = fx.state.employees.employees[fx.state.employees.employees.length - 1]!;
    expect(joined.name).not.toBe(drawn);
  });
});
