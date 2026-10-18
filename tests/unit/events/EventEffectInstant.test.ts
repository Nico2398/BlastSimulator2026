import { describe, it, expect } from 'vitest';
import { applyEventEffects } from '../../../src/core/events/EventEffectCatalog.js';
import { applyInstantEffect } from '../../../src/core/events/EventEffectInstant.js';
import { generateName } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setupEvents } from '../../../src/core/events/index.js';
import { getAllEvents } from '../../../src/core/events/EventPool.js';
import { isOutOfService } from '../../../src/core/events/ActiveModifiers.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
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

  describe('employee_leaves with a stored leaver (#1908)', () => {
    const spec = { type: 'employee_leaves', pick: 'random' } as const;

    it('removes exactly the stored living employee', () => {
      const fx = makeEffectWorld();
      const target = fx.state.employees.employees[4]!;
      const out = applyInstantEffect(spec, fx.world, 0, fx.rng, target.id);
      expect(out.resultKeySuffix).toBe('');
      expect(fx.state.employees.employees.find(e => e.id === target.id)).toBeUndefined();
      expect(alive(fx)).toHaveLength(5);
    });

    it('ignores the pick rule when a leaver is given', () => {
      const fx = makeEffectWorld();
      const mgr = fx.state.employees.employees.find(e => e.role === 'manager')!;
      applyInstantEffect({ type: 'employee_leaves', pick: 'role', role: 'driller' }, fx.world, 0, fx.rng, mgr.id);
      expect(fx.state.employees.employees.some(e => e.id === mgr.id)).toBe(false);
      expect(alive(fx).filter(e => e.role === 'driller')).toHaveLength(2);
    });

    it('removes a union member', () => {
      const fx = makeEffectWorld();
      const target = fx.state.employees.employees[1]!;
      target.unionized = true;
      const out = applyInstantEffect(spec, fx.world, 0, fx.rng, target.id);
      expect(out.resultKeySuffix).toBe('');
      expect(fx.state.employees.employees.some(e => e.id === target.id)).toBe(false);
    });

    it('null leaver takes the alt branch and removes nobody', () => {
      const fx = makeEffectWorld();
      const out = applyInstantEffect(spec, fx.world, 0, fx.rng, null);
      expect(out.resultKeySuffix).toBe('_alt');
      expect(alive(fx)).toHaveLength(6);
    });

    it('a gone leaver takes the alt branch with no fresh draw', () => {
      const fx = makeEffectWorld();
      const target = fx.state.employees.employees[0]!;
      fx.state.employees.employees = fx.state.employees.employees.filter(e => e.id !== target.id);
      const out = applyInstantEffect(spec, fx.world, 0, fx.rng, target.id);
      expect(out.resultKeySuffix).toBe('_alt');
      expect(fx.state.employees.employees).toHaveLength(5);
    });

    it('a dead leaver takes the alt branch with no fresh draw', () => {
      const fx = makeEffectWorld();
      const target = fx.state.employees.employees[0]!;
      target.alive = false;
      const out = applyInstantEffect(spec, fx.world, 0, fx.rng, target.id);
      expect(out.resultKeySuffix).toBe('_alt');
      expect(alive(fx)).toHaveLength(5);
    });

    it('does not consume rng when a leaver is given', () => {
      const fx = makeEffectWorld();
      const rng = new Random(77);
      applyInstantEffect(spec, fx.world, 0, rng, fx.state.employees.employees[3]!.id);
      expect(rng.nextInt(0, 1000)).toBe(new Random(77).nextInt(0, 1000));
    });

    it('undefined leaver still draws at choice time', () => {
      const fx = makeEffectWorld();
      const out = applyInstantEffect(spec, fx.world, 0, fx.rng, undefined);
      expect(out.resultKeySuffix).toBe('');
      expect(alive(fx)).toHaveLength(5);
    });

    it('applyEventEffects threads the stored leaver to the spec', () => {
      const fx = makeEffectWorld();
      const target = fx.state.employees.employees[5]!;
      applyEventEffects([spec], fx.world, 0, fx.rng, target.id);
      expect(fx.state.employees.employees.some(e => e.id === target.id)).toBe(false);
    });

    it('applyEventEffects with a null leaver reports _alt', () => {
      const fx = makeEffectWorld();
      expect(applyEventEffects([spec], fx.world, 0, fx.rng, null).resultKeySuffix).toBe('_alt');
      expect(alive(fx)).toHaveLength(6);
    });

    it('employee_injured ignores the leaver and still draws at choice time', () => {
      const fx = makeEffectWorld();
      applyEventEffects([{ type: 'employee_injured' }], fx.world, 0, fx.rng, null);
      expect(alive(fx).filter(e => e.injured)).toHaveLength(1);
    });
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

describe('authored breakdown and closure (#1958)', () => {
  it('an authored vehicle_breakdown takes a vehicle out of service, not claimable', () => {
    const fx = makeEffectWorld();
    const v = fx.state.vehicles.vehicles[0]!;
    const out = applyEventEffects([{ type: 'vehicle_breakdown', hpLoss: 25, hours: 24 }], fx.world, 10, fx.rng);
    expect(out.resultKeySuffix).toBe('');
    expect(isOutOfService(fx.state.events.activeModifiers, 'vehicle', v.id, 10)).toBe(true);
    expect(isOutOfService(fx.state.events.activeModifiers, 'vehicle', v.id, 10 + 24)).toBe(false);
  });

  it('vehicle_breakdown with an empty fleet reports _alt and registers nothing', () => {
    const fx = makeEffectWorld({ empty: true });
    const out = applyEventEffects([{ type: 'vehicle_breakdown', hpLoss: 25, hours: 24 }], fx.world, 0, fx.rng);
    expect(out.resultKeySuffix).toBe('_alt');
    expect(fx.state.events.activeModifiers.filter(m => m.kind === 'out_of_service')).toHaveLength(0);
  });

  it('building_closed closes a building via a live out_of_service modifier', () => {
    const fx = makeEffectWorld();
    const placed = placeBuilding(fx.state.buildings, 'management_office', 10, 10, 64, 64);
    expect(placed.success).toBe(true);
    const out = applyEventEffects([{ type: 'building_closed', hours: 24 }], fx.world, 5, fx.rng);
    expect(out.resultKeySuffix).toBe('');
    const mods = fx.state.events.activeModifiers.filter(m => m.kind === 'out_of_service' && m.targetKind === 'building');
    expect(mods).toHaveLength(1);
    expect(isOutOfService(fx.state.events.activeModifiers, 'building', mods[0]!.targetId!, 5)).toBe(true);
  });

  it('building_closed with no building reports _alt', () => {
    const fx = makeEffectWorld();
    fx.state.buildings.buildings = [];
    const out = applyEventEffects([{ type: 'building_closed', hours: 24 }], fx.world, 0, fx.rng);
    expect(out.resultKeySuffix).toBe('_alt');
  });

  it('every authored vehicle_breakdown / building_closed option has res<i>_alt in en and fr', () => {
    setupEvents();
    const dir = join(import.meta.dirname, '../../../src/core/i18n/locales');
    const en = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>;
    const fr = JSON.parse(readFileSync(join(dir, 'fr.json'), 'utf8')) as Record<string, string>;
    const authored = getAllEvents().flatMap(e => e.consequences.map((c, i) => ({ e, i, c }))
      .filter(({ c }) => [c, c.altConsequence].some(b => b?.effects?.some(s => s.type === 'vehicle_breakdown' || s.type === 'building_closed'))));
    expect(authored.length).toBeGreaterThanOrEqual(3);
    const bad = authored.flatMap(({ e, i }) => [['en', en], ['fr', fr]].flatMap(([loc, d]) => {
      const v = (d as Record<string, string>)[`event.${e.id}.res${i}_alt`];
      return v === undefined || v === '' ? [`${e.id} res${i}_alt [${loc as string}] missing`] : [];
    }));
    expect(bad).toEqual([]);
  });
});
