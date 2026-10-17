// BlastSimulator2026 — Union membership helpers and their salary effects (#1873)

import { describe, it, expect } from 'vitest';
import {
  unionMemberCount,
  unionDiscountedSalary,
  unionEventStretch,
} from '../../../src/core/entities/UnionMembership.js';
import {
  UNION_MEMBER_SALARY_DISCOUNT_PCT,
  UNION_TIMER_MIN_SHARE_FACTOR,
  UNION_STRIKE_MIN_MEMBERS,
  XP_THRESHOLDS,
} from '../../../src/core/config/balance.js';
import {
  calculateSalary,
  canFireEmployee,
  createEmployeeState,
  hireEmployee,
  giveRaise,
  assignSkill,
  gainXp,
  type EmployeeRole,
} from '../../../src/core/entities/Employee.js';
import { createHiringPool, generateCandidate } from '../../../src/core/entities/HiringPool.js';
import { Random } from '../../../src/core/math/Random.js';

const ROLES: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];

describe('balance constants (#1873)', () => {
  it('carry the agreed values', () => {
    expect(UNION_MEMBER_SALARY_DISCOUNT_PCT).toBe(15);
    expect(UNION_TIMER_MIN_SHARE_FACTOR).toBe(0.25);
    expect(UNION_STRIKE_MIN_MEMBERS).toBe(1);
  });
});

describe('unionMemberCount', () => {
  it('counts only living unionized employees', () => {
    expect(unionMemberCount([
      { alive: true, unionized: true },
      { alive: true, unionized: false },
      { alive: false, unionized: true },
      { alive: true, unionized: true },
    ])).toBe(2);
  });
  it('is 0 for an empty roster', () => {
    expect(unionMemberCount([])).toBe(0);
  });
  it('is 0 when every member is dead', () => {
    expect(unionMemberCount([{ alive: false, unionized: true }])).toBe(0);
  });
});

describe('unionDiscountedSalary', () => {
  it('takes 15% off a member salary', () => {
    expect(unionDiscountedSalary(1000, true)).toBe(850);
  });
  it('leaves a non-member salary alone', () => {
    expect(unionDiscountedSalary(1000, false)).toBe(1000);
  });
  it('returns a positive integer for awkward salaries', () => {
    for (const s of [1, 7, 33, 101, 999, 1234]) {
      const d = unionDiscountedSalary(s, true);
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(s);
    }
  });
});

