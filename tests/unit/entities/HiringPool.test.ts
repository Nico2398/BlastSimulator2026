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


// ── Scripted pools (#1600) ──

import { TUTORIAL_HIRING_SCRIPT, type ScriptedCandidate } from '../../../src/core/config/balance.js';

const sig = (p: HiringPoolState) =>
  p.candidates.map(c => `${c.id}:${c.name}:${c.unionized ? 'U' : 'N'}:${c.salary}`).join('|');

/** Captured from the pre-#1600 implementation: unscripted pools must not change. */
const UNSCRIPTED_GOLDEN = [
  { seed: 42, tick: 0, created: '1:Nick Rubble:N:600|2:Earl Stoneface:U:600|3:Tony Miner:U:600|4:Pete Crater:U:820|5:Otto Pickaxe:U:820|6:Stan Diggins:N:920|7:Chuck Rockwell:N:500|8:Bob Rockwell:N:500|9:Stan Crater:N:570|10:Mike Hardhat:U:650|11:Frank Crater:N:650|12:Lars Gravel:U:720|13:Otto Dynamite:N:1050|14:Chuck Pitman:N:1050|15:Dave McBoom:U:1050',
    refreshed: '16:Rick Slagheap:N:600|17:Lars Boulder:N:600|18:Hank Dynamite:N:600|19:Lars Quartzman:U:820|20:Ivan Slagheap:U:920|21:Lars Pitman:N:920|22:Nick Rubble:N:570|23:Rick Gravel:N:570|24:Tony Rockwell:N:500|25:Lars Hardhat:U:720|26:Frank Bedrock:U:650|27:Otto Bedrock:U:650|28:Dave Miner:U:1120|29:Jake Gravel:N:1120|30:Chuck Dynamite:N:1120', nextId: 31 },
  { seed: 42, tick: 24, created: '1:Dave Blaster:U:600|2:Mike Bedrock:U:670|3:Gus Blaster:U:600|4:Mike Boulder:N:820|5:Ivan Pickaxe:N:920|6:Pete Quartzman:U:920|7:Kurt Dusty:N:500|8:Earl Dusty:U:570|9:Mike Drillbit:N:500|10:Rick McBoom:N:650|11:Mike Crater:N:650|12:Kurt Boulder:U:720|13:Tony Diggins:N:1120|14:Vic Slagheap:N:1050|15:Tony Pickaxe:N:1050',
    refreshed: '16:Frank Dynamite:U:600|17:Frank Hardhat:N:600|18:Bob McBoom:N:600|19:Earl Miner:U:820|20:Kurt Shale:N:820|21:Dave Hardhat:U:920|22:Hank Dusty:N:500|23:Frank Crater:N:500|24:Lars Rubble:U:500|25:Frank Blaster:U:650|26:Lars Drillbit:U:650|27:Jake Shale:N:650|28:Bob Pickaxe:N:1050|29:Pete Pickaxe:N:1050|30:Jake Rubble:N:1050', nextId: 31 },
  { seed: 7, tick: 0, created: '1:Bob Diggins:N:600|2:Lars Rubble:N:670|3:Pete Dusty:U:600|4:Lars Rockwell:N:920|5:Gus Drillbit:U:820|6:Earl McBoom:U:920|7:Rick Diggins:N:500|8:Nick Dynamite:N:500|9:Vic Slagheap:U:570|10:Jake Blaster:U:650|11:Ivan Rubble:N:650|12:Pete Dynamite:N:650|13:Dave McBoom:N:1120|14:Nick Crater:U:1050|15:Vic Stoneface:N:1050',
    refreshed: '16:Nick Diggins:N:600|17:Lars Dynamite:N:600|18:Bob Hardhat:U:670|19:Frank Stoneface:N:820|20:Gus Shale:N:820|21:Dave Hardhat:N:820|22:Nick Dynamite:U:500|23:Walt Gravel:U:500|24:Dave Blaster:N:500|25:Frank Crater:N:650|26:Lars McBoom:U:720|27:Hank Quartzman:U:720|28:Bob Pickaxe:N:1120|29:Tony Pitman:N:1050|30:Frank Blaster:U:1120', nextId: 31 },
  { seed: 7, tick: 24, created: '1:Otto Slagheap:N:670|2:Hank Diggins:N:600|3:Otto Crater:N:600|4:Jake Shale:U:820|5:Rick Slagheap:U:820|6:Stan Quartzman:N:820|7:Otto Pickaxe:U:570|8:Pete Dusty:U:500|9:Nick Drillbit:N:500|10:Tony Crater:N:650|11:Chuck Slagheap:U:650|12:Bob Rubble:N:650|13:Otto Slagheap:N:1050|14:Dave Drillbit:N:1050|15:Stan Dusty:N:1050',
    refreshed: '16:Rick Rockwell:N:600|17:Kurt Rockwell:U:600|18:Hank Rubble:N:600|19:Lars Stoneface:N:820|20:Walt Miner:N:820|21:Pete McBoom:N:820|22:Chuck Blaster:U:500|23:Dave Bedrock:U:500|24:Earl Dusty:N:570|25:Frank Miner:N:720|26:Stan Boulder:N:650|27:Dave Bedrock:N:720|28:Frank Rubble:N:1050|29:Gus Gravel:U:1120|30:Frank Hardhat:U:1050', nextId: 31 },
];

