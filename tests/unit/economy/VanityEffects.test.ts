// BlastSimulator2026 — One-time effects of vanity projects on completion (#1947)

import { describe, it, expect } from 'vitest';
import { applyVanityCompletion } from '../../../src/core/economy/VanityEffects.js';
import { createBoardState } from '../../../src/core/economy/Board.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { BOARD_CONFIDENCE_MAX } from '../../../src/core/config/balance.js';
import type { VanityType } from '../../../src/core/entities/BuildingVanity.js';
import type { GameState } from '../../../src/core/state/GameState.js';

type Fixture = Pick<GameState, 'board' | 'scores' | 'employees'>;

function fixture(opts: { board?: boolean; crew?: number } = {}): Fixture {
  const rng = new Random(42);
  const employees = createEmployeeState();
  for (let i = 0; i < (opts.crew ?? 3); i++) hireEmployee(employees, 'driller', rng);
  const board = opts.board === false ? undefined : createBoardState({ quarterTicks: 100, oreTargetT: 10, profitTarget: 1000 }, 0);
  if (board) board.confidence = 30;
  return { ...(board ? { board } : {}), scores: createScoreState(), employees };
}

describe('applyVanityCompletion (#1947)', () => {
  it.each<[VanityType, number]>([
    ['ceo_statue', 10],
    ['golf_course', 20],
    ['executive_helipad', 30],
    ['gold_tower', 50],
  ])('%s raises board confidence by %i', (type, gain) => {
    const s = fixture();
    applyVanityCompletion(s, type);
    expect(s.board!.confidence).toBe(Math.min(BOARD_CONFIDENCE_MAX, 30 + gain));
  });

  it('clamps board confidence at its maximum', () => {
    const s = fixture();
    s.board!.confidence = BOARD_CONFIDENCE_MAX - 1;
    applyVanityCompletion(s, 'gold_tower');
    expect(s.board!.confidence).toBe(BOARD_CONFIDENCE_MAX);
  });

  it('statue dips morale of every living employee by 2, once', () => {
    const s = fixture({ crew: 3 });
    const before = s.employees.employees.map(e => e.morale);
    applyVanityCompletion(s, 'ceo_statue');
    s.employees.employees.forEach((e, i) => expect(e.morale).toBe(before[i]! - 2));
  });

  it('statue leaves the dead untouched', () => {
    const s = fixture({ crew: 2 });
    s.employees.employees[1]!.alive = false;
    const dead = s.employees.employees[1]!.morale;
    applyVanityCompletion(s, 'ceo_statue');
    expect(s.employees.employees[1]!.morale).toBe(dead);
  });

  it('statue clamps morale at 0', () => {
    const s = fixture({ crew: 2 });
    s.employees.employees[0]!.morale = 1;
    s.employees.employees[1]!.morale = 0;
    applyVanityCompletion(s, 'ceo_statue');
    expect(s.employees.employees[0]!.morale).toBe(0);
    expect(s.employees.employees[1]!.morale).toBe(0);
  });

  it('statue does not touch scores', () => {
    const s = fixture();
    applyVanityCompletion(s, 'ceo_statue');
    expect(s.scores).toEqual(createScoreState());
  });

  it('golf course raises ecology by 2 and leaves morale alone', () => {
    const s = fixture();
    const morale = s.employees.employees.map(e => e.morale);
    applyVanityCompletion(s, 'golf_course');
    expect(s.scores.ecology).toBe(52);
    expect(s.employees.employees.map(e => e.morale)).toEqual(morale);
  });

  it('helipad lowers neighbour relations (nuisance) by 3', () => {
    const s = fixture();
    applyVanityCompletion(s, 'executive_helipad');
    expect(s.scores.nuisance).toBe(47);
    expect(s.scores.wellBeing).toBe(50);
  });

  it('tower lowers neighbour relations by 5 and well-being by 2', () => {
    const s = fixture();
    applyVanityCompletion(s, 'gold_tower');
    expect(s.scores.nuisance).toBe(45);
    expect(s.scores.wellBeing).toBe(48);
  });

  it('score deltas clamp at 0 and 100', () => {
    const s = fixture();
    s.scores.nuisance = 2;
    s.scores.wellBeing = 1;
    applyVanityCompletion(s, 'gold_tower');
    expect(s.scores.nuisance).toBe(0);
    expect(s.scores.wellBeing).toBe(0);
    s.scores.ecology = 99;
    applyVanityCompletion(s, 'golf_course');
    expect(s.scores.ecology).toBe(100);
  });

  it('without a board it does not throw and still applies the scores', () => {
    const s = fixture({ board: false });
    expect(() => applyVanityCompletion(s, 'gold_tower')).not.toThrow();
    expect(s.board).toBeUndefined();
    expect(s.scores.nuisance).toBe(45);
  });

  it('an empty roster is fine', () => {
    const s = fixture({ crew: 0 });
    expect(() => applyVanityCompletion(s, 'ceo_statue')).not.toThrow();
    expect(s.board!.confidence).toBe(40);
  });
});
