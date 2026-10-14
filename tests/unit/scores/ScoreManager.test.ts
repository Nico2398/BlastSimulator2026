import { describe, it, expect } from 'vitest';
import {
  createScoreState,
  updateScores,
  recordAccident,
  recordVibration,
  recordSafetyInvestment,
  clampScore,
  type ScoreInputs,
} from '../../../src/core/scores/ScoreManager.js';
import {
  createBuildingState,
  placeBuilding,
  getBuildingDef,
} from '../../../src/core/entities/Building.js';
import {
  ECOLOGY_DUST_MAX_PER_TICK,
  ECOLOGY_DUST_PER_TONNE_PER_TICK,
  STAR_ECOLOGY_MIN,
} from '../../../src/core/config/balance.js';

function makeInputs(overrides: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    buildings: createBuildingState(),
    avgMorale: 50,
    recentAccidents: 0,
    hasSafetyEquipment: false,
    maxRecentVibration: 0,
    employeeCount: 0,
    looseRockKg: 0,
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

  it('recent vibrations lower the neighbour-relations score on a tick (#1405)', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ maxRecentVibration: 50 }));
    expect(state.nuisance).toBeLessThan(50);
  });

  it('a positive buildingEffects.nuisance raises the neighbour-relations score (#1405)', () => {
    const buildings = createBuildingState();
    placeBuilding(buildings, 'living_quarters', 0, 0, 64, 64);
    const def = getBuildingDef('living_quarters', 1);
    const original = { ...def.scoreEffects };
    try {
      def.scoreEffects = { ...original, nuisance: 20 };
      const state = createScoreState();
      updateScores(state, makeInputs({ buildings }));
      expect(state.nuisance).toBeGreaterThan(50);
    } finally {
      def.scoreEffects = original;
    }
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

// ── clampScore (#710) ─────────────────────────────────────────────────────
// Shared 0-100 clamp helper. EventResolver.applyConsequence is expected to
// call this same symbol instead of its own inline
// `Math.max(0, Math.min(100, ...))`, so this is the single place the clamp's
// boundary behavior is pinned.
describe('clampScore', () => {
  it('clamps a value below the floor to 0', () => {
    expect(clampScore(-5)).toBe(0);
  });

  it('clamps a value above the ceiling to 100', () => {
    expect(clampScore(150)).toBe(100);
  });

  it('leaves the exact floor (0) unchanged', () => {
    expect(clampScore(0)).toBe(0);
  });

  it('leaves the exact ceiling (100) unchanged', () => {
    expect(clampScore(100)).toBe(100);
  });

  it('passes a mid-range value through unchanged', () => {
    expect(clampScore(45)).toBe(45);
  });

  it('clamps a fractional value just above the ceiling to 100', () => {
    expect(clampScore(100.0001)).toBe(100);
  });
});

// ── Ecology levers (#1691) ────────────────────────────────────────────────
describe('ecology responds to how the mine is run (#1691)', () => {
  function withHeap(active = true) {
    const buildings = createBuildingState();
    placeBuilding(buildings, 'spoil_heap', 0, 0, 64, 64);
    if (!active) {
      const placed = buildings.buildings.find(x => x.type === 'spoil_heap')!;
      placed.active = false;
    }
    return buildings;
  }
  const dust = (kg: number) => Math.min(ECOLOGY_DUST_MAX_PER_TICK, (kg / 1000) * ECOLOGY_DUST_PER_TONNE_PER_TICK);

  it('an active spoil heap raises ecology above 50 (about +0.15 net after one call)', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ buildings: withHeap() }));
    expect(state.ecology).toBeGreaterThan(50.1);
    expect(state.ecology).toBeLessThan(50.25);
  });

  it('an inactive spoil heap gives no ecology', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ buildings: withHeap(false) }));
    expect(state.ecology).toBeLessThanOrEqual(50);
  });

  it('two heaps stack more than one', () => {
    const one = createScoreState();
    updateScores(one, makeInputs({ buildings: withHeap() }));
    const buildings = withHeap();
    placeBuilding(buildings, 'spoil_heap', 10, 10, 64, 64);
    const two = createScoreState();
    updateScores(two, makeInputs({ buildings }));
    expect(two.ecology).toBeGreaterThan(one.ecology);
  });

  it('57 t of loose rock with no heap lowers ecology below 50', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ looseRockKg: 57_000 }));
    expect(state.ecology).toBeLessThan(50);
    expect(50 - state.ecology).toBeGreaterThanOrEqual(dust(57_000) - 0.06);
  });

  it('loose-rock loss never exceeds the per-tick cap, even for 1e9 kg', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ looseRockKg: 1e9 }));
    expect(state.ecology).toBeLessThan(50);
    expect(50 - state.ecology).toBeLessThanOrEqual(ECOLOGY_DUST_MAX_PER_TICK + 0.06);
  });

  it.each([0, -500, Number.NaN, Number.POSITIVE_INFINITY])('looseRockKg %s causes no dust loss and no NaN', (kg) => {
    const state = createScoreState();
    updateScores(state, makeInputs({ looseRockKg: kg }));
    const ref = createScoreState();
    updateScores(ref, makeInputs());
    if (kg === Number.POSITIVE_INFINITY) {
      expect(Number.isNaN(state.ecology)).toBe(false);
      return;
    }
    expect(state.ecology).toBe(ref.ecology);
  });

  it('heap plus rubble rises less than a heap alone, and more rubble means less', () => {
    const clean = createScoreState();
    const ten = createScoreState();
    const big = createScoreState();
    for (let i = 0; i < 20; i++) {
      updateScores(clean, makeInputs({ buildings: withHeap() }));
      updateScores(ten, makeInputs({ buildings: withHeap(), looseRockKg: 10_000 }));
      updateScores(big, makeInputs({ buildings: withHeap(), looseRockKg: 57_000 }));
    }
    expect(ten.ecology).toBeGreaterThan(50);
    expect(ten.ecology).toBeLessThan(clean.ecology);
    expect(big.ecology).toBeLessThan(ten.ecology);
  });

  it('heap with no rubble reaches the ecology star threshold within 100 ticks', () => {
    const state = createScoreState();
    const buildings = withHeap();
    for (let i = 0; i < 100; i++) updateScores(state, makeInputs({ buildings }));
    expect(state.ecology).toBeGreaterThanOrEqual(STAR_ECOLOGY_MIN);
  });

  it('ecology pinned at exactly 0 is not lifted by a heap', () => {
    const state = createScoreState();
    state.ecology = 0;
    updateScores(state, makeInputs({ buildings: withHeap() }));
    expect(state.ecology).toBe(0);
  });

  it('ecology at 0 stays 0 under dust', () => {
    const state = createScoreState();
    state.ecology = 0;
    updateScores(state, makeInputs({ looseRockKg: 57_000 }));
    expect(state.ecology).toBe(0);
  });

  it('ecology at 0.1 with a heap still rises', () => {
    const state = createScoreState();
    state.ecology = 0.1;
    updateScores(state, makeInputs({ buildings: withHeap() }));
    expect(state.ecology).toBeGreaterThan(0.1);
  });
});