describe('scripted hiring pool (#1600)', () => {
  it('createHiringPool with a script offers exactly one candidate per role with the scripted ids and names', () => {
    const pool = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    expect(pool.candidates).toHaveLength(ROLES.length);
    for (const role of ROLES) expect(candidatesForRole(pool, role)).toHaveLength(1);
    for (const s of TUTORIAL_HIRING_SCRIPT) {
      const c = pool.candidates.find(x => x.id === s.id)!;
      expect(c).toBeDefined();
      expect(c.role).toBe(s.role);
      expect(c.name).toBe(s.name);
      expect(c.unionized).toBe(false);
    }
  });

  it('scripted candidates carry the role starting qualifications and a salary matching calculateSalary', () => {
    const pool = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    expect(pool.candidates).toHaveLength(TUTORIAL_HIRING_SCRIPT.length);
    for (const c of pool.candidates) {
      const cats = c.qualifications.map(q => q.category);
      expect(cats).toEqual(ROLE_STARTING_QUALIFICATIONS[c.role].map(q => q.category));
      expect(c.salary).toBe(calculateSalary({ role: c.role, qualifications: c.qualifications, raises: 0 }));
    }
  });

  it('is deep-equal across seeds and ticks', () => {
    const base = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    for (const [seed, tick] of [[42, 24], [7, 0], [7, 137], [999, 5000]] as const) {
      expect(createHiringPool(seed, tick, TUTORIAL_HIRING_SCRIPT).candidates).toEqual(base.candidates);
    }
  });

  it('skillBonus 1 raises only the primary qualification by one level and the salary follows', () => {
    const pool = createHiringPool(1, 0, [{ id: 1, role: 'blaster', name: 'Bo Nus', unionized: false, skillBonus: 1 }]);
    const c = pool.candidates[0]!;
    const base = ROLE_STARTING_QUALIFICATIONS.blaster[0]!;
    expect(c.qualifications[0]!.proficiencyLevel).toBe(base.proficiencyLevel + 1);
    expect(c.salary).toBe(calculateSalary({ role: 'blaster', qualifications: c.qualifications, raises: 0 }));
  });

  it('a scripted bonus never lifts the primary qualification above level 5', () => {
    // skillBonus is typed 0 | 1; the cast forces an over-cap sum to exercise the clamp.
    const pool = createHiringPool(1, 0, [{ id: 1, role: 'blaster', name: 'Max Out', unionized: false, skillBonus: 9 as 1 }]);
    expect(pool.candidates[0]!.qualifications[0]!.proficiencyLevel).toBe(5);
  });

  it('next candidate id follows the scripted ids', () => {
    const pool = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    expect(pool.candidates.map(c => c.id)).toEqual(TUTORIAL_HIRING_SCRIPT.map(s => s.id));
    expect(pool.nextCandidateId).toBeGreaterThan(Math.max(...TUTORIAL_HIRING_SCRIPT.map(s => s.id)));
  });

  it('refresh with a script leaves the content identical, whatever seed, tick or nextCandidateId', () => {
    const pool = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    const before = structuredClone(pool.candidates);
    refreshHiringPool(pool, 42, 24, TUTORIAL_HIRING_SCRIPT);
    expect(pool.candidates).toEqual(before);
    pool.nextCandidateId = 500;
    refreshHiringPool(pool, 7, 4800, TUTORIAL_HIRING_SCRIPT);
    expect(pool.candidates).toEqual(before);
    expect(pool.lastRefreshTick).toBe(4800);
  });

  it('refresh restores a taken candidate with the same id', () => {
    const pool = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    const before = structuredClone(pool.candidates);
    const taken = takeCandidate(pool, 'surveyor')!;
    expect(candidatesForRole(pool, 'surveyor')).toHaveLength(0);
    refreshHiringPool(pool, 42, 24, TUTORIAL_HIRING_SCRIPT);
    expect(candidatesForRole(pool, 'surveyor')).toEqual([taken]);
    expect(pool.candidates).toEqual(before);
  });

  it('hiring the same scripted candidate at different times gives identical employees', () => {
    const a = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    const b = createHiringPool(42, 0, TUTORIAL_HIRING_SCRIPT);
    refreshHiringPool(b, 42, 24 * 7, TUTORIAL_HIRING_SCRIPT);
    for (const role of ROLES) {
      const ea = hireFrom(role, candidatesForRole(a, role)[0]!, 1);
      const eb = hireFrom(role, candidatesForRole(b, role)[0]!, 99);
      expect([ea.name, ea.unionized, ea.salary, ea.qualifications]).toEqual([eb.name, eb.unionized, eb.salary, eb.qualifications]);
    }
  });

  it('an empty script yields an empty pool', () => {
    const empty: readonly ScriptedCandidate[] = [];
    const pool = createHiringPool(42, 0, empty);
    expect(pool.candidates).toEqual([]);
    refreshHiringPool(pool, 42, 24, empty);
    expect(pool.candidates).toEqual([]);
  });
});

describe('unscripted hiring pool is unchanged (#1600)', () => {
  for (const g of UNSCRIPTED_GOLDEN) {
    it(`seed ${g.seed} tick ${g.tick}: create and refresh match the pre-script output`, () => {
      const pool = createHiringPool(g.seed, g.tick);
      expect(sig(pool)).toBe(g.created);
      refreshHiringPool(pool, g.seed, g.tick + 24);
      expect(sig(pool)).toBe(g.refreshed);
      expect(pool.nextCandidateId).toBe(g.nextId);
    });
  }

  it('explicit undefined script behaves like no script', () => {
    expect(createHiringPool(42, 0, undefined)).toEqual(createHiringPool(42, 0));
  });
});
