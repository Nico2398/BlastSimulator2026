import { describe, it, expect } from 'vitest';
import {
  createScoreState,
  updateScores,
  recordAccident,
  recordVibration,
  recordSafetyInvestment,
  clampScore,
  safetyTarget,
  type ScoreInputs,
} from '../../../src/core/scores/ScoreManager.js';
import { computeCrewFatigueStrain } from '../../../src/core/entities/EmployeeNeeds.js';
import {
  createBuildingState,
  placeBuilding,
  getBuildingDef,
} from '../../../src/core/entities/Building.js';
import {
  ECOLOGY_DUST_PER_TONNE_PER_TICK,
  ECOLOGY_DUST_SETTLED_PER_TONNE_PER_TICK,
  ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS,
  STAR_ECOLOGY_MIN,
  SAFETY_TARGET_PER_EFFECT,
  SAFETY_EQUIPMENT_TARGET_BONUS,
  SAFETY_TARGET_MIN,
  SAFETY_TARGET_MAX,
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
    bedCapacity: 0,
    crewFatigueStrain: 0,
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

// ── Ecology levers (#1691, settling dust #1733) ───────────────────────────
describe('ecology responds to how the mine is run (#1691, #1733)', () => {
  function withHeaps(count = 1, active = true) {
    const buildings = createBuildingState();
    for (let i = 0; i < count; i++) {
      placeBuilding(buildings, 'spoil_heap', i * 12, i * 12, 64, 64);
    }
    if (!active) for (const b of buildings.buildings) b.active = false;
    return buildings;
  }
  const T = 1000; // kg per tonne

  it('an active spoil heap raises ecology above 50 (about +0.15 net after one call)', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ buildings: withHeaps() }));
    expect(state.ecology).toBeGreaterThan(50.1);
    expect(state.ecology).toBeLessThan(50.25);
  });

  it('an inactive spoil heap gives no ecology', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ buildings: withHeaps(1, false) }));
    expect(state.ecology).toBe(50);
  });

  it('two heaps stack more than one', () => {
    const one = createScoreState();
    updateScores(one, makeInputs({ buildings: withHeaps(1) }));
    const two = createScoreState();
    updateScores(two, makeInputs({ buildings: withHeaps(2) }));
    expect(two.ecology).toBeGreaterThan(one.ecology);
  });

  it('57 t of fresh loose rock with no heap lowers ecology below 50', () => {
    const state = createScoreState(0); // decay off: a 57 t pulse (~0.01/tick) is below the 0.05 pull toward 50
    updateScores(state, makeInputs({ looseRockKg: 57 * T }));
    expect(state.ecology).toBeLessThan(50);
  });

  it.each([0, -500, Number.NaN, Number.POSITIVE_INFINITY])('looseRockKg %s causes no dust loss and no NaN', (kg) => {
    const state = createScoreState();
    updateScores(state, makeInputs({ looseRockKg: kg }));
    const ref = createScoreState();
    updateScores(ref, makeInputs());
    expect(Number.isNaN(state.ecology)).toBe(false);
    expect(state.ecology).toBe(ref.ecology);
  });

  it.each([-500, Number.NaN, Number.POSITIVE_INFINITY])('looseRockKg %s leaves finite dust fields and a later real pile still works', (kg) => {
    const state = createScoreState(0);
    updateScores(state, makeInputs({ looseRockKg: kg }));
    expect(Number.isFinite(state.freshDustKg)).toBe(true);
    expect(state.lastLooseRockKg === undefined || Number.isFinite(state.lastLooseRockKg)).toBe(true);
    updateScores(state, makeInputs({ looseRockKg: 100 * T }));
    expect(Number.isNaN(state.ecology)).toBe(false);
    expect(Number.isFinite(state.freshDustKg)).toBe(true);
    expect(state.ecology).toBeLessThan(50);
  });

  it('heap plus 10 t rises, heap plus a 2,000 t pulse falls', () => {
    const ten = createScoreState();
    const big = createScoreState();
    const buildings = withHeaps();
    for (let i = 0; i < 20; i++) {
      updateScores(ten, makeInputs({ buildings, looseRockKg: 10 * T }));
      updateScores(big, makeInputs({ buildings, looseRockKg: 2000 * T }));
    }
    expect(ten.ecology).toBeGreaterThan(50);
    expect(big.ecology).toBeLessThan(50);
  });

  it('heap with no rubble reaches the ecology star threshold within 100 ticks', () => {
    const state = createScoreState();
    const buildings = withHeaps();
    for (let i = 0; i < 100; i++) updateScores(state, makeInputs({ buildings }));
    expect(state.ecology).toBeGreaterThanOrEqual(STAR_ECOLOGY_MIN);
  });

  it('ecology at 0.1 with a heap still rises', () => {
    const state = createScoreState();
    state.ecology = 0.1;
    updateScores(state, makeInputs({ buildings: withHeaps() }));
    expect(state.ecology).toBeGreaterThan(0.1);
  });

  describe('settling dust model (#1733)', () => {
    /** Ecology lost in one update from a neutral 50. Callers pass a decay-0 state so the pull toward 50 does not mask small losses. */
    function lossNow(state: ReturnType<typeof createScoreState>, kg: number): number {
      state.ecology = 50;
      updateScores(state, makeInputs({ looseRockKg: kg }));
      return 50 - state.ecology;
    }

    it('one active heap, start 100, a 2,000 t pulse, 600 ticks: never reaches 0 and dips visibly below 100', () => {
      const state = createScoreState();
      state.ecology = 100;
      const buildings = withHeaps();
      let min = 100;
      for (let i = 0; i < 600; i++) {
        updateScores(state, makeInputs({ buildings, looseRockKg: 2000 * T }));
        min = Math.min(min, state.ecology);
      }
      expect(min).toBeGreaterThan(0);
      expect(min).toBeLessThan(99);
    });

    it('zero heaps, one 2,344 t pulse, no hauling: ecology reaches 0 and stays there', () => {
      const state = createScoreState();
      let reached = -1;
      for (let i = 0; i < 2500; i++) {
        updateScores(state, makeInputs({ looseRockKg: 2344 * T }));
        if (reached < 0 && state.ecology === 0) reached = i;
        if (reached >= 0) expect(state.ecology, `tick ${i}`).toBe(0);
      }
      expect(reached).toBeGreaterThanOrEqual(0);
    });

    it('a score at 0 with an active heap and no rubble rises above 0 on the next update', () => {
      const state = createScoreState();
      state.ecology = 0;
      updateScores(state, makeInputs({ buildings: withHeaps() }));
      expect(state.ecology).toBeGreaterThan(0);
    });

    it('a score at 0 with a net-positive delta (heap beats vibration) rises; a net-negative one stays 0', () => {
      const up = createScoreState();
      up.ecology = 0;
      updateScores(up, makeInputs({ buildings: withHeaps(), maxRecentVibration: 5 }));
      expect(up.ecology).toBeGreaterThan(0);
      const down = createScoreState();
      down.ecology = 0;
      updateScores(down, makeInputs({ buildings: withHeaps(), maxRecentVibration: 100 }));
      expect(down.ecology).toBe(0);
    });

    it('a score at 0 with rubble and no heap stays 0', () => {
      const state = createScoreState();
      state.ecology = 0;
      state.lastLooseRockKg = 57 * T;
      for (let i = 0; i < 20; i++) {
        updateScores(state, makeInputs({ looseRockKg: 57 * T }));
        expect(state.ecology).toBe(0);
      }
    });

    it('a score at 0 with nothing acting on it stays 0 (decay does not lift it)', () => {
      const state = createScoreState();
      state.ecology = 0;
      for (let i = 0; i < 10; i++) updateScores(state, makeInputs());
      expect(state.ecology).toBe(0);
    });

    it('loss has no cap: a 5,000 t pulse costs more than an 80 t pulse', () => {
      const small = lossNow(createScoreState(0), 80 * T);
      const big = lossNow(createScoreState(0), 5000 * T);
      expect(small).toBeGreaterThan(0);
      expect(big).toBeGreaterThan(small);
      expect(big).toBeGreaterThan(small * 10);
    });

    it('the first tick of a pulse costs the fresh rate per tonne', () => {
      const loss = lossNow(createScoreState(0), 1000 * T);
      expect(loss).toBeCloseTo(ECOLOGY_DUST_PER_TONNE_PER_TICK * 1000, 4);
    });

    it('freshDustKg halves after one half-life without hauling', () => {
      const state = createScoreState();
      const L = 2000 * T;
      updateScores(state, makeInputs({ looseRockKg: L }));
      expect(state.freshDustKg).toBeCloseTo(L, 3);
      for (let i = 0; i < ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS; i++) updateScores(state, makeInputs({ looseRockKg: L }));
      expect(state.freshDustKg).toBeGreaterThan(0.45 * L);
      expect(state.freshDustKg).toBeLessThan(0.55 * L);
    });

    it('after a pulse without hauling, loss decays toward the settled rate', () => {
      const state = createScoreState(0);
      const L = 2000 * T;
      const first = lossNow(state, L);
      for (let i = 0; i < 599; i++) lossNow(state, L);
      const later = lossNow(state, L); // 601 ticks after the pulse: ~4 half-lives
      const tonnes = L / 1000;
      const settledOnly = ECOLOGY_DUST_SETTLED_PER_TONNE_PER_TICK * tonnes;
      expect(later).toBeLessThan(first / 4);
      expect(later).toBeGreaterThan(settledOnly);
      const fresh = tonnes * 0.5 ** (600 / ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS);
      const expected = ECOLOGY_DUST_PER_TONNE_PER_TICK * fresh + ECOLOGY_DUST_SETTLED_PER_TONNE_PER_TICK * (tonnes - fresh);
      expect(later).toBeGreaterThan(expected * 0.9);
      expect(later).toBeLessThan(expected * 1.1);
    });

    it('dropping looseKg (hauling) lowers freshDustKg to at most looseKg', () => {
      const state = createScoreState();
      updateScores(state, makeInputs({ looseRockKg: 100 * T }));
      expect(state.freshDustKg).toBeGreaterThan(10 * T);
      updateScores(state, makeInputs({ looseRockKg: 10 * T }));
      expect(state.freshDustKg).toBeLessThanOrEqual(10 * T);
      expect(state.lastLooseRockKg).toBe(10 * T);
    });

    it('hauling is not a pulse: a falling pile only decays the fresh dust by the half-life', () => {
      const state = createScoreState();
      state.freshDustKg = 10 * T;
      state.lastLooseRockKg = 100 * T;
      updateScores(state, makeInputs({ looseRockKg: 80 * T }));
      const retention = 0.5 ** (1 / ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS);
      expect(state.freshDustKg).toBeCloseTo(10 * T * retention, 6);
    });

    it('a score at 0 with no heap lifts when hauling drops looseKg and a heap gain arrives', () => {
      const state = createScoreState(0);
      updateScores(state, makeInputs({ looseRockKg: 100 * T })); // settles state.lastLooseRockKg
      state.ecology = 0;
      updateScores(state, makeInputs({ buildings: withHeaps(4), looseRockKg: 0 }));
      expect(state.ecology, 'heap gain beats dust once the rubble is hauled away').toBeGreaterThan(0);
    });

    it('3 heaps with a 2,344 t blast pulse every 100 ticks and no hauling still reach 0 within 3000 ticks', () => {
      const state = createScoreState();
      state.ecology = 100;
      const buildings = withHeaps(3);
      let loose = 0;
      let zeroAt = -1;
      for (let i = 1; i <= 3000 && zeroAt < 0; i++) {
        if (i % 100 === 1) loose += 2344 * T;
        updateScores(state, makeInputs({ buildings, looseRockKg: loose }));
        if (state.ecology === 0) zeroAt = i;
      }
      expect(zeroAt).toBeGreaterThan(0);
    });

    it('3 heaps and a single 2,344 t pulse do not drain to 0 (heaps still help)', () => {
      const state = createScoreState();
      state.ecology = 100;
      const buildings = withHeaps(3);
      for (let i = 0; i < 1500; i++) {
        updateScores(state, makeInputs({ buildings, looseRockKg: 2344 * T }));
        expect(state.ecology).toBeGreaterThan(0);
      }
    });

    it('an undefined lastLooseRockKg (old save) makes no phantom pulse on the first update', () => {
      const state = createScoreState();
      state.lastLooseRockKg = undefined;
      state.freshDustKg = 0;
      updateScores(state, makeInputs({ looseRockKg: 2000 * T }));
      expect(state.freshDustKg).toBe(0);
      expect(50 - state.ecology).toBeLessThan(ECOLOGY_DUST_PER_TONNE_PER_TICK * 2000 / 2);
      expect(state.lastLooseRockKg).toBe(2000 * T);
    });

    it('a state missing both dust fields (old save shape) never yields NaN', () => {
      const state = createScoreState() as unknown as Record<string, unknown>;
      delete state['freshDustKg'];
      delete state['lastLooseRockKg'];
      const s = state as unknown as ReturnType<typeof createScoreState>;
      updateScores(s, makeInputs({ looseRockKg: 500 * T }));
      updateScores(s, makeInputs({ looseRockKg: 500 * T }));
      expect(Number.isNaN(s.ecology)).toBe(false);
      expect(Number.isFinite(s.freshDustKg)).toBe(true);
    });
  });
});

