// @vitest-environment jsdom
// BlastSimulator2026 — hiring filter criteria and candidate filtering (#2160).
import { describe, it, expect } from 'vitest';
import {
  HIRING_LEVEL_CHOICES,
  HIRING_SORT_KEYS,
  criteriaFromSelection,
  filterCandidates,
  type HiringCriteria,
} from '../../../src/ui/hiringFilter.js';
import { FilterBarSelection } from '../../../src/ui/filterBar.js';
import { HIRING_COSTS, type EmployeeRole, type SkillCategory } from '../../../src/core/entities/Employee.js';
import type { HireCandidate } from '../../../src/core/entities/HiringPool.js';

type Level = 1 | 2 | 3 | 4 | 5;

function cand(
  id: number,
  role: EmployeeRole,
  quals: [SkillCategory, Level][],
  salary: number,
  unionized = false,
): HireCandidate {
  return {
    id,
    role,
    name: `Cand ${id}`,
    unionized,
    salary,
    qualifications: quals.map(([category, proficiencyLevel]) => ({ category, proficiencyLevel, xp: 0 })),
  };
}

const NONE: HiringCriteria = { role: null, skill: null, minLevel: null, union: null, affordableOnly: false, sort: null };
const crit = (over: Partial<HiringCriteria>): HiringCriteria => ({ ...NONE, ...over });
const ids = (list: readonly HireCandidate[]): number[] => list.map(c => c.id);

const POOL: HireCandidate[] = [
  cand(1, 'driller', [['blasting', 1], ['driving.drill_rig', 1]], 400, false),
  cand(2, 'driller', [['blasting', 3], ['driving.drill_rig', 1]], 300, true),
  cand(3, 'blaster', [['blasting', 2], ['driving.truck', 1]], 900, false),
  cand(4, 'blaster', [['blasting', 1], ['driving.truck', 3]], 700, true),
  cand(5, 'driver', [['driving.truck', 1], ['driving.excavator', 1]], 500, false),
  cand(6, 'surveyor', [['geology', 1]], 600, false),
  cand(7, 'manager', [['management', 1]], 1000, true),
];

describe('hiringFilter constants', () => {
  it('offers sort keys salary and level', () => {
    expect([...HIRING_SORT_KEYS].sort()).toEqual(['level', 'salary']);
  });

  it('offers minimum levels 2 to 5 (level 1 would filter nothing)', () => {
    expect([...HIRING_LEVEL_CHOICES]).toEqual([2, 3, 4, 5]);
  });
});

describe('criteriaFromSelection', () => {
  it('an untouched selection yields no criteria', () => {
    expect(criteriaFromSelection(new FilterBarSelection())).toEqual(NONE);
  });

  it('reads the role from the main filter', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'blaster';
    expect(criteriaFromSelection(sel).role).toBe('blaster');
  });

  it('reads the skill group', () => {
    const sel = new FilterBarSelection();
    sel.groups['skill'] = 'driving.truck';
    expect(criteriaFromSelection(sel).skill).toBe('driving.truck');
  });

  it('reads the level group as a number', () => {
    const sel = new FilterBarSelection();
    sel.groups['level'] = '4';
    expect(criteriaFromSelection(sel).minLevel).toBe(4);
  });

  it('reads the union group for both values', () => {
    const sel = new FilterBarSelection();
    sel.groups['union'] = 'union';
    expect(criteriaFromSelection(sel).union).toBe('union');
    sel.groups['union'] = 'non_union';
    expect(criteriaFromSelection(sel).union).toBe('non_union');
  });

  it('reads the affordable group "yes" as affordableOnly', () => {
    const sel = new FilterBarSelection();
    sel.groups['affordable'] = 'yes';
    expect(criteriaFromSelection(sel).affordableOnly).toBe(true);
  });

  it('a group set back to null reads as unset', () => {
    const sel = new FilterBarSelection();
    sel.groups['skill'] = null;
    sel.groups['level'] = null;
    sel.groups['union'] = null;
    sel.groups['affordable'] = null;
    expect(criteriaFromSelection(sel)).toEqual(NONE);
  });

  it('reads the sort key', () => {
    const sel = new FilterBarSelection();
    sel.sort = 'salary';
    expect(criteriaFromSelection(sel).sort).toBe('salary');
    sel.sort = 'level';
    expect(criteriaFromSelection(sel).sort).toBe('level');
  });

  it('reads several choices at once', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'driller';
    sel.groups['skill'] = 'blasting';
    sel.groups['level'] = '2';
    sel.sort = 'level';
    expect(criteriaFromSelection(sel)).toEqual(crit({ role: 'driller', skill: 'blasting', minLevel: 2, sort: 'level' }));
  });
});

