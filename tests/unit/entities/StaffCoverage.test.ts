// Staff coverage (#2242): qualified people against the vehicles and queued orders that need them.
import { describe, it, expect } from 'vitest';
import { staffCoverage } from '../../../src/core/entities/StaffCoverage.js';
import type { Employee, SkillCategory } from '../../../src/core/entities/Employee.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

function emp(id: number, quals: Array<[SkillCategory, number?]>, alive = true): Employee {
  return {
    id, alive,
    qualifications: quals.map(([category, licenceLevel]) => ({ category, proficiencyLevel: 1, xp: 0, ...(licenceLevel ? { licenceLevel } : {}) })),
  } as unknown as Employee;
}

function order(skill: SkillCategory | null, status: PendingAction['status'] = 'queued', holderId: number | null = null): Pick<PendingAction, 'requiredSkill' | 'status' | 'holderId'> {
  return { requiredSkill: skill, status, holderId };
}

describe('staffCoverage', () => {
  it('is empty when nothing on site needs a qualification', () => {
    expect(staffCoverage([], [emp(1, [['blasting']])], [order(null)])).toEqual([]);
  });

  it('flags a licence nobody holds as missing', () => {
    const [line] = staffCoverage([{ type: 'drill_rig', tier: 1 }], [emp(1, [['blasting']])], []);
    expect(line).toMatchObject({ skill: 'driving.drill_rig', vehicles: 1, holders: 0, holdersAtLevel: 0, status: 'missing' });
  });

  it('three trucks share one truck licence, so one driver for three is short', () => {
    const [line] = staffCoverage(
      [{ type: 'debris_hauler', tier: 1 }, { type: 'charging_truck', tier: 1 }, { type: 'building_destroyer', tier: 1 }],
      [emp(1, [['driving.truck']])], [],
    );
    expect(line).toMatchObject({ skill: 'driving.truck', vehicles: 3, holdersAtLevel: 1, status: 'short' });
    expect([...line!.roles].sort()).toEqual(['building_destroyer', 'charging_truck', 'debris_hauler']);
  });

  it('a tier 3 vehicle needs licence level 3: level-1 holders count as holders, not as able to drive it', () => {
    const [line] = staffCoverage([{ type: 'rock_digger', tier: 3 }], [emp(1, [['driving.excavator', 1]]), emp(2, [['driving.excavator', 1]])], []);
    expect(line).toMatchObject({ levelNeeded: 3, holders: 2, holdersAtLevel: 0, status: 'missing' });
  });

  it('counts only queued, unclaimed orders that need a skill, and dead employees never cover', () => {
    const lines = staffCoverage([], [emp(1, [['geology']], false)], [
      order('geology'), order('geology'), order('geology', 'assigned', 4), order(null),
    ]);
    expect(lines).toEqual([expect.objectContaining({ skill: 'geology', queuedOrders: 2, holders: 0, status: 'missing' })]);
  });

  it('is ok when every vehicle has a qualified hand, and orders worst lines first', () => {
    const lines = staffCoverage(
      [{ type: 'drill_rig', tier: 1 }, { type: 'debris_hauler', tier: 2 }],
      [emp(1, [['driving.drill_rig']]), emp(2, [['driving.truck', 1]])], [],
    );
    expect(lines.map(l => [l.skill, l.status])).toEqual([['driving.truck', 'missing'], ['driving.drill_rig', 'ok']]);
  });
});
