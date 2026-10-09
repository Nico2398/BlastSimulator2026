// BlastSimulator2026 — Hiring candidate pools (#1385)

import { describe, it, expect } from 'vitest';
import {
  createHiringPool,
  generateCandidate,
  refreshHiringPool,
  candidatesForRole,
  takeCandidate,
  isHiringPoolDue,
  type HiringPoolState,
} from '../../../src/core/entities/HiringPool.js';
import {
  hireEmployee,
  createEmployeeState,
  calculateSalary,
  type EmployeeRole,
} from '../../../src/core/entities/Employee.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { HIRING_POOL_SIZE, HIRING_POOL_REFRESH_INTERVAL, ROLE_STARTING_QUALIFICATIONS } from '../../../src/core/config/balance.js';

const ROLES: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];

function hireFrom(role: EmployeeRole, c: ReturnType<typeof generateCandidate>, seed = 1) {
  const es = createEmployeeState();
  return hireEmployee(es, role, new Random(seed), 0, 0, 0, c).employee;
}

describe('createHiringPool', () => {
  it('offers HIRING_POOL_SIZE (3) candidates for every role', () => {
    const pool = createHiringPool(42, 0);
    expect(HIRING_POOL_SIZE).toBe(3);
    for (const role of ROLES) expect(candidatesForRole(pool, role)).toHaveLength(HIRING_POOL_SIZE);
    expect(pool.candidates).toHaveLength(HIRING_POOL_SIZE * ROLES.length);
  });

  it('gives every candidate a unique id and a matching role', () => {
    const pool = createHiringPool(42, 0);
    const ids = pool.candidates.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const role of ROLES) for (const c of candidatesForRole(pool, role)) expect(c.role).toBe(role);
  });

  it('nextCandidateId is past every issued id and lastRefreshTick is the creation tick', () => {
    const pool = createHiringPool(42, 17);
    expect(pool.lastRefreshTick).toBe(17);
    for (const c of pool.candidates) expect(pool.nextCandidateId).toBeGreaterThan(c.id);
  });

  it('every candidate has a non-empty name, boolean union flag, qualifications, positive salary', () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      for (const c of createHiringPool(seed, 0).candidates) {
        expect(c.name.length).toBeGreaterThan(0);
        expect(typeof c.unionized).toBe('boolean');
        expect(c.qualifications.length).toBeGreaterThan(0);
        expect(c.salary).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic: same seed gives identical pool', () => {
    expect(createHiringPool(42, 0)).toEqual(createHiringPool(42, 0));
  });

  it('different seeds give different pools', () => {
    expect(createHiringPool(1, 0)).not.toEqual(createHiringPool(2, 0));
  });

  it('createGame embeds a seed-derived pool with 3 per role', () => {
    const state = createGame({ seed: 7, mineType: 'desert' });
    for (const role of ROLES) expect(candidatesForRole(state.hiringPool, role)).toHaveLength(3);
    expect(state.hiringPool).toEqual(createHiringPool(7, 0));
  });

  it('createGame with different seeds yields different pools', () => {
    const a = createGame({ seed: 7, mineType: 'desert' });
    const b = createGame({ seed: 8, mineType: 'desert' });
    expect(a.hiringPool).not.toEqual(b.hiringPool);
  });
});

describe('generateCandidate', () => {
  it('salary equals calculateSalary of the resulting hire (many seeds, all roles)', () => {
    for (const role of ROLES) {
      for (let seed = 1; seed <= 40; seed++) {
        const c = generateCandidate(role, new Random(seed), seed);
        expect(c.id).toBe(seed);
        expect(c.role).toBe(role);
        const emp = hireFrom(role, c, seed + 1000);
        expect(calculateSalary(emp)).toBe(c.salary);
      }
    }
  });

  it('is deterministic for the same rng seed', () => {
    expect(generateCandidate('driller', new Random(5), 1)).toEqual(generateCandidate('driller', new Random(5), 1));
  });

  it('always keeps the role starting qualification categories', () => {
    for (const role of ROLES) {
      for (let seed = 1; seed <= 30; seed++) {
        const c = generateCandidate(role, new Random(seed), 1);
        for (const start of ROLE_STARTING_QUALIFICATIONS[role]) {
          const q = c.qualifications.find(x => x.category === start.category);
          expect(q).toBeDefined();
          expect(q!.proficiencyLevel).toBeGreaterThanOrEqual(start.proficiencyLevel);
        }
      }
    }
  });

  it('varies across seeds (names, union flag or skills are not all identical)', () => {
    const cs = Array.from({ length: 30 }, (_, i) => generateCandidate('blaster', new Random(i + 1), 1));
    expect(new Set(cs.map(c => c.name)).size).toBeGreaterThan(1);
    expect(new Set(cs.map(c => c.unionized)).size).toBe(2);
  });
});

describe('candidatesForRole', () => {
  it('returns only the role, in pool order; empty for an empty pool', () => {
    const pool = createHiringPool(3, 0);
    expect(candidatesForRole(pool, 'manager').every(c => c.role === 'manager')).toBe(true);
    const empty: HiringPoolState = { candidates: [], nextCandidateId: 1, lastRefreshTick: 0 };
    expect(candidatesForRole(empty, 'driller')).toEqual([]);
  });
});