describe('unionEventStretch', () => {
  it('is 1/F (4) with no members', () => {
    expect(unionEventStretch(0, 10)).toBe(4);
  });
  it('is 1 when everyone is a member', () => {
    expect(unionEventStretch(10, 10)).toBe(1);
  });
  it('lies strictly between at half membership and follows 1/(F+(1-F)*share)', () => {
    const v = unionEventStretch(5, 10);
    expect(v).toBeGreaterThan(1);
    expect(v).toBeLessThan(4);
    expect(v).toBeCloseTo(1 / (0.25 + 0.75 * 0.5), 10);
  });
  it('shrinks monotonically as members grow', () => {
    let prev = Infinity;
    for (let m = 0; m <= 10; m++) {
      const v = unionEventStretch(m, 10);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });
  it('is 1 for undefined members (legacy contexts)', () => {
    expect(unionEventStretch(undefined, 10)).toBe(1);
  });
  it('is 1 when nobody is living', () => {
    expect(unionEventStretch(0, 0)).toBe(1);
  });
});

describe('calculateSalary with union membership', () => {
  const base = { role: 'blaster' as const, qualifications: [], raises: 0 };

  it('pays a member 15% less than an identical non-member', () => {
    const plain = calculateSalary({ ...base, unionized: false });
    expect(plain).toBeGreaterThan(0);
    expect(calculateSalary({ ...base, unionized: true })).toBe(unionDiscountedSalary(plain, true));
    expect(calculateSalary({ ...base, unionized: true })).toBeLessThan(plain);
  });

  it('treats an omitted flag as non-member', () => {
    expect(calculateSalary(base)).toBe(calculateSalary({ ...base, unionized: false }));
  });

  it('applies the discount after raises', () => {
    const raised = { ...base, raises: 200 };
    const plain = calculateSalary({ ...raised, unionized: false });
    expect(calculateSalary({ ...raised, unionized: true })).toBe(unionDiscountedSalary(plain, true));
  });

  it('a hired member stores the discounted salary, a giveRaise keeps it discounted', () => {
    const rng = () => new Random(5);
    const es = createEmployeeState();
    const member = hireEmployee(es, 'blaster', rng(), 0, 0, 0, { name: 'M', unionized: true, qualifications: [] }).employee;
    const other = hireEmployee(es, 'blaster', rng(), 0, 0, 0, { name: 'N', unionized: false, qualifications: [] }).employee;
    expect(member.salary).toBe(unionDiscountedSalary(other.salary, true));
    giveRaise(es, member.id, 200);
    giveRaise(es, other.id, 200);
    expect(member.salary).toBe(unionDiscountedSalary(other.salary, true));
  });

  it('a training level-up keeps the member discount', () => {
    const es = createEmployeeState();
    const member = hireEmployee(es, 'blaster', new Random(1), 0, 0, 0, { name: 'M', unionized: true, qualifications: [] }).employee;
    const other = hireEmployee(es, 'blaster', new Random(1), 0, 0, 0, { name: 'N', unionized: false, qualifications: [] }).employee;
    for (const e of [member, other]) {
      e.qualifications = [];
      assignSkill(es, e.id, 'blasting', 1);
      gainXp(es, e.id, 'blasting', XP_THRESHOLDS[5]);
    }
    expect(member.salary).toBe(unionDiscountedSalary(other.salary, true));
  });
});

describe('hiring pool candidates with union discount', () => {
  it('same seed: only the salary differs, and a member gets exactly the discounted value', () => {
    // Re-derive the non-union twin by recomputing the salary without the flag.
    for (const role of ROLES) {
      for (let seed = 1; seed <= 40; seed++) {
        const c = generateCandidate(role, new Random(seed), 1);
        const twin = calculateSalary({ role, qualifications: c.qualifications, raises: 0, unionized: false });
        if (c.unionized) expect(c.salary).toBe(unionDiscountedSalary(twin, true));
        else expect(c.salary).toBe(twin);
        expect(c.salary).toBeGreaterThan(0);
      }
    }
  });

  it('union flag, name and qualifications draw order is unchanged for a seed', () => {
    const a = generateCandidate('driller', new Random(7), 1);
    const b = generateCandidate('driller', new Random(7), 1);
    expect(b).toEqual(a);
    expect(a.qualifications.length).toBeGreaterThan(0);
  });

  it('a pool contains at least one member over many seeds, all discounted', () => {
    let members = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const c of createHiringPool(seed, 0).candidates) {
        const full = calculateSalary({ role: c.role, qualifications: c.qualifications, raises: 0 });
        if (c.unionized) {
          members++;
          expect(c.salary).toBe(unionDiscountedSalary(full, true));
        } else expect(c.salary).toBe(full);
      }
    }
    expect(members).toBeGreaterThan(0);
  });

  it('a scripted union candidate (with extraQualifications) is discounted; a non-union one is not', () => {
    const script = [
      { id: 1, role: 'driller' as const, name: 'U', unionized: true, skillBonus: 0 as const,
        extraQualifications: [{ category: 'driving.truck' as const, proficiencyLevel: 1 as const }] },
      { id: 2, role: 'driller' as const, name: 'N', unionized: false, skillBonus: 0 as const,
        extraQualifications: [{ category: 'driving.truck' as const, proficiencyLevel: 1 as const }] },
    ];
    const pool = createHiringPool(1, 0, script);
    const [u, n] = pool.candidates;
    expect(u!.salary).toBe(unionDiscountedSalary(n!.salary, true));
    expect(u!.salary).toBeLessThan(n!.salary);
  });

  it('hiring a candidate gives the employee the card salary', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const c = generateCandidate('manager', new Random(seed), 1);
      const es = createEmployeeState();
      const { employee } = hireEmployee(es, 'manager', new Random(1), 0, 0, 0, c);
      expect(employee.salary).toBe(c.salary);
    }
  });
});

describe('canFireEmployee stays refusing members', () => {
  it('refuses a unionized employee and allows a non-member', () => {
    const es = createEmployeeState();
    const m = hireEmployee(es, 'driller', new Random(1), 0, 0, 0, { name: 'M', unionized: true, qualifications: [] }).employee;
    const n = hireEmployee(es, 'driller', new Random(1), 0, 0, 0, { name: 'N', unionized: false, qualifications: [] }).employee;
    expect(canFireEmployee(es, m.id).success).toBe(false);
    expect(canFireEmployee(es, n.id).success).toBe(true);
  });
});
