import { describe, it, expect } from 'vitest';
import {
  addModifier, pruneExpired, remainingTicks, workRate, salaryFactor, isActive, factorFor, tickModifiers, actionBlocked,
  scaledCost, outOfServiceIds, isOutOfService,
  type ActiveModifier,
} from '../../../src/core/events/ActiveModifiers.js';
import { MODIFIER_FACTOR_MIN, MODIFIER_FACTOR_MAX, MAX_ACTIVE_MODIFIERS, TICKS_PER_DAY } from '../../../src/core/config/balance.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { mod } from '../../helpers/eventEffectWorld.js';

function listOf(...ms: Array<Parameters<typeof mod>[0]>): ActiveModifier[] {
  const list: ActiveModifier[] = [];
  let id = 1;
  for (const m of ms) addModifier(list, mod(m), id++);
  return list;
}

describe('ActiveModifiers.addModifier', () => {
  it('returns the id it used and stores the modifier', () => {
    const list: ActiveModifier[] = [];
    const id = addModifier(list, mod({ kind: 'work_stoppage' }), 7);
    expect(id).toBe(7);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(7);
  });

  it('extends endTick instead of duplicating the same kind/role/target', () => {
    const list: ActiveModifier[] = [];
    const a = addModifier(list, mod({ kind: 'blast_ban', endTick: 50 }), 1);
    const b = addModifier(list, mod({ kind: 'blast_ban', endTick: 80 }), 2);
    expect(list).toHaveLength(1);
    expect(list[0]!.endTick).toBe(80);
    expect(b).toBe(a);
  });

  it('never shortens an existing modifier when a shorter one is re-added', () => {
    const list = listOf({ kind: 'blast_ban', endTick: 80 });
    addModifier(list, mod({ kind: 'blast_ban', endTick: 30 }), 2);
    expect(list).toHaveLength(1);
    expect(list[0]!.endTick).toBe(80);
  });

  it('keeps separate entries for different roles', () => {
    const list = listOf({ kind: 'work_rate', role: 'driller', magnitude: 0.5 }, { kind: 'work_rate', role: 'driver', magnitude: 0.5 });
    expect(list).toHaveLength(2);
  });

  it('keeps separate entries for different targets', () => {
    const list = listOf({ kind: 'out_of_service', targetId: 1 }, { kind: 'out_of_service', targetId: 2 });
    expect(list).toHaveLength(2);
  });

  it('caps the ledger at MAX_ACTIVE_MODIFIERS', () => {
    const list: ActiveModifier[] = [];
    for (let i = 0; i < MAX_ACTIVE_MODIFIERS + 10; i++) {
      addModifier(list, mod({ kind: 'out_of_service', targetId: i }), i + 1);
    }
    expect(list.length).toBeLessThanOrEqual(MAX_ACTIVE_MODIFIERS);
  });
});

describe('ActiveModifiers.pruneExpired', () => {
  it('drops modifiers whose endTick has passed and keeps the rest', () => {
    const list = listOf({ kind: 'blast_ban', endTick: 10 }, { kind: 'haul_pause', endTick: 50 }, { kind: 'drill_ban', endTick: null });
    pruneExpired(list, 10);
    expect(list.map(m => m.kind).sort()).toEqual(['drill_ban', 'haul_pause']);
  });

  it('keeps permanent modifiers forever', () => {
    const list = listOf({ kind: 'salary_factor', endTick: null, magnitude: 1.1 });
    pruneExpired(list, 1_000_000);
    expect(list).toHaveLength(1);
  });

  it('is a no-op on an empty list', () => {
    const list: ActiveModifier[] = [];
    pruneExpired(list, 5);
    expect(list).toEqual([]);
  });
});

describe('ActiveModifiers.remainingTicks', () => {
  it('returns endTick minus tick', () => {
    const m = { ...mod({ kind: 'blast_ban', endTick: 60 }), id: 1 };
    expect(remainingTicks(m, 20)).toBe(40);
  });
  it('returns null for a permanent modifier', () => {
    expect(remainingTicks({ ...mod({ kind: 'salary_factor', endTick: null }), id: 1 }, 20)).toBeNull();
  });
  it('never goes below zero', () => {
    expect(remainingTicks({ ...mod({ kind: 'blast_ban', endTick: 10 }), id: 1 }, 50)).toBe(0);
  });
});

