// BlastSimulator2026 — CH1.4 Red-phase tests: Employee skill qualifications & training
//
// Covers: SkillQualification, TrainingState, assignSkill, startTraining, tickTraining
//
// WHY THESE TESTS FAIL (Red phase):
//   Employee.ts does not yet export assignSkill, startTraining, tickTraining,
//   SkillCategory, SkillQualification, or TrainingState.  Vitest/esbuild will
//   import the existing Employee module and the missing named exports will be
//   `undefined` at runtime.  Every test that calls these functions therefore
//   throws  "TypeError: X is not a function".
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEmployeeState,
  hireEmployee,
  type EmployeeState,
  // ── New exports (CH1.4 — not yet implemented in Employee.ts) ────────────────
  assignSkill,
  startTraining,
  tickTraining,
} from '../../../src/core/entities/Employee.js';
import type {
  SkillCategory,
  SkillQualification,
  TrainingState,
} from '../../../src/core/entities/Employee.js';

// ── Deterministic fixture helpers ────────────────────────────────────────────

const SEED = 42;

/** Return a fresh EmployeeState with one hired employee (id = 1). */
function makeStateWithOne(): { state: EmployeeState; empId: number } {
  const state = createEmployeeState();
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state, 'driller', rng);
  return { state, empId: employee.id };
}

// ── Section 1: New fields present on a newly hired employee ──────────────────

describe('Employee — new fields after hireEmployee (CH1.4)', () => {
  it('newly hired employee starts with an empty qualifications array', () => {
    const { state, empId } = makeStateWithOne();
    const emp = state.employees.find(e => e.id === empId)!;
    // qualifications must be an initialised empty array, not undefined
    expect((emp as any).qualifications).toEqual([]);
  });

  it('newly hired employee starts with trainingState === null', () => {
    const { state, empId } = makeStateWithOne();
    const emp = state.employees.find(e => e.id === empId)!;
    // trainingState must be explicitly null (not undefined)
    expect((emp as any).trainingState).toBeNull();
  });
});

// ── Section 2: assignSkill ───────────────────────────────────────────────────

describe('assignSkill', () => {
  let state: EmployeeState;
  let empId: number;

  beforeEach(() => {
    ({ state, empId } = makeStateWithOne());
  });

  it('adds a new qualification when the employee has none', () => {
    const ok = assignSkill(state, empId, 'blasting' as SkillCategory, 1);
    expect(ok).toBe(true);

    const quals: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    expect(quals).toHaveLength(1);
    expect(quals[0]!.category).toBe('blasting');
    expect(quals[0]!.proficiencyLevel).toBe(1);
  });

  it('initialises xp to 0 when a qualification is first added', () => {
    assignSkill(state, empId, 'geology' as SkillCategory, 2);

    const quals: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    expect(quals[0]!.xp).toBe(0);
  });

  it('replaces (does not duplicate) an existing qualification for the same category', () => {
    assignSkill(state, empId, 'blasting' as SkillCategory, 1);
    assignSkill(state, empId, 'blasting' as SkillCategory, 3);

    const quals: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    const entries = quals.filter((q: SkillQualification) => q.category === 'blasting');
    // Must be replaced, not appended — exactly one entry
    expect(entries).toHaveLength(1);
    expect(entries[0]!.proficiencyLevel).toBe(3);
  });

  it('preserves unrelated qualifications when replacing one category', () => {
    assignSkill(state, empId, 'geology' as SkillCategory, 1);
    assignSkill(state, empId, 'blasting' as SkillCategory, 2);
    // Overwrite blasting; geology must be untouched
    assignSkill(state, empId, 'blasting' as SkillCategory, 4);

    const quals: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    expect(quals).toHaveLength(2);
    expect(quals.find((q: SkillQualification) => q.category === 'geology')).toBeDefined();
    expect(quals.find((q: SkillQualification) => q.category === 'blasting')!.proficiencyLevel).toBe(4);
  });

  it('accepts all six SkillCategory values without error', () => {
    const categories: SkillCategory[] = [
      'driving.truck', 'driving.excavator', 'driving.drill_rig',
      'blasting', 'management', 'geology',
    ] as SkillCategory[];
    for (const cat of categories) {
      expect(assignSkill(state, empId, cat, 1)).toBe(true);
    }
    const quals: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    expect(quals).toHaveLength(6);
  });

  it('returns false when the employee id does not exist', () => {
    const result = assignSkill(state, 9999, 'management' as SkillCategory, 1);
    expect(result).toBe(false);
  });

  it('does not modify state when given a non-existent employee id', () => {
    const before = state.employees.length;
    assignSkill(state, 9999, 'geology' as SkillCategory, 1);
    expect(state.employees.length).toBe(before);
  });
});

