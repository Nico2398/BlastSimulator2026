import { describe, it, expect } from 'vitest';
import {
  createScoreState,
  updateScores,
  recordAccident,
  recordVibration,
  recordSafetyInvestment,
  type ScoreInputs,
} from '../../../src/core/scores/ScoreManager.js';
import {
  createBuildingState,
  placeBuilding,
} from '../../../src/core/entities/Building.js';

function makeInputs(overrides: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    buildings: createBuildingState(),
    avgMorale: 50,
    recentAccidents: 0,
    hasSafetyEquipment: false,
    maxRecentVibration: 0,
    employeeCount: 0,
    ...overrides,
  };
}

describe('Score system', () => {
  it('initial scores are at a neutral starting point (50)', () => {
    const state = createScoreState();
    expect(state.wellBeing).toBe(50);
    expect(state.safety).toBe(50);
    expect(state.ecology).toBe(50);
    expect(state.nuisance).toBe(50);
  });

  it('building worker quarters increases well-being', () => {
    const state = createScoreState();
    const buildings = createBuildingState();
    placeBuilding(buildings, 'worker_quarters', 0, 0, 64, 64);

    updateScores(state, makeInputs({ buildings }));
    // Well-being should increase (building effect > decay)
    // With scoreEffect of 2, delta = 2*0.1 = 0.2, then decay of 0.05 → net +0.15
    expect(state.wellBeing).toBeGreaterThan(50);
  });

  it('an accident decreases safety score', () => {
    const state = createScoreState();
    const orig = state.safety;

    recordAccident(state);
    expect(state.safety).toBeLessThan(orig);
  });

  it('blast vibrations decrease nuisance score', () => {
    const state = createScoreState();
    const orig = state.nuisance;

    recordVibration(state, 50); // 50 mm/s vibration
    expect(state.nuisance).toBeLessThan(orig);
  });

  it('investing in safety equipment increases safety score', () => {
    const state = createScoreState();
    const orig = state.safety;

    recordSafetyInvestment(state, 2000);
    expect(state.safety).toBeGreaterThan(orig);
  });

  it('scores are clamped to 0-100', () => {
    const state = createScoreState();

    // Drive safety to 0
    for (let i = 0; i < 20; i++) recordAccident(state);
    expect(state.safety).toBe(0);

    // Drive safety high
    for (let i = 0; i < 30; i++) recordSafetyInvestment(state, 5000);
    expect(state.safety).toBe(100);
  });
});
