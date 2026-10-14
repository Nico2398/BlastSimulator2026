// BlastSimulator2026 — console `tick` training completion wording (#1726)

import { describe, it, expect, beforeEach } from 'vitest';
import { tickCommand } from '../../../src/console/commands/tick.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { Random } from '../../../src/core/math/Random.js';
import { makeGameContext } from '../../helpers/gameContext.js';

beforeEach(() => setupEvents());

/** A trainee one tick from finishing a course granting `grantsLevel` in `skill`. */
function setupFinalTick(skill: 'geology' | 'blasting', grantsLevel: 1 | 2, heldLevel: 0 | 1) {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
  const state = ctx.state!;
  const grid = ctx.grid!;
  const type = skill === 'geology' ? 'geology_lab' : 'blasting_academy';
  const placed = placeBuilding(state.buildings, type, 0, 0, grid.sizeX, grid.sizeZ, 1, grid.minX, grid.minZ);
  if (!placed.success || !placed.building) throw new Error('setup: school not placed');
  const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
  employee.qualifications = employee.qualifications.filter(q => q.category !== skill);
  if (heldLevel === 1) assignSkill(state.employees, employee.id, skill, heldLevel);
  employee.trainingState = { buildingId: placed.building.id, skill, ticksRemaining: 1, fee: 100, grantsLevel };
  return { ctx, employee };
}

describe('tick — training completion wording (#1726)', () => {
  it('reports an unlock as learned, with the level reached', () => {
    const { ctx, employee } = setupFinalTick('geology', 1, 0);
    const out = tickCommand(ctx, ['1'], {}).output;
    expect(out).toContain(`${employee.name} learned geology level 1.`);
  });

  it('reports an upgrade as raised, to the level reached', () => {
    const { ctx, employee } = setupFinalTick('blasting', 2, 1);
    const out = tickCommand(ctx, ['1'], {}).output;
    expect(out).toContain(`${employee.name} raised blasting to level 2.`);
  });
});
