// BlastSimulator2026 — Integration: every role arrives able to do its own job (#1339)
//
// Before #1339 a hired Driller held only `blasting`, so with a drill rig on
// site the console answered "Drill hole needs a drill rig — nobody is
// licensed" until a Driving Center and a per-employee course were paid for.
// Nobody arrived able to run an excavator either. These flows go through the
// console exactly as a player's commands would, with no course anywhere.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { tickUntil } from './helpers.js';
import { countBuildingsOfType } from '../../src/ui/tutorialStepHelpers.js';
import { vehicleDriverId } from '../../src/core/entities/Vehicle.js';

function newSite() {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32').success).toBe(true);
  ctx.state!.cash = 1_000_000; // setup-only affordability
  return { run, ctx, state: ctx.state! };
}

describe('role starting qualifications — gameplay flows (#1339)', () => {
  it('a freshly hired Driller + drill rig drills an ordered hole with no course', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:driller').success).toBe(true);
    expect(run('vehicle buy drill_rig tier:1').success).toBe(true);
    expect(state.employees.employees).toHaveLength(1);

    const plan = run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14');
    expect(plan.success, plan.output).toBe(true);
    expect(plan.output).not.toContain('nobody is licensed');
    expect(state.plannedDrillHoles).toHaveLength(2);

    tickUntil(run, () => state.drillHoles.length === 2, 600);
    expect(state.drillHoles).toHaveLength(2);
    expect(state.plannedDrillHoles).toHaveLength(0);
  });

  it('a Blaster alone cannot drill: it holds blasting but no rig licence', () => {
    const { state, run } = newSite();
    expect(run('employee hire role:blaster').success).toBe(true);
    const cats = state.employees.employees[0]!.qualifications.map(q => q.category);
    expect(cats).toContain('blasting');
    expect(cats).not.toContain('driving.drill_rig');
  });

  it('a freshly hired Driver can board a rock_digger', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:driver').success).toBe(true);
    expect(run('vehicle buy rock_digger').success).toBe(true);
    const driver = state.employees.employees[0]!;
    const vehicle = state.vehicles.vehicles[0]!;

    const result = run(`vehicle driver ${vehicle.id} ${driver.id}`);
    expect(result.success, result.output).toBe(true);
    for (let i = 0; i < 100 && vehicleDriverId(vehicle) === null; i++) run('tick 1');
    expect(vehicleDriverId(vehicle)).toBe(driver.id);
  });

  it('a freshly hired Driver can still board a debris_hauler', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:driver').success).toBe(true);
    expect(run('vehicle buy debris_hauler').success).toBe(true);
    const driver = state.employees.employees[0]!;
    const vehicle = state.vehicles.vehicles[0]!;
    const result = run(`vehicle driver ${vehicle.id} ${driver.id}`);
    expect(result.success, result.output).toBe(true);
  });

  it('a freshly hired Driver cannot board a rock_fragmenter', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:driver').success).toBe(true);
    expect(run('vehicle buy rock_fragmenter').success).toBe(true);
    const driver = state.employees.employees[0]!;
    const vehicle = state.vehicles.vehicles[0]!;
    const result = run(`vehicle driver ${vehicle.id} ${driver.id}`);
    expect(result.success).toBe(false);
    expect(result.output).toContain('lacks licence');
  });

  it('a freshly hired Driller cannot board a rock_digger (the driller licence is the rig, not the excavator)', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:driller').success).toBe(true);
    expect(run('vehicle buy rock_digger').success).toBe(true);
    const result = run(`vehicle driver ${state.vehicles.vehicles[0]!.id} ${state.employees.employees[0]!.id}`);
    expect(result.success).toBe(false);
    expect(result.output).toContain('lacks licence');
  });
});

describe('rock fragmenter licence — trained through the console (#1339)', () => {
  it('`employee train` accepts driving.rock_fragmenter, and the course grants the licence', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:driver').success).toBe(true);
    const trainee = state.employees.employees[0]!;
    expect(trainee.qualifications.some(q => q.category === 'driving.rock_fragmenter')).toBe(false);

    expect(run('build driving_center at:6,7').success).toBe(true);
    for (let i = 0; i < 400 && countBuildingsOfType(state, 'driving_center') === 0; i++) {
      for (const emp of state.employees.employees) emp.fatigue = 100;
      run('tick 1');
    }
    expect(countBuildingsOfType(state, 'driving_center')).toBeGreaterThan(0);

    const train = run(`employee train ${trainee.id} skill:driving.rock_fragmenter`);
    expect(train.success, train.output).toBe(true);

    for (let i = 0; i < 400 && !trainee.qualifications.some(q => q.category === 'driving.rock_fragmenter'); i++) {
      trainee.fatigue = 100;
      run('tick 1');
    }
    expect(trainee.qualifications.some(q => q.category === 'driving.rock_fragmenter')).toBe(true);
  });

  it('`employee train` for the fragmenter without a driving center is refused', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:driver').success).toBe(true);
    const result = run(`employee train ${state.employees.employees[0]!.id} skill:driving.rock_fragmenter`);
    expect(result.success).toBe(false);
  });

  it('`employee assign_skill` accepts driving.rock_fragmenter', () => {
    const { run, state } = newSite();
    expect(run('employee hire role:surveyor').success).toBe(true);
    const emp = state.employees.employees[0]!;
    expect(run(`employee assign_skill ${emp.id} skill:driving.rock_fragmenter level:1`).success).toBe(true);
    expect(emp.qualifications.some(q => q.category === 'driving.rock_fragmenter')).toBe(true);
  });
});