describe('Well-being model — headroom, overwork, crowding, accidents (#1692)', () => {
  function withQuarters(tier: 1 | 2 | 3) {
    const buildings = createBuildingState();
    buildings.unlockedTiers.living_quarters = 3;
    const res = placeBuilding(buildings, 'living_quarters', 0, 0, 64, 64, tier);
    expect(res.success).toBe(true);
    return buildings;
  }

  function settle(tier: 1 | 2 | 3, ticks = 1000, overrides: Partial<ScoreInputs> = {}): number {
    const state = createScoreState();
    const buildings = withQuarters(tier);
    for (let i = 0; i < ticks; i++) updateScores(state, makeInputs({ buildings, avgMorale: 70, ...overrides }));
    return state.wellBeing;
  }

  it('a crew larger than the beds loses well-being versus a smaller crew with the same T1 quarters', () => {
    const buildings = withQuarters(1);
    const small = createScoreState();
    const crowded = createScoreState();
    for (let i = 0; i < 20; i++) {
      updateScores(small, makeInputs({ buildings, avgMorale: 70, employeeCount: 10, bedCapacity: 20 }));
      updateScores(crowded, makeInputs({ buildings, avgMorale: 70, employeeCount: 40, bedCapacity: 20 }));
    }
    expect(crowded.wellBeing).toBeLessThan(small.wellBeing);
  });

  it('crowding drag grows with the unhoused fraction of the crew', () => {
    const buildings = withQuarters(1);
    const mild = createScoreState();
    const severe = createScoreState();
    for (let i = 0; i < 20; i++) {
      updateScores(mild, makeInputs({ buildings, avgMorale: 70, employeeCount: 25, bedCapacity: 20 }));
      updateScores(severe, makeInputs({ buildings, avgMorale: 70, employeeCount: 80, bedCapacity: 20 }));
    }
    expect(severe.wellBeing).toBeLessThan(mild.wellBeing);
  });

  it('bedCapacity 0 applies no crowding drag however large the crew', () => {
    const a = createScoreState();
    const b = createScoreState();
    for (let i = 0; i < 20; i++) {
      updateScores(a, makeInputs({ avgMorale: 70, employeeCount: 0, bedCapacity: 0 }));
      updateScores(b, makeInputs({ avgMorale: 70, employeeCount: 50, bedCapacity: 0 }));
    }
    expect(b.wellBeing).toBeCloseTo(a.wellBeing, 10);
  });

  it('a crew exactly filling the beds suffers no crowding drag', () => {
    const buildings = withQuarters(1);
    const full = createScoreState();
    const empty = createScoreState();
    for (let i = 0; i < 20; i++) {
      updateScores(full, makeInputs({ buildings, avgMorale: 70, employeeCount: 20, bedCapacity: 20 }));
      updateScores(empty, makeInputs({ buildings, avgMorale: 70, employeeCount: 0, bedCapacity: 20 }));
    }
    expect(full.wellBeing).toBeCloseTo(empty.wellBeing, 10);
  });

  it('crewFatigueStrain 0.5 loses well-being versus 0', () => {
    const buildings = withQuarters(1);
    const rested = createScoreState();
    const tired = createScoreState();
    for (let i = 0; i < 20; i++) {
      updateScores(rested, makeInputs({ buildings, avgMorale: 70, crewFatigueStrain: 0 }));
      updateScores(tired, makeInputs({ buildings, avgMorale: 70, crewFatigueStrain: 0.5 }));
    }
    expect(tired.wellBeing).toBeLessThan(rested.wellBeing);
  });

  describe('overwork is measured against the default rest cycle (#1778)', () => {
    const crew = (fatigue: number) =>
      [0, 1, 2, 3, 4].map(() => ({ alive: true, injured: false, fatigue }));
    function settleWithCrew(fatigue: number | null): number {
      const buildings = withQuarters(1);
      const state = createScoreState();
      const strain = fatigue === null ? 0 : computeCrewFatigueStrain(crew(fatigue));
      for (let i = 0; i < 1000; i++) {
        updateScores(state, makeInputs({ buildings, avgMorale: 70, employeeCount: 5, bedCapacity: 20, crewFatigueStrain: strain }));
      }
      return state.wellBeing;
    }

    it.each([60, 65, 70])('a crew resting around fatigue %i carries no overwork drag', (f) => {
      expect(computeCrewFatigueStrain(crew(f))).toBe(0);
      expect(settleWithCrew(f)).toBeCloseTo(settleWithCrew(null), 10);
    });

    it.each([0, 10])('a crew driven down to fatigue %i loses well-being versus no strain', (f) => {
      expect(settleWithCrew(f)).toBeLessThan(settleWithCrew(null));
    });
  });

  it('recentAccidents: 1 lowers well-being versus none', () => {
    const clean = createScoreState();
    const hurt = createScoreState();
    updateScores(clean, makeInputs({ avgMorale: 70 }));
    updateScores(hurt, makeInputs({ avgMorale: 70, recentAccidents: 1 }));
    expect(hurt.wellBeing).toBeLessThan(clean.wellBeing);
  });

  it('equilibrium well-being ranks T3 > T2 > T1 quarters after 1000 ticks', () => {
    const t1 = settle(1);
    const t2 = settle(2);
    const t3 = settle(3);
    expect(t3).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t1);
  });

  it('T1 quarters with no drag do not pin well-being at the ceiling (headroom slows gains)', () => {
    expect(settle(1)).toBeLessThan(96);
  });

  it('avgMorale 0 with no quarters still drives well-being to 0, at least ~1 point per tick', () => {
    const state = createScoreState();
    updateScores(state, makeInputs({ avgMorale: 0 }));
    // -1.0 from morale, +0.05 score decay toward neutral: 49.05 after the first tick.
    expect(state.wellBeing).toBeLessThanOrEqual(49.1);
    for (let i = 0; i < 60; i++) updateScores(state, makeInputs({ avgMorale: 0 }));
    expect(state.wellBeing).toBe(0);
  });

  it('a negative building well-being effect still applies in full', () => {
    const buildings = withQuarters(1);
    const def = getBuildingDef('living_quarters', 1);
    const original = { ...def.scoreEffects };
    try {
      def.scoreEffects = { ...original, wellBeing: -20 };
      const state = createScoreState();
      updateScores(state, makeInputs({ buildings, avgMorale: 50 }));
      // -20 * WB_BUILDING_GAIN (0.1) = -2.0 undamped, plus the 0.05 decay back toward neutral.
      expect(state.wellBeing).toBeCloseTo(50 - 2 + 0.05, 10);
    } finally {
      def.scoreEffects = original;
    }
  });

  it('an unhoused site climbs undamped while a housed site tapers near the top', () => {
    const start = 90;
    const unhoused = createScoreState();
    const housed = createScoreState();
    unhoused.wellBeing = start;
    housed.wellBeing = start;
    updateScores(unhoused, makeInputs({ avgMorale: 100 }));
    updateScores(housed, makeInputs({ buildings: withQuarters(1), avgMorale: 100 }));
    // Unhoused: morale gain 50 * 0.02 = +1.0 with no headroom damping, minus 0.05 decay.
    expect(unhoused.wellBeing).toBeCloseTo(start + 1.0 - 0.05, 10);
    // Housed gets a building gain too, but headroom (100-90)/WB_HEADROOM_SPAN scales the whole gain down.
    expect(housed.wellBeing).toBeLessThan(unhoused.wellBeing);
  });
});

