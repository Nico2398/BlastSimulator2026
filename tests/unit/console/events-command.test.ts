// BlastSimulator2026 — Unit tests: buildEventContext (#592)
//
// buildEventContext (src/console/commands/events.ts) feeds EventContext to the
// event prerequisite/weighting system. Its employeeCount field used to read
// state.employees.employees.length unfiltered — same class of bug as
// avgMorale (Employee.ts's computeAverageMorale): killEmployee never splices
// the roster, only flips alive:false, so a corpse permanently inflated the
// count fed to every event's canFire/weightCoeff check.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { buildEventContext } from '../../../src/console/commands/events.js';
import { killEmployee } from '../../../src/core/entities/Employee.js';

describe('buildEventContext (#592)', () => {
  it('reports employeeCount over the living roster only, excluding a killed employee still physically present in the array', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    runner.run('employee hire role:driller');
    runner.run('employee hire role:driller');
    runner.run('employee hire role:driller');
    const employees = ctx.state!.employees.employees;
    killEmployee(ctx.state!.employees, employees[1]!.id);

    // killEmployee only flips alive:false — the roster still physically
    // holds all 3 entries.
    expect(ctx.state!.employees.employees).toHaveLength(3);

    const eventCtx = buildEventContext(ctx);

    expect(eventCtx.employeeCount).toBe(2);
  });
});