describe('takeCandidate', () => {
  it('removes exactly the requested candidate and returns it', () => {
    const pool = createHiringPool(42, 0);
    const target = candidatesForRole(pool, 'driller')[1]!;
    const before = pool.candidates.length;
    const got = takeCandidate(pool, 'driller', target.id);
    expect(got).toEqual(target);
    expect(pool.candidates).toHaveLength(before - 1);
    expect(pool.candidates.find(c => c.id === target.id)).toBeUndefined();
    expect(candidatesForRole(pool, 'driller')).toHaveLength(2);
    expect(candidatesForRole(pool, 'blaster')).toHaveLength(3);
  });

  it('without id takes the first candidate for that role', () => {
    const pool = createHiringPool(42, 0);
    const first = candidatesForRole(pool, 'surveyor')[0]!;
    expect(takeCandidate(pool, 'surveyor')).toEqual(first);
    expect(pool.candidates.find(c => c.id === first.id)).toBeUndefined();
  });

  it('wrong role returns null and does not mutate', () => {
    const pool = createHiringPool(42, 0);
    const drillerId = candidatesForRole(pool, 'driller')[0]!.id;
    const snapshot = structuredClone(pool);
    expect(takeCandidate(pool, 'blaster', drillerId)).toBeNull();
    expect(pool).toEqual(snapshot);
  });

  it('unknown id returns null and does not mutate', () => {
    const pool = createHiringPool(42, 0);
    const snapshot = structuredClone(pool);
    expect(takeCandidate(pool, 'driller', 99999)).toBeNull();
    expect(pool).toEqual(snapshot);
  });

  it('empty role returns null (no id)', () => {
    const pool = createHiringPool(42, 0);
    for (let i = 0; i < 3; i++) expect(takeCandidate(pool, 'manager')).not.toBeNull();
    expect(takeCandidate(pool, 'manager')).toBeNull();
  });

  it('taking the same id twice returns null the second time', () => {
    const pool = createHiringPool(42, 0);
    const id = candidatesForRole(pool, 'driver')[0]!.id;
    expect(takeCandidate(pool, 'driver', id)).not.toBeNull();
    expect(takeCandidate(pool, 'driver', id)).toBeNull();
  });
});

describe('isHiringPoolDue / refreshHiringPool', () => {
  it('is due exactly at lastRefreshTick + HIRING_POOL_REFRESH_INTERVAL', () => {
    const pool = { lastRefreshTick: 10 };
    expect(isHiringPoolDue(pool, 10)).toBe(false);
    expect(isHiringPoolDue(pool, 10 + HIRING_POOL_REFRESH_INTERVAL - 1)).toBe(false);
    expect(isHiringPoolDue(pool, 10 + HIRING_POOL_REFRESH_INTERVAL)).toBe(true);
    expect(isHiringPoolDue(pool, 10 + HIRING_POOL_REFRESH_INTERVAL + 50)).toBe(true);
  });

  it('refill restores 3 per role with fresh ids, stamps lastRefreshTick', () => {
    const pool = createHiringPool(42, 0);
    const oldIds = new Set(pool.candidates.map(c => c.id));
    takeCandidate(pool, 'driller');
    takeCandidate(pool, 'driller');
    refreshHiringPool(pool, 42, HIRING_POOL_REFRESH_INTERVAL);
    for (const role of ROLES) expect(candidatesForRole(pool, role)).toHaveLength(3);
    expect(pool.lastRefreshTick).toBe(HIRING_POOL_REFRESH_INTERVAL);
    const newOnes = candidatesForRole(pool, 'driller').filter(c => !oldIds.has(c.id));
    expect(newOnes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(pool.candidates.map(c => c.id)).size).toBe(pool.candidates.length);
  });

  it('is deterministic for same pool, seed and tick', () => {
    const a = createHiringPool(42, 0);
    const b = createHiringPool(42, 0);
    takeCandidate(a, 'manager'); takeCandidate(b, 'manager');
    refreshHiringPool(a, 42, 24);
    refreshHiringPool(b, 42, 24);
    expect(a).toEqual(b);
  });

  it('never exceeds 3 per role when refreshing a full pool', () => {
    const pool = createHiringPool(42, 0);
    refreshHiringPool(pool, 42, 24);
    for (const role of ROLES) expect(candidatesForRole(pool, role)).toHaveLength(3);
  });
});

describe('hireEmployee with a candidate', () => {
  it('yields identical name, union flag, qualifications and salary (many seeds)', () => {
    for (const role of ROLES) {
      for (let seed = 1; seed <= 30; seed++) {
        const c = generateCandidate(role, new Random(seed), 1);
        const emp = hireFrom(role, c, seed * 7);
        expect(emp.name).toBe(c.name);
        expect(emp.unionized).toBe(c.unionized);
        expect(emp.qualifications).toEqual(c.qualifications);
        expect(emp.salary).toBe(c.salary);
        expect(emp.role).toBe(role);
      }
    }
  });

  it('does not alias the candidate qualifications array', () => {
    const c = generateCandidate('driller', new Random(1), 1);
    const emp = hireFrom('driller', c);
    emp.qualifications[0]!.xp += 1000;
    expect(c.qualifications[0]!.xp).not.toBe(emp.qualifications[0]!.xp);
  });

  it('without a candidate keeps the legacy behaviour (role starting quals, calculateSalary salary)', () => {
    const es = createEmployeeState();
    const { employee } = hireEmployee(es, 'blaster', new Random(3));
    expect(employee.qualifications.map(q => q.category))
      .toEqual(ROLE_STARTING_QUALIFICATIONS.blaster.map(q => q.category));
    expect(employee.salary).toBe(calculateSalary(employee));
  });
});