describe('filterCandidates — filtering', () => {
  it('no criteria returns every candidate in pool order', () => {
    expect(ids(filterCandidates(POOL, NONE, 0))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('returns an empty list for an empty pool', () => {
    expect(filterCandidates([], crit({ union: 'union' }), 99999)).toEqual([]);
  });

  it('does not mutate the input list', () => {
    const input = [...POOL];
    filterCandidates(input, crit({ sort: 'salary', role: 'driller' }), 0);
    expect(ids(input)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('role keeps only that role', () => {
    expect(ids(filterCandidates(POOL, crit({ role: 'blaster' }), 0))).toEqual([3, 4]);
  });

  it('skill matches a candidate holding it in the first qualification', () => {
    expect(ids(filterCandidates(POOL, crit({ skill: 'geology' }), 0))).toEqual([6]);
  });

  it('skill matches a candidate holding it in a later qualification', () => {
    expect(ids(filterCandidates(POOL, crit({ skill: 'driving.truck' }), 0))).toEqual([3, 4, 5]);
  });

  it('skill nobody holds matches nothing', () => {
    expect(filterCandidates(POOL, crit({ skill: 'repair' }), 0)).toEqual([]);
  });

  it('min level without a skill matches any qualification at or above it', () => {
    expect(ids(filterCandidates(POOL, crit({ minLevel: 3 }), 0))).toEqual([2, 4]);
    expect(ids(filterCandidates(POOL, crit({ minLevel: 2 }), 0))).toEqual([2, 3, 4]);
  });

  it('min level above every candidate matches nothing', () => {
    expect(filterCandidates(POOL, crit({ minLevel: 5 }), 0)).toEqual([]);
  });

  it('min level with a skill looks only at that skill', () => {
    // 4 has truck 3 but blasting 1; 2 has blasting 3.
    expect(ids(filterCandidates(POOL, crit({ skill: 'blasting', minLevel: 3 }), 0))).toEqual([2]);
    expect(ids(filterCandidates(POOL, crit({ skill: 'driving.truck', minLevel: 3 }), 0))).toEqual([4]);
    expect(ids(filterCandidates(POOL, crit({ skill: 'blasting', minLevel: 2 }), 0))).toEqual([2, 3]);
  });

  it('min level equal to the proficiency is kept (boundary)', () => {
    expect(ids(filterCandidates(POOL, crit({ skill: 'blasting', minLevel: 2 }), 0))).toContain(3);
  });

  it('union keeps only unionized candidates', () => {
    expect(ids(filterCandidates(POOL, crit({ union: 'union' }), 0))).toEqual([2, 4, 7]);
  });

  it('non_union keeps only non-unionized candidates', () => {
    expect(ids(filterCandidates(POOL, crit({ union: 'non_union' }), 0))).toEqual([1, 3, 5, 6]);
  });

  it('affordableOnly keeps candidates whose role fee is within cash', () => {
    const kept = ids(filterCandidates(POOL, crit({ affordableOnly: true }), HIRING_COSTS.surveyor));
    const expected = POOL.filter(c => HIRING_COSTS[c.role] <= HIRING_COSTS.surveyor).map(c => c.id);
    expect(kept).toEqual(expected);
    expect(kept).toContain(6);
  });

  it('affordableOnly drops a role costing one more than cash', () => {
    expect(ids(filterCandidates(POOL, crit({ affordableOnly: true }), HIRING_COSTS.surveyor - 1))).not.toContain(6);
  });

  it('affordableOnly with no cash keeps nobody', () => {
    expect(filterCandidates(POOL, crit({ affordableOnly: true }), 0)).toEqual([]);
  });

  it('affordableOnly false ignores cash', () => {
    expect(filterCandidates(POOL, NONE, 0)).toHaveLength(7);
  });

  it('criteria combine as AND', () => {
    expect(ids(filterCandidates(POOL, crit({ union: 'union', skill: 'blasting' }), 0))).toEqual([2, 4]);
    expect(ids(filterCandidates(POOL, crit({ union: 'union', skill: 'blasting', minLevel: 2 }), 0))).toEqual([2]);
    expect(ids(filterCandidates(POOL, crit({ role: 'blaster', union: 'non_union' }), 0))).toEqual([3]);
    expect(filterCandidates(POOL, crit({ role: 'manager', union: 'non_union' }), 0)).toEqual([]);
  });
});

describe('filterCandidates — sorting', () => {
  it('salary sorts ascending', () => {
    expect(ids(filterCandidates(POOL, crit({ sort: 'salary' }), 0))).toEqual([2, 1, 5, 6, 4, 3, 7]);
  });

  it('salary ties break by candidate id', () => {
    const tied = [
      cand(9, 'driller', [['blasting', 1]], 500),
      cand(3, 'driller', [['blasting', 1]], 500),
      cand(6, 'driller', [['blasting', 1]], 400),
    ];
    expect(ids(filterCandidates(tied, crit({ sort: 'salary' }), 0))).toEqual([6, 3, 9]);
  });

  it('level without a skill sorts descending by the highest qualification', () => {
    // best levels: 1->1, 2->3, 3->2, 4->3, 5->1, 6->1, 7->1
    expect(ids(filterCandidates(POOL, crit({ sort: 'level' }), 0))).toEqual([2, 4, 3, 1, 5, 6, 7]);
  });

  it('level with a skill sorts descending by that skill', () => {
    expect(ids(filterCandidates(POOL, crit({ sort: 'level', skill: 'driving.truck' }), 0))).toEqual([4, 3, 5]);
    expect(ids(filterCandidates(POOL, crit({ sort: 'level', skill: 'blasting' }), 0))).toEqual([2, 3, 1, 4]);
  });

  it('level ties break by candidate id', () => {
    const tied = [
      cand(8, 'driver', [['driving.truck', 2]], 100),
      cand(2, 'driver', [['driving.truck', 2]], 100),
      cand(5, 'driver', [['driving.truck', 4]], 100),
    ];
    expect(ids(filterCandidates(tied, crit({ sort: 'level' }), 0))).toEqual([5, 2, 8]);
  });

  it('no sort keeps pool order even when it is not id order', () => {
    const shuffled = [POOL[4]!, POOL[0]!, POOL[2]!];
    expect(ids(filterCandidates(shuffled, NONE, 0))).toEqual([5, 1, 3]);
  });

  it('sort applies after filtering', () => {
    expect(ids(filterCandidates(POOL, crit({ union: 'non_union', sort: 'salary' }), 0))).toEqual([1, 5, 6, 3]);
  });
});
