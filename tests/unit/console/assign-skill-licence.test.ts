// BlastSimulator2026 — `employee assign_skill ... licence:N` bootstrap (#1938)
//
// A driving licence's level (1-3) is what the per-tier slope limit gates on, and
// `assign_skill` rewrites a qualification with no licence level, so a scenario
// had no way to get a driver licensed for a tier-2 or tier-3 vehicle without
// building and researching the school. `licence:N` sets it directly.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console-api.js';
import { canDriveTier } from '../../../src/core/entities/VehicleDriverAssignment.js';

function setup() {
  const { runner, ctx } = createRunner();
  runner.run('sandbox start biome:desert_badlands kit:full seed:42');
  const driller = () => ctx.state!.employees.employees.find(e => e.id === 1)!;
  return { runner, driller };
}

describe('employee assign_skill licence:N', () => {
  it('sets the licence level on a driving skill, so the employee may drive that tier', () => {
    const { runner, driller } = setup();
    const result = runner.run('employee assign_skill 1 skill:driving.drill_rig level:1 licence:3');
    expect(result.success).toBe(true);
    const qual = driller().qualifications.find(q => q.category === 'driving.drill_rig')!;
    expect(qual.licenceLevel).toBe(3);
    expect(canDriveTier(driller(), 'drill_rig', 3)).toBe(true);
  });

  it('accepts level 2', () => {
    const { runner, driller } = setup();
    runner.run('employee assign_skill 1 skill:driving.drill_rig level:1 licence:2');
    expect(canDriveTier(driller(), 'drill_rig', 2)).toBe(true);
    expect(canDriveTier(driller(), 'drill_rig', 3)).toBe(false);
  });

  it('without licence:, the licence stays level 1 as before', () => {
    const { runner, driller } = setup();
    runner.run('employee assign_skill 1 skill:driving.drill_rig level:5');
    expect(canDriveTier(driller(), 'drill_rig', 1)).toBe(true);
    expect(canDriveTier(driller(), 'drill_rig', 2)).toBe(false);
  });

  it('refuses a licence level outside 1-3 and changes nothing', () => {
    const { runner, driller } = setup();
    const before = JSON.stringify(driller().qualifications);
    expect(runner.run('employee assign_skill 1 skill:driving.drill_rig level:1 licence:4').success).toBe(false);
    expect(runner.run('employee assign_skill 1 skill:driving.drill_rig level:1 licence:0').success).toBe(false);
    expect(JSON.stringify(driller().qualifications)).toBe(before);
  });

  it('refuses licence:N on a skill that is not a driving licence', () => {
    const { runner } = setup();
    expect(runner.run('employee assign_skill 1 skill:blasting level:3 licence:2').success).toBe(false);
  });
});