describe('Safety model — managed target (#1977)', () => {
  function site(spec: Array<['explosive_warehouse' | 'management_office', 1 | 2 | 3]>) {
    const buildings = createBuildingState();
    buildings.unlockedTiers.explosive_warehouse = 3;
    buildings.unlockedTiers.management_office = 3;
    spec.forEach(([type, tier], i) => {
      placeBuilding(buildings, type, (i % 6) * 10, Math.floor(i / 6) * 10, 64, 64, tier);
    });
    expect(buildings.buildings.length).toBe(spec.length);
    return buildings;
  }

  function run(buildings: ReturnType<typeof createBuildingState>, ticks: number, overrides: Partial<ScoreInputs> = {}) {
    const state = createScoreState();
    for (let i = 0; i < ticks; i++) updateScores(state, makeInputs({ buildings, ...overrides }));
    return state;
  }

  it('a T1 explosive warehouse alone settles near 38, above 0 and below 40', () => {
    const s = run(site([['explosive_warehouse', 1]]), 2000);
    expect(Math.abs(s.safety - 38)).toBeLessThan(0.5);
    expect(s.safety).toBeGreaterThan(0);
    expect(s.safety).toBeLessThan(40);
  });

  it('warehouse plus office with safety equipment settles near 67, below 100', () => {
    const s = run(site([['explosive_warehouse', 1], ['management_office', 1]]), 2000, { hasSafetyEquipment: true });
    expect(Math.abs(s.safety - 67)).toBeLessThan(0.5);
    expect(s.safety).toBeGreaterThanOrEqual(40);
    expect(s.safety).toBeLessThan(100);
  });

  it('a T1 office alone never reaches 100', () => {
    const s = run(site([['management_office', 1]]), 3000);
    expect(s.safety).toBeLessThan(100);
    expect(s.safety).toBeGreaterThan(50);
  });

  it('a T3 office is capped at SAFETY_TARGET_MAX', () => {
    const s = run(site([['management_office', 3]]), 3000, { hasSafetyEquipment: true });
    expect(s.safety).toBeLessThanOrEqual(SAFETY_TARGET_MAX + 1e-9);
    expect(s.safety).toBeGreaterThan(80);
  });

  it('many warehouses floor at SAFETY_TARGET_MIN and never reach 0', () => {
    const buildings = site(Array.from({ length: 12 }, () => ['explosive_warehouse', 3] as ['explosive_warehouse', 3]));
    const state = createScoreState();
    for (let i = 0; i < 3000; i++) {
      updateScores(state, makeInputs({ buildings }));
      expect(state.safety).toBeGreaterThan(0);
    }
    expect(state.safety).toBeGreaterThanOrEqual(SAFETY_TARGET_MIN - 1e-9);
    expect(Math.abs(state.safety - SAFETY_TARGET_MIN)).toBeLessThan(0.5);
  });

  it('an accident burst drops safety by at least 30 then recovers to within 2 of target in 300 ticks', () => {
    const buildings = site([['management_office', 1]]);
    const target = safetyTarget(2, false);
    const state = run(buildings, 2000);
    const before = state.safety;
    for (let i = 0; i < 10; i++) updateScores(state, makeInputs({ buildings, recentAccidents: 1 }));
    expect(before - state.safety).toBeGreaterThanOrEqual(30);
    for (let i = 0; i < 300; i++) updateScores(state, makeInputs({ buildings }));
    expect(Math.abs(state.safety - target)).toBeLessThan(2);
  });

  it('recovers off 0 toward the target', () => {
    const buildings = site([['management_office', 1]]);
    const state = createScoreState();
    state.safety = 0;
    for (let i = 0; i < 100; i++) updateScores(state, makeInputs({ buildings }));
    expect(state.safety).toBeGreaterThan(20);
  });

  it('with no buildings and no equipment safety stays exactly 50', () => {
    const state = run(createBuildingState(), 500);
    expect(state.safety).toBe(50);
  });

  it('safety never leaves 0..100 under heavy accidents', () => {
    const state = createScoreState();
    for (let i = 0; i < 50; i++) updateScores(state, makeInputs({ recentAccidents: 50 }));
    expect(state.safety).toBe(0);
  });

  it('well-being and ecology evolve as before for the same inputs', () => {
    const a = createScoreState();
    const b = createScoreState();
    const buildings = site([['management_office', 1]]);
    for (let i = 0; i < 50; i++) {
      updateScores(a, makeInputs({ buildings, avgMorale: 70, maxRecentVibration: 5 }));
      updateScores(b, makeInputs({ buildings, avgMorale: 70, maxRecentVibration: 5 }));
    }
    expect(a.wellBeing).toBe(b.wellBeing);
    // Decay still applies to the other scores: unfed ecology drifts back toward 50.
    const eco = createScoreState();
    eco.ecology = 90;
    updateScores(eco, makeInputs());
    expect(eco.ecology).toBeLessThan(90);
    expect(eco.ecology).toBeGreaterThan(80);
  });

  describe('safetyTarget', () => {
    it('is 50 with no effect and no equipment', () => {
      expect(safetyTarget(0, false)).toBe(50);
    });
    it('adds the per-effect step and the equipment bonus', () => {
      expect(safetyTarget(1, false)).toBe(50 + SAFETY_TARGET_PER_EFFECT);
      expect(safetyTarget(-1, true)).toBe(50 - SAFETY_TARGET_PER_EFFECT + SAFETY_EQUIPMENT_TARGET_BONUS);
    });
    it('clamps to the min and max', () => {
      expect(safetyTarget(100, true)).toBe(SAFETY_TARGET_MAX);
      expect(safetyTarget(-100, false)).toBe(SAFETY_TARGET_MIN);
    });
    it('reads non-finite effect as 0', () => {
      expect(safetyTarget(NaN, false)).toBe(50);
      expect(safetyTarget(Infinity, false)).toBe(50);
      expect(safetyTarget(-Infinity, true)).toBe(50 + SAFETY_EQUIPMENT_TARGET_BONUS);
    });
  });
});