describe('ActiveModifiers.workRate', () => {
  it('is 1 with no modifiers', () => {
    expect(workRate([], 'driller', 0)).toBe(1);
  });
  it('is 0 under a work_stoppage for everyone', () => {
    const list = listOf({ kind: 'work_stoppage' });
    expect(workRate(list, 'driller', 5)).toBe(0);
    expect(workRate(list, 'manager', 5)).toBe(0);
  });
  it('a role-limited stoppage stops only that role', () => {
    const list = listOf({ kind: 'work_stoppage', role: 'driller' });
    expect(workRate(list, 'driller', 5)).toBe(0);
    expect(workRate(list, 'driver', 5)).toBe(1);
  });
  it('is the product of work_rate factors', () => {
    const list = listOf({ kind: 'work_rate', magnitude: 0.5 }, { kind: 'work_rate', role: 'driller', magnitude: 0.8 });
    expect(workRate(list, 'driller', 5)).toBeCloseTo(0.4);
    expect(workRate(list, 'driver', 5)).toBeCloseTo(0.5);
  });
  it('clamps to MODIFIER_FACTOR_MIN and MODIFIER_FACTOR_MAX', () => {
    expect(workRate(listOf({ kind: 'work_rate', magnitude: 0.0001 }), 'driller', 5)).toBe(MODIFIER_FACTOR_MIN);
    expect(workRate(listOf({ kind: 'work_rate', magnitude: 100 }), 'driller', 5)).toBe(MODIFIER_FACTOR_MAX);
  });
  it('ignores expired modifiers', () => {
    const list = listOf({ kind: 'work_stoppage', endTick: 10 });
    expect(workRate(list, 'driller', 10)).toBe(1);
  });
});

describe('ActiveModifiers.salaryFactor', () => {
  it('is 1 with none', () => { expect(salaryFactor([], 'driller')).toBe(1); });
  it('multiplies matching salary_factor modifiers, role filter honoured', () => {
    const list = listOf({ kind: 'salary_factor', magnitude: 1.2, endTick: null }, { kind: 'salary_factor', role: 'driller', magnitude: 1.5, endTick: null });
    expect(salaryFactor(list, 'driller')).toBeCloseTo(1.8);
    expect(salaryFactor(list, 'driver')).toBeCloseTo(1.2);
  });
  it('clamps extreme factors', () => {
    expect(salaryFactor(listOf({ kind: 'salary_factor', magnitude: 50, endTick: null }), 'driller')).toBe(MODIFIER_FACTOR_MAX);
  });
});

describe('ActiveModifiers.isActive / factorFor', () => {
  it('isActive true only for live modifiers of the kind', () => {
    const list = listOf({ kind: 'blast_ban', endTick: 20 });
    expect(isActive(list, 'blast_ban', 19)).toBe(true);
    expect(isActive(list, 'blast_ban', 20)).toBe(false);
    expect(isActive(list, 'haul_pause', 5)).toBe(false);
  });
  it('isActive honours the role filter', () => {
    const list = listOf({ kind: 'work_stoppage', role: 'driller' });
    expect(isActive(list, 'work_stoppage', 5, 'driller')).toBe(true);
    expect(isActive(list, 'work_stoppage', 5, 'driver')).toBe(false);
  });
  it('factorFor multiplies live magnitudes of the kind, defaults to 1', () => {
    expect(factorFor([], 'contract_price', 0)).toBe(1);
    const list = listOf({ kind: 'contract_price', magnitude: 1.2 }, { kind: 'contract_price', magnitude: 1.5, targetId: 9 });
    expect(factorFor(list, 'contract_price', 5)).toBeCloseTo(1.8);
    expect(factorFor(list, 'survey_cost', 5)).toBe(1);
  });
  it('factorFor clamps', () => {
    expect(factorFor(listOf({ kind: 'survey_cost', magnitude: 0.001 }), 'survey_cost', 1)).toBe(MODIFIER_FACTOR_MIN);
  });
});

describe('ActiveModifiers.tickModifiers', () => {
  function tickWorld(list: ReturnType<typeof makeList>) {
    return {
      tickCount: 10, cash: 1000, finances: createFinanceState(1000),
      events: { activeModifiers: list }, employees: { employees: [{ alive: true, morale: 50 }, { alive: false, morale: 50 }] },
    } as unknown as Parameters<typeof tickModifiers>[0];
  }
  function makeList() { return [] as ActiveModifier[]; }

  it('deducts a recurring charge per tick as one day share of its magnitude', () => {
    const list = makeList();
    addModifier(list, mod({ kind: 'recurring_charge', magnitude: 240, endTick: 100 }), 1);
    const world = tickWorld(list);
    tickModifiers(world);
    expect(world.cash).toBeCloseTo(1000 - 240 / TICKS_PER_DAY);
  });

  it('drifts morale of living employees only', () => {
    const list = makeList();
    addModifier(list, mod({ kind: 'morale_drift', magnitude: -2, endTick: 100 }), 1);
    const world = tickWorld(list);
    tickModifiers(world);
    expect(world.employees.employees[0]!.morale).toBe(48);
    expect(world.employees.employees[1]!.morale).toBe(50);
  });

  it('drops lapsed modifiers without applying them', () => {
    const list = makeList();
    addModifier(list, mod({ kind: 'recurring_charge', magnitude: 240, endTick: 10 }), 1);
    const world = tickWorld(list);
    tickModifiers(world);
    expect(list).toHaveLength(0);
    expect(world.cash).toBe(1000);
  });
});