// ── Section 3: startTraining ─────────────────────────────────────────────────

describe('startTraining', () => {
  let state: EmployeeState;
  let empId: number;

  beforeEach(() => {
    ({ state, empId } = makeStateWithOne());
  });

  it('returns success:true and the fee when called with valid parameters', () => {
    const result = startTraining(state, empId, 10, 'blasting' as SkillCategory, 20, 500);
    expect(result.success).toBe(true);
    expect(result.fee).toBe(500);
  });

  it('sets trainingState on the employee immediately', () => {
    startTraining(state, empId, 7, 'geology' as SkillCategory, 15, 300);

    const ts: TrainingState = (state.employees.find(e => e.id === empId) as any).trainingState;
    expect(ts).not.toBeNull();
  });

  it('trainingState contains the exact buildingId, skill, ticksRemaining, and fee supplied', () => {
    startTraining(state, empId, 7, 'geology' as SkillCategory, 15, 300);

    const ts: TrainingState = (state.employees.find(e => e.id === empId) as any).trainingState;
    expect(ts.buildingId).toBe(7);
    expect(ts.skill).toBe('geology');
    expect(ts.ticksRemaining).toBe(15);
    expect(ts.fee).toBe(300);
  });

  it('returns error and preserves the original trainingState when employee is already in training', () => {
    startTraining(state, empId, 1, 'blasting' as SkillCategory, 10, 200);
    const second = startTraining(state, empId, 2, 'geology' as SkillCategory, 10, 200);

    expect(second.success).toBe(false);
    expect(second.error).toBeDefined();

    // First session must be preserved — skill and buildingId are unchanged
    const ts: TrainingState = (state.employees.find(e => e.id === empId) as any).trainingState;
    expect(ts.skill).toBe('blasting');
    expect(ts.buildingId).toBe(1);
  });

  it('returns error when the employee id does not exist', () => {
    const result = startTraining(state, 9999, 1, 'management' as SkillCategory, 10, 100);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── Section 4: tickTraining ──────────────────────────────────────────────────

describe('tickTraining', () => {
  let state: EmployeeState;
  let empId: number;

  beforeEach(() => {
    ({ state, empId } = makeStateWithOne());
  });

  it('decrements ticksRemaining by exactly 1 per tick', () => {
    startTraining(state, empId, 1, 'blasting' as SkillCategory, 5, 100);
    tickTraining(state);

    const ts: TrainingState = (state.employees.find(e => e.id === empId) as any).trainingState;
    expect(ts.ticksRemaining).toBe(4);
  });

  it('does not alter employees who are not in training', () => {
    const rng2 = new Random(SEED + 1);
    const { employee: emp2 } = hireEmployee(state, 'blaster', rng2);
    // emp2 has no training — tickTraining must not touch emp2
    tickTraining(state);

    const ts2: TrainingState | null = (state.employees.find(e => e.id === emp2.id) as any).trainingState;
    expect(ts2).toBeNull();
  });

  it('grants the qualification and sets trainingState to null when ticksRemaining reaches 0', () => {
    startTraining(state, empId, 1, 'blasting' as SkillCategory, 1, 100);
    tickTraining(state); // 1 → 0 → complete

    const emp = state.employees.find(e => e.id === empId)!;
    const ts: TrainingState | null = (emp as any).trainingState;
    const quals: SkillQualification[] = (emp as any).qualifications;

    expect(ts).toBeNull();
    expect(quals.some((q: SkillQualification) => q.category === 'blasting')).toBe(true);
  });

  it('granted qualification has proficiencyLevel 1 when employee had no prior qualification', () => {
    startTraining(state, empId, 1, 'blasting' as SkillCategory, 1, 100);
    tickTraining(state);

    const quals: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    const blasting = quals.find((q: SkillQualification) => q.category === 'blasting')!;
    expect(blasting.proficiencyLevel).toBe(1);
  });

  it('granted qualification has xp initialised to 0', () => {
    startTraining(state, empId, 1, 'blasting' as SkillCategory, 1, 100);
    tickTraining(state);

    const quals: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    const blasting = quals.find((q: SkillQualification) => q.category === 'blasting')!;
    expect(blasting.xp).toBe(0);
  });

  it('does not complete training early — qualification is absent while ticksRemaining > 0', () => {
    startTraining(state, empId, 1, 'management' as SkillCategory, 3, 200);
    tickTraining(state); // 3 → 2
    tickTraining(state); // 2 → 1  (still in progress)

    const emp = state.employees.find(e => e.id === empId)!;
    const quals: SkillQualification[] = (emp as any).qualifications;
    const ts: TrainingState = (emp as any).trainingState;

    expect(quals.some((q: SkillQualification) => q.category === 'management')).toBe(false);
    expect(ts).not.toBeNull();
    expect(ts.ticksRemaining).toBe(1);
  });

  it('processes multiple employees in training in the same tick', () => {
    const rng2 = new Random(SEED + 1);
    const { employee: emp2 } = hireEmployee(state, 'blaster', rng2);

    startTraining(state, empId,  1, 'blasting' as SkillCategory, 1, 100);
    startTraining(state, emp2.id, 2, 'geology'  as SkillCategory, 1, 150);
    tickTraining(state); // should complete both

    const quals1: SkillQualification[] = (state.employees.find(e => e.id === empId) as any).qualifications;
    const quals2: SkillQualification[] = (state.employees.find(e => e.id === emp2.id) as any).qualifications;

    expect(quals1.some((q: SkillQualification) => q.category === 'blasting')).toBe(true);
    expect(quals2.some((q: SkillQualification) => q.category === 'geology')).toBe(true);
  });
});

// ── Section 5: End-to-end training flow per SkillCategory ────────────────────
//   Acceptance criterion: "All four training buildings grant correct skills"
//   startTraining takes an explicit skill and a buildingId (number), so we
//   exercise every SkillCategory across all four logical building types.

describe('training end-to-end — all SkillCategory values (four building types)', () => {
  const TRAINING_CASES: Array<{
    label: string;
    skill: string;      // use string; SkillCategory type is stripped by esbuild
    buildingId: number; // representative id for each building type
  }> = [
    // driving_center covers three driving sub-skills
    { label: 'driving_center → driving.truck',      skill: 'driving.truck',      buildingId: 101 },
    { label: 'driving_center → driving.excavator',  skill: 'driving.excavator',  buildingId: 101 },
    { label: 'driving_center → driving.drill_rig',  skill: 'driving.drill_rig',  buildingId: 101 },
    // one skill per remaining building type
    { label: 'blasting_academy → blasting',         skill: 'blasting',           buildingId: 201 },
    { label: 'management_office → management',      skill: 'management',         buildingId: 301 },
    { label: 'geology_lab → geology',               skill: 'geology',            buildingId: 401 },
  ];

  for (const { label, skill, buildingId } of TRAINING_CASES) {
    it(`grants qualification after duration elapses: ${label}`, () => {
      const state = createEmployeeState();
      const rng = new Random(SEED);
      const { employee } = hireEmployee(state, 'driller', rng);

      const result = startTraining(state, employee.id, buildingId, skill as SkillCategory, 2, 250);
      expect(result.success).toBe(true);

      tickTraining(state); // tick 1: 2 → 1
      tickTraining(state); // tick 2: 1 → 0 → complete

      const emp = state.employees.find(e => e.id === employee.id)!;
      const quals: SkillQualification[] = (emp as any).qualifications;
      const ts: TrainingState | null = (emp as any).trainingState;

      expect(quals.some((q: SkillQualification) => q.category === skill)).toBe(true);
      expect(ts).toBeNull();
    });
  }
});
