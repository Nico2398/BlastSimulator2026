import { describe, it, expect } from 'vitest';
import {
  createScoreState,
  updateScores,
  recordAccident,
  recordVibration,
  recordSafetyInvestment,
  reassertFloorIfCrisisActive,
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

  it('building living quarters increases well-being', () => {
    const state = createScoreState();
    const buildings = createBuildingState();
    placeBuilding(buildings, 'living_quarters', 0, 0, 64, 64);

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

// #698: interaction mode's own tick trajectory can diverge from command
// mode's after a fatal blast (different real-time timing means a positive
// -safety lawsuit event, gated on deathCount>=1 for the rest of the level,
// can resolve outside the 10-tick accident-protection window in one mode but
// not the other). `EventResolver.applyConsequence`'s own unconditional
// `Math.max(0, Math.min(100, ...))` clamp bypasses `applyDecay`'s floor pin
// when that happens, permanently un-pinning `safety` from 0 in exactly one
// mode and leaving the two modes' final `safety` value to disagree — command
// mode observed pinned at exactly 0.0 through the rest of the run on this
// seed, interaction mode observed drifting back up (18.60999999999997) once
// an event nudged it off the floor at tick 291. `reassertFloorIfCrisisActive`
// is meant to make that floor authoritative regardless of which external
// code last touched `safety`, independent of the exact tick alignment.
describe('reassertFloorIfCrisisActive', () => {
  it('re-pins safety to 0 when a crisis (recent accidents) is still active, even after an external mutation raised it', () => {
    const state = createScoreState();
    state.safety = 0; // driven to the floor by the accident-tick decay
    state.safety = 18.60999999999997; // e.g. EventResolver's own unconditional clamp nudged it up

    reassertFloorIfCrisisActive(state, 4); // 4 accidents still within the crisis window

    expect(state.safety).toBe(0);
  });

  it('leaves safety alone once the crisis has just expired (no recent accidents) — an external mutation stands', () => {
    const state = createScoreState();
    state.safety = 18.60999999999997; // e.g. a resolved lawsuit event's positive delta

    reassertFloorIfCrisisActive(state, 0); // crisis window has closed

    expect(state.safety).toBe(18.60999999999997);
  });

  it('is a no-op when there have never been any accidents — an event delta applies and stays untouched', () => {
    const state = createScoreState();
    state.safety = 62; // e.g. a positive political-favor event, no accident ever recorded

    reassertFloorIfCrisisActive(state, 0);

    expect(state.safety).toBe(62);
  });

  it('never touches the other three scores, even while a crisis is active', () => {
    const state = createScoreState();
    state.wellBeing = 30;
    state.ecology = 70;
    state.nuisance = 40;
    state.safety = 12; // off the floor, crisis still active

    reassertFloorIfCrisisActive(state, 2);

    expect(state.safety).toBe(0);
    expect(state.wellBeing).toBe(30);
    expect(state.ecology).toBe(70);
    expect(state.nuisance).toBe(40);
  });
});
