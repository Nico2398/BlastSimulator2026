// BlastSimulator2026 — driving.rock_fragmenter licence (#1339)
//
// The rock fragmenter used to borrow the excavator licence. Now that every
// Driver arrives holding driving.excavator, that would make the fragmenter
// (and its tutorial course) free, so it gets a licence of its own, taught only
// at the Driving Center.

import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { SkillCategory } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { canAssignDriver } from '../../../src/core/entities/VehicleDriverAssignment.js';
import { board } from '../../../src/core/engine/Mount.js';
import { trainableSkills, schoolFor } from '../../../src/core/entities/EmployeeTraining.js';
import { TRAINING_BUILDING_SKILLS } from '../../../src/core/config/balance.js';

function fixture(hireRole: 'driver' | 'driller' | 'surveyor', extra: SkillCategory[] = []) {
  const state = createGame({ seed: 42 });
  const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
  const { employee } = hireEmployee(state.employees, hireRole, new Random(42));
  for (const skill of extra) assignSkill(state.employees, employee.id, skill, 1);
  return { state, vehicle, employee };
}

describe('driving.rock_fragmenter licence', () => {
  it('ROLE_LICENCE_REQUIRED.rock_fragmenter is its own licence', () => {
    expect(ROLE_LICENCE_REQUIRED.rock_fragmenter).toBe('driving.rock_fragmenter');
  });

  it('the other vehicle roles keep their licences', () => {
    expect(ROLE_LICENCE_REQUIRED.rock_digger).toBe('driving.excavator');
    expect(ROLE_LICENCE_REQUIRED.drill_rig).toBe('driving.drill_rig');
    expect(ROLE_LICENCE_REQUIRED.debris_hauler).toBe('driving.truck');
    expect(ROLE_LICENCE_REQUIRED.building_destroyer).toBe('driving.truck');
  });

  it('a freshly hired driver (truck + excavator) cannot board a rock_fragmenter', () => {
    const { state, vehicle, employee } = fixture('driver');
    const result = board(state, vehicle.id, employee.id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('an excavator-only employee is rejected by canAssignDriver', () => {
    const { state, vehicle, employee } = fixture('surveyor', ['driving.excavator']);
    const result = canAssignDriver(state.vehicles, state.employees, vehicle.id, employee.id);
    expect(result.success).toBe(false);
  });

  it('an employee holding driving.rock_fragmenter can board a rock_fragmenter', () => {
    const { state, vehicle, employee } = fixture('driver', ['driving.rock_fragmenter']);
    const result = board(state, vehicle.id, employee.id);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('a fragmenter licence alone does not let anyone drive a rock_digger', () => {
    const state = createGame({ seed: 42 });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { employee } = hireEmployee(state.employees, 'surveyor', new Random(42));
    assignSkill(state.employees, employee.id, 'driving.rock_fragmenter', 1);
    expect(board(state, vehicle.id, employee.id).success).toBe(false);
  });
});

describe('driving.rock_fragmenter training', () => {
  it('TRAINING_BUILDING_SKILLS.driving_center includes it', () => {
    expect([...TRAINING_BUILDING_SKILLS.driving_center]).toContain('driving.rock_fragmenter');
  });

  it('trainableSkills(driving_center) offers it, and schoolFor resolves to the driving center', () => {
    expect(trainableSkills('driving_center')).toContain('driving.rock_fragmenter');
    expect(schoolFor('driving.rock_fragmenter')).toBe('driving_center');
  });

  it('no other school teaches it', () => {
    for (const type of ['blasting_academy', 'management_office', 'geology_lab'] as const) {
      expect(trainableSkills(type)).not.toContain('driving.rock_fragmenter');
    }
  });
});
