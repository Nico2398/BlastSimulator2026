// @vitest-environment jsdom
// BlastSimulator2026 — Training controls in the Crew panel
//
// The panel is the only place a player can reach training, so an inert or
// missing control here means driving.excavator, driving.drill_rig and every
// proficiency above Rookie are unobtainable no matter how the core behaves.

import { describe, it, expect } from 'vitest';
import { makeTrainingSection, availableCourses } from '../../../src/ui/employeeTrainingSection.js';
import { formatNeed } from '../../../src/ui/employeeDetailSections.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import type { BuildingType, BuildingTier } from '../../../src/core/entities/Building.js';

function makeState(schools: Array<[BuildingType, BuildingTier]> = []): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 99_999;
  let x = 2;
  for (const [type, tier] of schools) {
    placeBuilding(s.buildings, type, x, 2, 64, 64, tier);
    x += 6;
  }
  return s;
}

function makeEmployee(overrides?: Partial<Employee>): Employee {
  return {
    id: 1, name: 'Test Worker', role: 'driver', salary: 500, morale: 75,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }],
    trainingState: null, activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null, restNeedKey: null,
    ...overrides,
  };
}

function trainButtons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>('.bs-train-btn')];
}

describe('formatNeed', () => {
  it('rounds a drained gauge to whole percent', () => {
    // Needs drain fractionally, so the raw value reached the screen as
    // "69.85000000000016".
    expect(formatNeed(69.85000000000016)).toBe('70');
    expect(formatNeed(100)).toBe('100');
    expect(formatNeed(0)).toBe('0');
  });
});

describe('availableCourses', () => {
  it('offers nothing when no school is built', () => {
    expect(availableCourses(makeState())).toEqual([]);
  });

  it('offers every skill a built school teaches', () => {
    const courses = availableCourses(makeState([['driving_center', 1]]));
    expect(courses.map(c => c.skill).sort()).toEqual(
      ['driving.drill_rig', 'driving.excavator', 'driving.truck'],
    );
  });

  it('picks the highest-tier school for a skill, since it teaches faster', () => {
    const state = makeState([['geology_lab', 1], ['geology_lab', 3]]);
    const course = availableCourses(state).find(c => c.skill === 'geology')!;
    expect(course.building.tier).toBe(3);
  });

  it('ignores buildings that teach nothing', () => {
    expect(availableCourses(makeState([['freight_warehouse', 1]]))).toEqual([]);
  });
});

describe('makeTrainingSection', () => {
  it('says why there is nothing to do when no school is built', () => {
    const el = makeTrainingSection(makeEmployee(), makeState(), undefined);
    expect(trainButtons(el)).toHaveLength(0);
    expect(el.querySelector('.bs-training-status')!.textContent)
      .toContain('No training building');
  });

  it('offers a usable Train button for a licence the employee lacks', () => {
    const el = makeTrainingSection(makeEmployee(), makeState([['driving_center', 1]]), undefined);
    const excavator = trainButtons(el).find(b => b.dataset['skill'] === 'driving.excavator');
    expect(excavator).toBeDefined();
    expect(excavator!.disabled).toBe(false);
  });

  it('shows the fee and duration so the price is not a surprise', () => {
    const el = makeTrainingSection(makeEmployee(), makeState([['driving_center', 1]]), undefined);
    expect(el.textContent).toMatch(/\$\d+/);
    expect(el.textContent).toMatch(/\d+t/);
  });

  it('shows a held skill as a promotion to the next level', () => {
    const el = makeTrainingSection(makeEmployee(), makeState([['driving_center', 1]]), undefined);
    expect(el.textContent).toContain('driving.truck 1→2');
  });

  it('disables Train when the site cannot afford the course', () => {
    const state = makeState([['driving_center', 1]]);
    state.cash = 1;
    const el = makeTrainingSection(makeEmployee(), state, undefined);
    expect(trainButtons(el).every(b => b.disabled)).toBe(true);
  });

  it('disables Train for an injured employee and says so', () => {
    const el = makeTrainingSection(
      makeEmployee({ injured: true }), makeState([['driving_center', 1]]), undefined,
    );
    expect(trainButtons(el).every(b => b.disabled)).toBe(true);
    expect(el.textContent).toContain('Injured');
  });

  it('reports progress instead of offering a course while training', () => {
    const el = makeTrainingSection(
      makeEmployee({ trainingState: { buildingId: 1, skill: 'driving.excavator', ticksRemaining: 7, fee: 2500 } }),
      makeState([['driving_center', 1]]),
      undefined,
    );
    expect(trainButtons(el)).toHaveLength(0);
    expect(el.textContent).toContain('driving.excavator');
    expect(el.textContent).toContain('7');
  });

  it('disables a course the employee has already mastered', () => {
    const el = makeTrainingSection(
      makeEmployee({ qualifications: [{ category: 'driving.truck', proficiencyLevel: 5, xp: 0 }] }),
      makeState([['driving_center', 1]]),
      undefined,
    );
    const truck = trainButtons(el).find(b => b.dataset['skill'] === 'driving.truck')!;
    expect(truck.disabled).toBe(true);
    expect(el.textContent).toContain('Master');
  });

  it('issues the train command naming the employee, skill and school', () => {
    const sent: string[] = [];
    const state = makeState([['driving_center', 1]]);
    const buildingId = state.buildings.buildings[0]!.id;
    const el = makeTrainingSection(makeEmployee({ id: 3 }), state, cmd => sent.push(cmd));

    trainButtons(el).find(b => b.dataset['skill'] === 'driving.drill_rig')!.click();

    expect(sent).toEqual([`employee train 3 skill:driving.drill_rig building:${buildingId}`]);
  });

  it('a disabled button sends nothing', () => {
    const sent: string[] = [];
    const state = makeState([['driving_center', 1]]);
    state.cash = 1;
    const el = makeTrainingSection(makeEmployee(), state, cmd => sent.push(cmd));

    for (const btn of trainButtons(el)) btn.click();

    expect(sent).toEqual([]);
  });
});