describe('ActiveModifiers.actionBlocked', () => {
  it('a drill_ban blocks drill_hole but not rest or other work', () => {
    const list: ActiveModifier[] = [];
    addModifier(list, mod({ kind: 'drill_ban', endTick: 100 }), 1);
    expect(actionBlocked(list, 'drill_hole', 5, 'driller')).toBe(true);
    expect(actionBlocked(list, 'rest', 5, 'driller')).toBe(false);
    expect(actionBlocked(list, 'survey', 5, 'surveyor')).toBe(false);
  });

  it('a stoppage blocks work but never rest', () => {
    const list: ActiveModifier[] = [];
    addModifier(list, mod({ kind: 'work_stoppage', endTick: 100 }), 1);
    expect(actionBlocked(list, 'drill_hole', 5, 'driller')).toBe(true);
    expect(actionBlocked(list, 'rest', 5, 'driller')).toBe(false);
  });
});

// ── #1568: survey_cost / research_cost / out_of_service consumers ──

describe('ActiveModifiers.scaledCost (#1568)', () => {
  it('rounds base * factor to whole cash', () => {
    expect(scaledCost(100, 2)).toBe(200);
    expect(scaledCost(333, 1.5)).toBe(500); // 499.5 rounds up
    expect(scaledCost(101, 0.5)).toBe(51);
  });

  it('is the identity at factor 1', () => {
    expect(scaledCost(1234, 1)).toBe(1234);
  });

  it('is 0 for a zero base', () => {
    expect(scaledCost(0, 3)).toBe(0);
  });
});

describe('ActiveModifiers.outOfServiceIds / isOutOfService (#1568)', () => {
  const oos = (targetId: number, targetKind: 'vehicle' | 'building', endTick: number | null = 100) =>
    mod({ kind: 'out_of_service', targetId, targetKind, endTick });

  it('collects the target ids of live modifiers of the asked kind', () => {
    const list = listOf(oos(3, 'building'), oos(7, 'building'));
    expect([...outOfServiceIds(list, 'building', 10)].sort()).toEqual([3, 7]);
  });

  it('is empty without modifiers', () => {
    expect(outOfServiceIds([], 'vehicle', 0).size).toBe(0);
  });

  it('respects the kind discriminator: a building modifier never closes a vehicle with the same id', () => {
    const list = listOf(oos(5, 'building'));
    expect(outOfServiceIds(list, 'vehicle', 10).has(5)).toBe(false);
    expect(isOutOfService(list, 'vehicle', 5, 10)).toBe(false);
    expect(isOutOfService(list, 'building', 5, 10)).toBe(true);
  });

  it('respects the kind discriminator: a vehicle modifier never closes a building with the same id', () => {
    const list = listOf(oos(5, 'vehicle'));
    expect(isOutOfService(list, 'building', 5, 10)).toBe(false);
    expect(isOutOfService(list, 'vehicle', 5, 10)).toBe(true);
  });

  it('ignores a lapsed modifier (endTick <= tick)', () => {
    const list = listOf(oos(2, 'vehicle', 50));
    expect(isOutOfService(list, 'vehicle', 2, 49)).toBe(true);
    expect(isOutOfService(list, 'vehicle', 2, 50)).toBe(false);
    expect(outOfServiceIds(list, 'vehicle', 60).size).toBe(0);
  });

  it('treats a permanent (null endTick) modifier as live', () => {
    const list = listOf(oos(2, 'building', null));
    expect(isOutOfService(list, 'building', 2, 1_000_000)).toBe(true);
  });

  it('ignores other modifier kinds that carry a targetId', () => {
    const list = listOf(mod({ kind: 'work_rate', targetId: 9, targetKind: 'building' }));
    expect(isOutOfService(list, 'building', 9, 0)).toBe(false);
  });

  it('is false for an id no modifier names', () => {
    const list = listOf(oos(1, 'building'));
    expect(isOutOfService(list, 'building', 99, 0)).toBe(false);
  });
});
