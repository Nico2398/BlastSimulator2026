// BlastSimulator2026 — Mine grades: Ministry of Holes permit ladder, four grades x three tiers (#1921, #2277)

import { describe, it, expect } from 'vitest';
import {
  createGradeState,
  sanitizeGradeState,
  gradeDef,
  gradeRung,
  tierDef,
  nextGradeTargets,
  currentTierTargets,
  advanceGradeTier,
  migrateLegacyGrade,
  permitApplyBlocker,
  recordOreDelivery,
  recordGradeBlast,
  blastPitDepthM,
  applyForGrade,
  advanceGradeApplication,
  approvePendingApplication,
  acknowledgeApproval,
  registerUnlockLine,
  unlockLinesFor,
  type GradeState,
  type GradeTargetKind,
  type GradeTargetStatus,
} from '../../../src/core/economy/MineGrade.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { setVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import {
  MINE_GRADES,
  LEGACY_PERMIT_LIMITS,
  MINE_GRADE_CLASS_BASE_FEE,
  MINE_GRADE_CLASS_FEE_FACTOR,
  MINE_GRADE_CLASS_ORE_FACTOR,
  MINE_GRADE_CLASS_PROCESSING_TICKS,
  MINE_GRADE_CLASS_ROCK_BASE_M3,
  MINE_GRADE_CLASS_ROCK_FACTOR,
  type MineGradeTargetConfig,
} from '../../../src/core/config/balance.js';
// Importing PermitLimits registers its unlock line at module level (#1926).
import { permitLimitsFor, permitLimitsForRung } from '../../../src/core/economy/PermitLimits.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';
import {
  NAMED_GRADES, TIERS, rungOf, tierTargets, tierNeeded, perkTotals,
  progressionState, meetTargets, siteMeetingTier, siteReadyForNextGrade,
} from '../../helpers/gradeLadder.js';

const kindsOf = (targets: readonly { kind: string }[]): string[] => targets.map(x => x.kind);

/** Status of the `index`-th target of `kind`. */
function statusOf(list: GradeTargetStatus[], kind: GradeTargetKind): GradeTargetStatus {
  const found = list.find(x => x.kind === kind);
  expect(found, `target ${kind}`).toBeDefined();
  return found!;
}

/** Processing ticks after the perk: the base cut by `pct` percent, however the rounding falls, never below 1. */
function expectShortened(actual: number, base: number, pct: number): void {
  const exact = base * (1 - pct / 100);
  expect(actual).toBeGreaterThanOrEqual(Math.max(1, Math.floor(exact)));
  expect(actual).toBeLessThanOrEqual(Math.max(1, Math.ceil(exact)));
  if (pct > 0) expect(actual).toBeLessThan(base);
}

describe('createGradeState', () => {
  it('starts at grade 0, tier 1 with nothing tracked and nothing pending', () => {
    expect(createGradeState()).toEqual({
      grade: 0, tier: 1, oreDeliveredKg: 0, deepestPitM: 0, rockBrokenM3: 0, blastsFired: 0, pending: null,
      strikeTicks: [], inspectionRolls: 0, lastBlastChargeShare: 0, unseenApproval: null,
    });
  });

  it('returns an independent object each call', () => {
    const a = createGradeState();
    a.blastsFired = 9;
    expect(createGradeState().blastsFired).toBe(0);
  });
});

describe('the ladder table (#2277)', () => {
  it('has the four named grades 0-3, each with three tiers and a zone mastery', () => {
    expect(Object.keys(MINE_GRADES).map(Number).sort()).toEqual([0, 1, 2, 3]);
    for (const g of NAMED_GRADES) {
      expect(MINE_GRADES[g]!.tiers).toHaveLength(3);
      expect(MINE_GRADES[g]!.mastery.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every tier asks one to three targets', () => {
    for (const g of NAMED_GRADES) for (const tier of TIERS) {
      const n = tierTargets(g, tier).length;
      expect(n, `grade ${g} tier ${tier}`).toBeGreaterThanOrEqual(1);
      expect(n, `grade ${g} tier ${tier}`).toBeLessThanOrEqual(3);
    }
  });

  it('every target value is positive and of a known kind', () => {
    const known = ['ore_kg', 'blasts', 'depth_m', 'rock_m3', 'safety', 'ecology', 'neighbours', 'no_death'];
    for (const g of NAMED_GRADES) {
      for (const tg of [...MINE_GRADES[g]!.mastery, ...MINE_GRADES[g]!.tiers.flatMap(x => x.targets)]) {
        expect(known).toContain(tg.kind);
        expect(tg.value).toBeGreaterThan(0);
      }
    }
  });

  it('values of one target kind strictly rise from tier to tier along the whole ladder', () => {
    const last = new Map<string, number>();
    for (const g of NAMED_GRADES) for (const tier of TIERS) {
      for (const tg of tierTargets(g, tier)) {
        const before = last.get(tg.kind);
        if (before !== undefined) expect(tg.value, `${tg.kind} at grade ${g} tier ${tier}`).toBeGreaterThan(before);
        last.set(tg.kind, tg.value);
      }
    }
  });

  it('the zone mastery asks more ore than the last tier of its grade', () => {
    for (const g of NAMED_GRADES) {
      const mastery = MINE_GRADES[g]!.mastery.find(x => x.kind === 'ore_kg');
      expect(mastery, `grade ${g} mastery`).toBeDefined();
      expect(mastery!.value).toBeGreaterThan(tierNeeded(g, 3, 'ore_kg'));
    }
  });

  it('grade fees and processing times rise across grades 1-3', () => {
    for (let g = 2; g <= 3; g++) {
      expect(MINE_GRADES[g]!.fee).toBeGreaterThan(MINE_GRADES[g - 1]!.fee);
      expect(MINE_GRADES[g]!.processingTicks).toBeGreaterThan(MINE_GRADES[g - 1]!.processingTicks);
    }
  });
});

describe('grade names (#2277)', () => {
  it('the four grades are Surface, Depth, Distance and Meteorite in English', () => {
    setLocale('en');
    expect(['permit.grade.0', 'permit.grade.1', 'permit.grade.2', 'permit.grade.3'].map(k => t(k)))
      .toEqual(['Surface', 'Depth', 'Distance', 'Meteorite']);
  });

  it('the four grades are named in French, differently from English', () => {
    for (let g = 0; g <= 3; g++) {
      const key = `permit.grade.${g}`;
      expect((fr as Record<string, string>)[key], key).toBeTruthy();
      expect((en as Record<string, string>)[key], key).toBeTruthy();
    }
  });

  it('the endless class and the new refusal have text in both locales', () => {
    for (const key of ['permit.grade.class', 'permit.refusal.tier_incomplete']) {
      expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      expect((fr as Record<string, string>)[key], `fr ${key}`).toBeTruthy();
    }
  });
});

describe('gradeRung (#2277)', () => {
  it.each([
    [0, 1, 0], [0, 2, 1], [0, 3, 2], [1, 1, 3], [1, 2, 4], [1, 3, 5],
    [2, 1, 6], [2, 2, 7], [2, 3, 8], [3, 1, 9], [3, 2, 10], [3, 3, 11],
  ])('grade %i tier %i is rung %i', (grade, tier, rung) => {
    expect(gradeRung({ grade, tier })).toBe(rung);
  });

  it.each([[4, 12], [5, 13], [6, 14], [30, 38]])('endless class grade %i is rung %i', (grade, rung) => {
    expect(gradeRung({ grade, tier: 1 })).toBe(rung);
  });

  it('a site state reads its rung straight off its grade and tier', () => {
    expect(gradeRung(createGradeState())).toBe(0);
    expect(gradeRung({ ...createGradeState(), grade: 2, tier: 3 })).toBe(8);
  });

  it('rungs rise by one along the ladder, through the class boundary', () => {
    let prev = -1;
    for (const g of NAMED_GRADES) for (const tier of TIERS) {
      const r = gradeRung({ grade: g, tier });
      expect(r).toBe(prev + 1);
      prev = r;
    }
    expect(gradeRung({ grade: 4, tier: 1 })).toBe(prev + 1);
  });
});

describe('tierDef (#2277)', () => {
  it.each(NAMED_GRADES.flatMap(g => TIERS.map(tier => [g, tier] as const)))('grade %i tier %i reads the table', (grade, tier) => {
    const def = tierDef(grade, tier)!;
    expect(def).toBeDefined();
    expect(def.grade).toBe(grade);
    expect(def.tier).toBe(tier);
    expect(def.targets.map(x => [x.kind, x.value])).toEqual(tierTargets(grade, tier).map(x => [x.kind, x.value]));
    expect(def.perk).toEqual(MINE_GRADES[grade]!.tiers[tier - 1]!.perk);
    const limits = permitLimitsForRung(rungOf(grade, tier));
    expect(def.limits.maxChargeKg).toBe(limits.maxChargeKg);
    expect(def.limits.maxAreaM2).toBe(limits.maxAreaM2);
  });

  it.each([[4, 1], [9, 1], [0, 0], [0, 4], [1, -1]])('grade %i tier %i has no definition', (grade, tier) => {
    expect(tierDef(grade, tier)).toBeUndefined();
  });
});

describe('gradeDef — named grades', () => {
  it.each(NAMED_GRADES)('grade %i has the table fee, processing ticks and name key', (grade) => {
    const def = gradeDef(grade);
    expect(def.grade).toBe(grade);
    expect(def.fee).toBe(MINE_GRADES[grade]!.fee);
    expect(def.processingTicks).toBe(MINE_GRADES[grade]!.processingTicks);
    expect(def.nameKey).toBe(`permit.grade.${grade}`);
    expect(def.nameKey).toBe(MINE_GRADES[grade]!.nameKey);
  });

  it('grade 0 is the start grade: free and instant', () => {
    const def = gradeDef(0);
    expect(def.fee).toBe(0);
    expect(def.processingTicks).toBe(0);
  });

  it('grades 1-3 charge a fee and take time', () => {
    for (const g of [1, 2, 3]) {
      expect(gradeDef(g).fee).toBeGreaterThan(0);
      expect(gradeDef(g).processingTicks).toBeGreaterThan(0);
    }
  });
});

describe('gradeDef — endless classes after grade 3 (#2277)', () => {
  it('class 1 is grade 4: the base fee, the class processing time, name params {n: 1}', () => {
    const def = gradeDef(4);
    expect(def.grade).toBe(4);
    expect(def.nameKey).toBe('permit.grade.class');
    expect(def.nameParams).toEqual({ n: 1 });
    expect(def.fee).toBe(MINE_GRADE_CLASS_BASE_FEE);
    expect(def.processingTicks).toBe(MINE_GRADE_CLASS_PROCESSING_TICKS);
  });

  it.each([[4, 1], [5, 2], [6, 3], [9, 6], [30, 27]])('grade %i carries its class number %i in the name params', (grade, n) => {
    expect(gradeDef(grade).nameKey).toBe('permit.grade.class');
    expect(gradeDef(grade).nameParams).toEqual({ n });
  });

  it('a class name differs from every named grade name', () => {
    for (const g of NAMED_GRADES) expect(gradeDef(4).nameKey).not.toBe(gradeDef(g).nameKey);
  });

  it('each further class multiplies the fee by the class fee factor', () => {
    expect(gradeDef(5).fee).toBe(Math.round(MINE_GRADE_CLASS_BASE_FEE * MINE_GRADE_CLASS_FEE_FACTOR));
    expect(gradeDef(6).fee).toBe(Math.round(MINE_GRADE_CLASS_BASE_FEE * MINE_GRADE_CLASS_FEE_FACTOR ** 2));
  });

  it('fee strictly increases from grade 3 through every class, and stays finite far out', () => {
    for (let g = 4; g <= 30; g++) expect(gradeDef(g).fee).toBeGreaterThan(gradeDef(g - 1).fee);
    expect(Number.isFinite(gradeDef(60).fee)).toBe(true);
    expect(gradeDef(30).processingTicks).toBe(MINE_GRADE_CLASS_PROCESSING_TICKS);
  });

  it('the first class costs more than grade 3', () => {
    expect(gradeDef(4).fee).toBeGreaterThan(gradeDef(3).fee);
  });
});

describe('currentTierTargets (#2277)', () => {
  it('is empty on a site without a ladder', () => {
    expect(currentTierTargets(createGame({ seed: 42 }))).toEqual([]);
  });

  it('is empty on an endless class, whose tier is fixed', () => {
    for (const grade of [4, 5, 12]) expect(currentTierTargets(progressionState({ grade, tier: 1 }))).toEqual([]);
  });

  it.each(NAMED_GRADES.flatMap(g => TIERS.map(tier => [g, tier] as const)))('grade %i tier %i lists that tier\'s targets, unmet on a bare site', (grade, tier) => {
    const list = currentTierTargets(progressionState({ grade, tier }));
    const want = tierTargets(grade, tier);
    expect(list.map(x => x.kind)).toEqual(kindsOf(want));
    expect(list.map(x => x.needed)).toEqual(want.map(x => x.value));
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeLessThanOrEqual(3);
    for (const s of list) {
      if (s.kind !== 'no_death') expect(s.met, `${s.kind}`).toBe(false);
    }
  });

  it('follows the tier: the same grade lists different values at tier 2', () => {
    const one = currentTierTargets(progressionState({ grade: 0, tier: 1 }));
    const two = currentTierTargets(progressionState({ grade: 0, tier: 2 }));
    expect(two.map(x => x.needed)).not.toEqual(one.map(x => x.needed));
  });

  it('ore_kg: one kg short is unmet, exactly the need is met (cumulative counter)', () => {
    const need = tierNeeded(0, 1, 'ore_kg');
    expect(statusOf(currentTierTargets(progressionState({ oreDeliveredKg: need - 1 })), 'ore_kg').met).toBe(false);
    const s = statusOf(currentTierTargets(progressionState({ oreDeliveredKg: need })), 'ore_kg');
    expect(s).toMatchObject({ met: true, current: need, needed: need });
  });

  it('blasts: one short is unmet, exactly the need is met', () => {
    const need = tierNeeded(0, 2, 'blasts');
    expect(statusOf(currentTierTargets(progressionState({ tier: 2, blastsFired: need - 1 })), 'blasts').met).toBe(false);
    expect(statusOf(currentTierTargets(progressionState({ tier: 2, blastsFired: need })), 'blasts')).toMatchObject({ met: true, current: need });
  });

  it('depth_m reads the deepest pit: just under is unmet, the need is met', () => {
    const need = tierNeeded(1, 1, 'depth_m');
    expect(statusOf(currentTierTargets(progressionState({ grade: 1, deepestPitM: need - 0.1 })), 'depth_m').met).toBe(false);
    expect(statusOf(currentTierTargets(progressionState({ grade: 1, deepestPitM: need })), 'depth_m')).toMatchObject({ met: true, needed: need });
  });

  it('safety reads the safety score', () => {
    const need = tierNeeded(1, 2, 'safety');
    const low = progressionState({ grade: 1, tier: 2 });
    low.scores.safety = need - 1;
    expect(statusOf(currentTierTargets(low), 'safety')).toMatchObject({ met: false, current: need - 1, needed: need });
    const ok = progressionState({ grade: 1, tier: 2 });
    ok.scores.safety = need;
    expect(statusOf(currentTierTargets(ok), 'safety').met).toBe(true);
  });

  it('ecology reads the ecology score', () => {
    const need = tierNeeded(3, 2, 'ecology');
    const low = progressionState({ grade: 3, tier: 2 });
    low.scores.ecology = need - 1;
    expect(statusOf(currentTierTargets(low), 'ecology').met).toBe(false);
    const ok = progressionState({ grade: 3, tier: 2 });
    ok.scores.ecology = need;
    expect(statusOf(currentTierTargets(ok), 'ecology').met).toBe(true);
  });

  it('neighbours reads the nuisance score', () => {
    const need = tierNeeded(2, 3, 'neighbours');
    const low = progressionState({ grade: 2, tier: 3 });
    low.scores.nuisance = need - 1;
    expect(statusOf(currentTierTargets(low), 'neighbours').met).toBe(false);
    const ok = progressionState({ grade: 2, tier: 3 });
    ok.scores.nuisance = need;
    expect(statusOf(currentTierTargets(ok), 'neighbours')).toMatchObject({ met: true, needed: need });
  });

  it('no_death: a death inside the window fails the tier, one just outside passes', () => {
    const window = tierNeeded(2, 2, 'no_death');
    const state = progressionState({ grade: 2, tier: 2 });
    state.tickCount = window * 5;
    expect(statusOf(currentTierTargets(state), 'no_death').met).toBe(true);
    state.damage.accidents.push({ tick: state.tickCount - window / 2, type: 'death', entityId: 1, fragmentId: -1, kineticEnergy: 0 });
    expect(statusOf(currentTierTargets(state), 'no_death').met).toBe(false);
    state.damage.accidents.length = 0;
    state.damage.accidents.push({ tick: state.tickCount - window - 1, type: 'death', entityId: 1, fragmentId: -1, kineticEnergy: 0 });
    expect(statusOf(currentTierTargets(state), 'no_death').met).toBe(true);
  });

  it('no_death ignores injuries', () => {
    const state = progressionState({ grade: 2, tier: 2 });
    state.tickCount = 50_000;
    state.damage.accidents.push({ tick: 49_990, type: 'injury', entityId: 1, fragmentId: -1, kineticEnergy: 0 });
    expect(statusOf(currentTierTargets(state), 'no_death').met).toBe(true);
  });

  it('a counter is cumulative: a higher tier reads the same running total', () => {
    const state = progressionState({ tier: 1, oreDeliveredKg: tierNeeded(0, 2, 'ore_kg') });
    expect(statusOf(currentTierTargets(state), 'ore_kg').met).toBe(true);
    state.grade!.tier = 2;
    expect(statusOf(currentTierTargets(state), 'ore_kg')).toMatchObject({ met: true, current: tierNeeded(0, 2, 'ore_kg') });
    state.grade!.tier = 3;
    expect(statusOf(currentTierTargets(state), 'ore_kg').met).toBe(false);
  });
});

describe('nextGradeTargets (#2277)', () => {
  it('is empty on a site without a ladder', () => {
    expect(nextGradeTargets(createGame({ seed: 42 }))).toEqual([]);
  });

  it.each(NAMED_GRADES)('grade %i asks its tier-3 targets, then its zone mastery', (grade) => {
    const list = nextGradeTargets(progressionState({ grade, tier: 3 }));
    const tier3 = tierTargets(grade, 3);
    const mastery = MINE_GRADES[grade]!.mastery;
    expect(list).toHaveLength(tier3.length + mastery.length);
    expect(list.slice(0, tier3.length).map(x => [x.kind, x.needed])).toEqual(tier3.map(x => [x.kind, x.value]));
    expect(list.slice(tier3.length).map(x => [x.kind, x.needed])).toEqual(mastery.map(x => [x.kind, x.value]));
    expect(list.every(x => !x.met || x.kind === 'no_death')).toBe(true);
  });

  it('asks the same list whichever tier the site stands on', () => {
    const at1 = nextGradeTargets(progressionState({ grade: 1, tier: 1 })).map(x => [x.kind, x.needed]);
    const at3 = nextGradeTargets(progressionState({ grade: 1, tier: 3 })).map(x => [x.kind, x.needed]);
    expect(at1).toEqual(at3);
  });

  it('the mastery is plain ore delivered', () => {
    for (const g of NAMED_GRADES) {
      expect(kindsOf(MINE_GRADES[g]!.mastery)).toEqual(['ore_kg']);
    }
  });

  it('mastery ore one kg short is unmet, the need is met', () => {
    const need = MINE_GRADES[0]!.mastery[0]!.value;
    const low = progressionState({ grade: 0, tier: 3, oreDeliveredKg: need - 1 });
    const ok = progressionState({ grade: 0, tier: 3, oreDeliveredKg: need });
    const masteryOf = (s: GameState) => nextGradeTargets(s).filter(x => x.kind === 'ore_kg' && x.needed === need)[0]!;
    expect(masteryOf(low).met).toBe(false);
    expect(masteryOf(ok)).toMatchObject({ met: true, current: need });
  });

  it('grade 3 (the last named grade) asks its tier-3 targets and mastery to enter class 1', () => {
    const list = nextGradeTargets(progressionState({ grade: 3, tier: 3 }));
    expect(list.map(x => x.needed)).toEqual([...tierTargets(3, 3), ...MINE_GRADES[3]!.mastery].map(x => x.value));
  });

  it('class 1 (grade 4) asks ore and rock for class 2, as classes always did', () => {
    const list = nextGradeTargets(progressionState({ grade: 4, tier: 1 }));
    expect(list.map(x => x.kind).sort()).toEqual(['ore_kg', 'rock_m3']);
    expect(statusOf(list, 'rock_m3').needed).toBe(MINE_GRADE_CLASS_ROCK_BASE_M3);
    expect(statusOf(list, 'ore_kg').needed).toBeGreaterThan(MINE_GRADES[3]!.mastery[0]!.value);
  });

  it('rock_m3: one short is unmet, exactly the need is met', () => {
    expect(statusOf(nextGradeTargets(progressionState({ grade: 4, rockBrokenM3: MINE_GRADE_CLASS_ROCK_BASE_M3 - 1 })), 'rock_m3').met).toBe(false);
    expect(statusOf(nextGradeTargets(progressionState({ grade: 4, rockBrokenM3: MINE_GRADE_CLASS_ROCK_BASE_M3 })), 'rock_m3'))
      .toMatchObject({ met: true, needed: MINE_GRADE_CLASS_ROCK_BASE_M3 });
  });

  it('each further class multiplies rock by the rock factor and ore by the ore factor', () => {
    const at = (grade: number) => nextGradeTargets(progressionState({ grade, tier: 1 }));
    for (const grade of [4, 5, 6, 9]) {
      const a = at(grade);
      const b = at(grade + 1);
      expect(statusOf(b, 'rock_m3').needed).toBe(Math.round(statusOf(a, 'rock_m3').needed * MINE_GRADE_CLASS_ROCK_FACTOR));
      expect(Math.abs(statusOf(b, 'ore_kg').needed - statusOf(a, 'ore_kg').needed * MINE_GRADE_CLASS_ORE_FACTOR)).toBeLessThanOrEqual(2);
    }
  });

  it('ore and rock targets strictly increase class after class', () => {
    for (let grade = 4; grade < 25; grade++) {
      const a = nextGradeTargets(progressionState({ grade }));
      const b = nextGradeTargets(progressionState({ grade: grade + 1 }));
      expect(statusOf(b, 'ore_kg').needed).toBeGreaterThan(statusOf(a, 'ore_kg').needed);
      expect(statusOf(b, 'rock_m3').needed).toBeGreaterThan(statusOf(a, 'rock_m3').needed);
    }
  });

  it('classes never ask depth', () => {
    for (const grade of [4, 5, 8]) expect(kindsOf(nextGradeTargets(progressionState({ grade }))).includes('depth_m')).toBe(false);
  });
});

describe('advanceGradeTier — automatic tier-up (#2277)', () => {
  function collect(emitter: EventEmitter): { grade: number; tier: number }[] {
    const seen: { grade: number; tier: number }[] = [];
    emitter.on('progression:tier_up', e => seen.push(e));
    return seen;
  }

  it('does nothing while the current tier is unmet', () => {
    const state = progressionState();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceGradeTier(state, emitter)).toBe(0);
    expect(state.grade!.tier).toBe(1);
    expect(seen).toEqual([]);
  });

  it('one target short of the tier does nothing', () => {
    const state = progressionState({ oreDeliveredKg: tierNeeded(0, 1, 'ore_kg') });
    expect(advanceGradeTier(state, new EventEmitter())).toBe(0);
    expect(state.grade!.tier).toBe(1);
  });

  it('raises the tier by one when every target of the tier is met, and returns 1', () => {
    const state = siteMeetingTier(0, 1);
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceGradeTier(state, emitter)).toBe(1);
    expect(state.grade!.tier).toBe(2);
    expect(state.grade!.grade).toBe(0);
    expect(seen).toEqual([{ grade: 0, tier: 2 }]);
  });

  it('exactly meeting the targets is enough', () => {
    const state = progressionState({ oreDeliveredKg: tierNeeded(0, 1, 'ore_kg'), blastsFired: tierNeeded(0, 1, 'blasts') });
    expect(advanceGradeTier(state)).toBe(1);
  });

  it('raises tier 2 to tier 3 the same way', () => {
    const state = siteMeetingTier(0, 2);
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceGradeTier(state, emitter)).toBe(1);
    expect(state.grade!.tier).toBe(3);
    expect(seen).toEqual([{ grade: 0, tier: 3 }]);
  });

  it.each([1, 2, 3])('works on grade %i: tier 1 meeting its own targets rises to tier 2', (grade) => {
    const state = siteMeetingTier(grade, 1);
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceGradeTier(state, emitter)).toBe(1);
    expect(state.grade!.tier).toBe(2);
    expect(state.grade!.grade).toBe(grade);
    expect(seen).toEqual([{ grade, tier: 2 }]);
  });

  it('keeps going while the next tier is also met: tier 1 to 3 is two tiers, one event each, in order', () => {
    const state = siteMeetingTier(0, 3);
    state.grade!.tier = 1;
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceGradeTier(state, emitter)).toBe(2);
    expect(state.grade!.tier).toBe(3);
    expect(seen).toEqual([{ grade: 0, tier: 2 }, { grade: 0, tier: 3 }]);
  });

  it('is a no-op at tier 3, however much has been delivered', () => {
    const state = siteReadyForNextGrade(0);
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceGradeTier(state, emitter)).toBe(0);
    expect(state.grade!.tier).toBe(3);
    expect(state.grade!.grade).toBe(0);
    expect(seen).toEqual([]);
  });

  it('costs nothing, starts no application and raises no approval letter', () => {
    const state = siteMeetingTier(1, 1);
    state.cash = 5_000;
    const tx = state.finances.transactions.length;
    advanceGradeTier(state, new EventEmitter());
    expect(state.cash).toBe(5_000);
    expect(state.finances.transactions.length).toBe(tx);
    expect(state.grade!.pending).toBeNull();
    expect(state.grade!.unseenApproval).toBeNull();
  });

  it('never changes the trackers', () => {
    const state = siteMeetingTier(0, 1);
    const before = { ...state.grade! };
    advanceGradeTier(state);
    expect({ ...state.grade!, tier: 1 }).toEqual({ ...before, tier: 1 });
  });

  it('works without an emitter', () => {
    const state = siteMeetingTier(0, 1);
    expect(() => advanceGradeTier(state)).not.toThrow();
    expect(state.grade!.tier).toBe(2);
  });

  it('is a no-op on a site without a ladder', () => {
    const state = createGame({ seed: 42 });
    expect(advanceGradeTier(state, new EventEmitter())).toBe(0);
    expect(state.grade).toBeUndefined();
  });

  it('is a no-op on an endless class: classes have no tiers', () => {
    const state = progressionState({ grade: 4, tier: 1, oreDeliveredKg: 1e12, rockBrokenM3: 1e12, blastsFired: 99, deepestPitM: 999 });
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceGradeTier(state, emitter)).toBe(0);
    expect(state.grade!.tier).toBe(1);
    expect(seen).toEqual([]);
  });

  it('keeps a pending application untouched', () => {
    const state = siteMeetingTier(0, 1);
    state.grade!.pending = { toGrade: 1, ticksLeft: 9 };
    advanceGradeTier(state);
    expect(state.grade!.pending).toEqual({ toGrade: 1, ticksLeft: 9 });
  });
});

describe('recordOreDelivery', () => {
  it('counts ore_sale kg', () => {
    const g = createGradeState();
    recordOreDelivery(g, 'ore_sale', 1_200);
    expect(g.oreDeliveredKg).toBe(1_200);
  });

  it('counts supply kg and accumulates', () => {
    const g = createGradeState();
    recordOreDelivery(g, 'supply', 300);
    recordOreDelivery(g, 'ore_sale', 200);
    expect(g.oreDeliveredKg).toBe(500);
  });

  it('never counts rubble_disposal', () => {
    const g = createGradeState();
    recordOreDelivery(g, 'rubble_disposal', 9_999);
    expect(g.oreDeliveredKg).toBe(0);
  });

  it('is a no-op without grade state', () => {
    expect(() => recordOreDelivery(undefined, 'ore_sale', 100)).not.toThrow();
  });

  it('ignores zero kg', () => {
    const g = createGradeState();
    recordOreDelivery(g, 'ore_sale', 0);
    expect(g.oreDeliveredKg).toBe(0);
  });
});

describe('recordGradeBlast', () => {
  it('counts the blast, sums rock and keeps the deepest pit', () => {
    const g = createGradeState();
    recordGradeBlast(g, 4, 100);
    recordGradeBlast(g, 2.5, 50);
    expect(g.blastsFired).toBe(2);
    expect(g.rockBrokenM3).toBe(150);
    expect(g.deepestPitM).toBe(4);
    recordGradeBlast(g, 7, 10);
    expect(g.deepestPitM).toBe(7);
  });

  it('is a no-op without grade state', () => {
    expect(() => recordGradeBlast(undefined, 3, 10)).not.toThrow();
  });
});

describe('blastPitDepthM', () => {
  function sandboxGrid() {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    return ctx.grid!;
  }

  it('is 0 for no cleared columns', () => {
    expect(blastPitDepthM(sandboxGrid(), [])).toBe(0);
  });

  it('is about 0 over untouched natural ground', () => {
    expect(blastPitDepthM(sandboxGrid(), ['34,34'])).toBeLessThan(1.5);
  });

  it('measures the deepest carved column below the natural surface', () => {
    const grid = sandboxGrid();
    const natural = grid.generatorSurfaceHeightAt(34, 34)!;
    setVoxelColumnSurfaceHeight(grid, 34, 34, natural - 12, 1);
    setVoxelColumnSurfaceHeight(grid, 35, 34, natural - 5, 1);
    const depth = blastPitDepthM(grid, ['34,34', '35,34']);
    expect(depth).toBeGreaterThan(10);
    expect(depth).toBeLessThan(14);
  });
});

describe('applyForGrade — refusals in order', () => {
  it('no_ladder on a site without grade state', () => {
    expect(applyForGrade(createGame({ seed: 42 }))).toEqual({ ok: false, refusal: 'no_ladder' });
  });

  it('pending refuses a second application', () => {
    const state = siteReadyForNextGrade(0);
    state.grade!.pending = { toGrade: 1, ticksLeft: 10 };
    expect(applyForGrade(state)).toMatchObject({ ok: false, refusal: 'pending' });
  });

  it.each(NAMED_GRADES.flatMap(g => [1, 2].map(tier => [g, tier] as const)))('grade %i tier %i is refused as tier_incomplete', (grade, tier) => {
    const state = siteReadyForNextGrade(grade);
    state.grade!.tier = tier;
    const cash = state.cash;
    expect(applyForGrade(state)).toEqual({ ok: false, refusal: 'tier_incomplete' });
    expect(state.cash).toBe(cash);
    expect(state.grade!.pending).toBeNull();
  });

  it('tier_incomplete is checked before targets and funds', () => {
    const state = progressionState({ grade: 0, tier: 2 });
    state.cash = 0;
    expect(applyForGrade(state)).toMatchObject({ ok: false, refusal: 'tier_incomplete' });
  });

  it('the dry run agrees: permitApplyBlocker names tier_incomplete below tier 3', () => {
    const state = siteReadyForNextGrade(1);
    state.grade!.tier = 2;
    expect(permitApplyBlocker(state)).toMatchObject({ refusal: 'tier_incomplete' });
    state.grade!.tier = 3;
    expect(permitApplyBlocker(state)).toBeNull();
  });

  it('unmet_targets at tier 3 names a tier-3 target still unmet', () => {
    const state = progressionState({ grade: 0, tier: 3 });
    state.cash = 1_000_000_000;
    meetTargets(state, MINE_GRADES[0]!.mastery);
    expect(applyForGrade(state)).toEqual({ ok: false, refusal: 'unmet_targets', unmet: ['blasts'] });
  });

  it('unmet_targets names the zone mastery when only the mastery is short', () => {
    const state = progressionState({ grade: 0, tier: 3 });
    state.cash = 1_000_000_000;
    meetTargets(state, tierTargets(0, 3));
    expect(applyForGrade(state)).toEqual({ ok: false, refusal: 'unmet_targets', unmet: ['ore_kg'] });
  });

  it('unmet_targets names every kind still unmet', () => {
    const state = progressionState({ grade: 0, tier: 3 });
    state.cash = 1_000_000_000;
    const out = applyForGrade(state) as { ok: false; refusal: string; unmet: string[] };
    expect(out.refusal).toBe('unmet_targets');
    expect(new Set(out.unmet)).toEqual(new Set(['ore_kg', 'blasts']));
  });

  it('unmet_targets beats insufficient_funds', () => {
    const state = progressionState({ grade: 0, tier: 3 });
    state.cash = 0;
    expect(applyForGrade(state)).toMatchObject({ refusal: 'unmet_targets' });
  });

  it('insufficient_funds when cash is below the fee', () => {
    const state = siteReadyForNextGrade(0);
    state.cash = gradeDef(1).fee - 1;
    expect(applyForGrade(state)).toMatchObject({ ok: false, refusal: 'insufficient_funds' });
  });

  it('a refusal books nothing and starts nothing', () => {
    const state = siteReadyForNextGrade(0);
    state.cash = gradeDef(1).fee - 1;
    const txBefore = state.finances.transactions.length;
    applyForGrade(state);
    expect(state.cash).toBe(gradeDef(1).fee - 1);
    expect(state.finances.transactions.length).toBe(txBefore);
    expect(state.grade!.pending).toBeNull();
  });

  it('an endless class has no tiers: it is never refused as tier_incomplete', () => {
    const state = progressionState({ grade: 4, tier: 1 });
    state.cash = 1_000_000_000;
    expect(applyForGrade(state)).toMatchObject({ refusal: 'unmet_targets' });
  });
});

describe('applyForGrade — success', () => {
  it('returns the table fee and the target grade', () => {
    expect(applyForGrade(siteReadyForNextGrade(0))).toEqual({ ok: true, fee: MINE_GRADES[1]!.fee, toGrade: 1 });
  });

  it('cash exactly equal to the fee is enough', () => {
    const state = siteReadyForNextGrade(0);
    state.cash = gradeDef(1).fee;
    expect(applyForGrade(state).ok).toBe(true);
    expect(state.cash).toBe(0);
  });

  it('books the fee as a permits expense', () => {
    const state = siteReadyForNextGrade(0);
    const cashBefore = state.cash;
    applyForGrade(state);
    expect(state.cash).toBe(cashBefore - gradeDef(1).fee);
    const tx = state.finances.transactions.filter(x => x.category === 'permits');
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: 'expense', amount: gradeDef(1).fee });
  });

  it('starts processing without raising the grade or the tier', () => {
    const state = siteReadyForNextGrade(0);
    applyForGrade(state);
    expect(state.grade!.pending).toMatchObject({ toGrade: 1 });
    expect(state.grade!.grade).toBe(0);
    expect(state.grade!.tier).toBe(3);
  });

  it('the tier perk shortens the paperwork of the table time', () => {
    for (const grade of NAMED_GRADES) {
      const state = siteReadyForNextGrade(grade);
      applyForGrade(state);
      const base = gradeDef(grade + 1).processingTicks;
      expectShortened(state.grade!.pending!.ticksLeft, base, perkTotals(rungOf(grade, 3)).processing_pct);
    }
  });

  it('processing never takes less than one tick', () => {
    for (const grade of NAMED_GRADES) {
      const state = siteReadyForNextGrade(grade);
      applyForGrade(state);
      expect(state.grade!.pending!.ticksLeft).toBeGreaterThanOrEqual(1);
    }
  });

  it('a second application while pending is refused and charges nothing', () => {
    const state = siteReadyForNextGrade(0);
    applyForGrade(state);
    const cash = state.cash;
    expect(applyForGrade(state)).toMatchObject({ refusal: 'pending' });
    expect(state.cash).toBe(cash);
  });

  it('grade 3 tier 3 with its mastery applies for class 1 at the base class fee', () => {
    const state = siteReadyForNextGrade(3);
    expect(applyForGrade(state)).toEqual({ ok: true, fee: MINE_GRADE_CLASS_BASE_FEE, toGrade: 4 });
    expectShortened(state.grade!.pending!.ticksLeft, MINE_GRADE_CLASS_PROCESSING_TICKS, perkTotals(11).processing_pct);
  });

  it('a class applies for the next class once its ore and rock targets are met', () => {
    const state = progressionState({ grade: 4, tier: 1 });
    state.cash = 1_000_000_000;
    meetTargets(state, nextGradeTargets(state).map((x): MineGradeTargetConfig => ({ kind: x.kind, value: x.needed })));
    expect(applyForGrade(state)).toMatchObject({ ok: true, toGrade: 5, fee: gradeDef(5).fee });
  });
});

describe('advanceGradeApplication', () => {
  it('raises the grade when the paperwork ticks run out and emits progression:grade_approved', () => {
    const state = siteReadyForNextGrade(0);
    const emitter = new EventEmitter();
    const approved: number[] = [];
    emitter.on('progression:grade_approved', e => approved.push(e.grade));
    applyForGrade(state);
    const ticks = state.grade!.pending!.ticksLeft;
    for (let i = 0; i < ticks - 1; i++) advanceGradeApplication(state, emitter);
    expect(state.grade!.grade).toBe(0);
    expect(state.grade!.pending).not.toBeNull();
    expect(approved).toEqual([]);
    advanceGradeApplication(state, emitter);
    expect(state.grade!.grade).toBe(1);
    expect(state.grade!.pending).toBeNull();
    expect(approved).toEqual([1]);
  });

  it('the new grade starts at tier 1', () => {
    const state = siteReadyForNextGrade(0);
    applyForGrade(state);
    while (state.grade!.pending) advanceGradeApplication(state, new EventEmitter());
    expect(state.grade!.grade).toBe(1);
    expect(state.grade!.tier).toBe(1);
  });

  it('counts down one tick at a time', () => {
    const state = siteReadyForNextGrade(0);
    applyForGrade(state);
    const before = state.grade!.pending!.ticksLeft;
    advanceGradeApplication(state, new EventEmitter());
    expect(state.grade!.pending?.ticksLeft).toBe(before - 1);
  });

  it('does nothing without a pending application', () => {
    const state = progressionState();
    const emitter = new EventEmitter();
    let fired = 0;
    emitter.on('progression:grade_approved', () => fired++);
    advanceGradeApplication(state, emitter);
    expect(state.grade!.grade).toBe(0);
    expect(state.grade!.tier).toBe(1);
    expect(state.grade!.pending).toBeNull();
    expect(fired).toBe(0);
  });

  it('is a no-op on a site without grade state', () => {
    const state = createGame({ seed: 42 });
    expect(() => advanceGradeApplication(state, new EventEmitter())).not.toThrow();
    expect(state.grade).toBeUndefined();
  });

  it('after approval the next checklist is the new grade\'s, the tier ladder restarts, and applying again needs tier 3', () => {
    const state = siteReadyForNextGrade(0);
    applyForGrade(state);
    while (state.grade!.pending) advanceGradeApplication(state, new EventEmitter());
    expect(nextGradeTargets(state).map(x => x.needed)).toEqual([...tierTargets(1, 3), ...MINE_GRADES[1]!.mastery].map(x => x.value));
    expect(currentTierTargets(state).map(x => x.needed)).toEqual(tierTargets(1, 1).map(x => x.value));
    expect(applyForGrade(state)).toMatchObject({ refusal: 'tier_incomplete' });
  });

  it('there is no demotion: targets are checked only at application', () => {
    const state = siteReadyForNextGrade(0);
    applyForGrade(state);
    state.grade!.oreDeliveredKg = 0;
    while (state.grade!.pending) advanceGradeApplication(state, new EventEmitter());
    expect(state.grade!.grade).toBe(1);
  });

  it('approving into a class leaves it at tier 1', () => {
    const g = createGradeState();
    g.grade = 3;
    g.tier = 3;
    g.pending = { toGrade: 4, ticksLeft: 1 };
    approvePendingApplication(g);
    expect(g.grade).toBe(4);
    expect(g.tier).toBe(1);
  });

  it('approving resets the tier from any tier', () => {
    const g = { ...createGradeState(), grade: 1, tier: 3, pending: { toGrade: 2, ticksLeft: 1 } };
    approvePendingApplication(g);
    expect(g.tier).toBe(1);
  });
});

describe('sanitizeGradeState', () => {
  const valid = (): GradeState => ({
    grade: 2, tier: 2, oreDeliveredKg: 1500.5, deepestPitM: 11, rockBrokenM3: 300, blastsFired: 4,
    pending: { toGrade: 3, ticksLeft: 20 }, strikeTicks: [], inspectionRolls: 0, lastBlastChargeShare: 0, unseenApproval: null,
  });

  it('accepts a valid new-format state, pending or not, and keeps its tier', () => {
    expect(sanitizeGradeState(valid())).toEqual(valid());
    expect(sanitizeGradeState({ ...valid(), pending: null })).toEqual({ ...valid(), pending: null });
  });

  it('accepts a fresh state', () => {
    expect(sanitizeGradeState(createGradeState())).toEqual(createGradeState());
  });

  it.each([1, 2, 3])('keeps tier %i as saved', (tier) => {
    expect(sanitizeGradeState({ ...valid(), tier })!.tier).toBe(tier);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'grade'],
    ['a number', 3],
    ['an array', []],
    ['an empty object', {}],
  ])('rejects %s', (_n, raw) => {
    expect(sanitizeGradeState(raw)).toBeUndefined();
  });

  it.each([
    ['negative grade', { grade: -1 }],
    ['fractional grade', { grade: 1.5 }],
    ['NaN grade', { grade: NaN }],
    ['string grade', { grade: '2' }],
    ['negative ore', { oreDeliveredKg: -1 }],
    ['non-finite ore', { oreDeliveredKg: Infinity }],
    ['string depth', { deepestPitM: 'deep' }],
    ['negative rock', { rockBrokenM3: -5 }],
    ['negative blasts', { blastsFired: -1 }],
    ['fractional blasts', { blastsFired: 1.5 }],
    ['pending of wrong type', { pending: 'soon' }],
    ['pending with missing ticksLeft', { pending: { toGrade: 3 } }],
    ['pending with non-numeric ticksLeft', { pending: { toGrade: 3, ticksLeft: 'x' } }],
    ['pending with NaN toGrade', { pending: { toGrade: NaN, ticksLeft: 4 } }],
    ['tier 0', { tier: 0 }],
    ['tier 4', { tier: 4 }],
    ['negative tier', { tier: -1 }],
    ['fractional tier', { tier: 1.5 }],
    ['NaN tier', { tier: NaN }],
    ['string tier', { tier: '2' }],
    ['infinite tier', { tier: Infinity }],
  ])('rejects %s', (_n, patch) => {
    expect(sanitizeGradeState({ ...valid(), ...patch })).toBeUndefined();
  });

  it('rejects a state with a missing tracker', () => {
    const raw: Record<string, unknown> = { ...valid() };
    delete raw['rockBrokenM3'];
    expect(sanitizeGradeState(raw)).toBeUndefined();
  });
});

describe('migrateLegacyGrade (#2277)', () => {
  it('old grade 0 stays at the first step', () => {
    expect(migrateLegacyGrade(0)).toEqual({ grade: 0, tier: 1 });
  });

  it('old grade 5 lands on the last named step', () => {
    expect(migrateLegacyGrade(5)).toEqual({ grade: 3, tier: 3 });
  });

  it.each([[6, 4], [7, 5], [8, 6], [12, 10], [40, 38]])('old class grade %i becomes grade %i at tier 1', (old, grade) => {
    expect(migrateLegacyGrade(old)).toEqual({ grade, tier: 1 });
  });

  it.each([0, 1, 2, 3, 4, 5])('old grade %i lands on the lowest rung that holds both its caps', (old) => {
    const { grade, tier } = migrateLegacyGrade(old);
    expect(Number.isInteger(grade) && Number.isInteger(tier)).toBe(true);
    expect(grade).toBeGreaterThanOrEqual(0);
    expect(grade).toBeLessThanOrEqual(3);
    expect(tier).toBeGreaterThanOrEqual(1);
    expect(tier).toBeLessThanOrEqual(3);
    const rung = gradeRung({ grade, tier });
    const legacy = LEGACY_PERMIT_LIMITS[old]!;
    const holds = (r: number) => permitLimitsForRung(r).maxChargeKg >= legacy.maxChargeKg && permitLimitsForRung(r).maxAreaM2 >= legacy.maxAreaM2;
    expect(holds(rung)).toBe(true);
    if (rung > 0) expect(holds(rung - 1)).toBe(false);
  });

  it('never loses a granted cap, charge or area, for old grades 0-5', () => {
    for (let old = 0; old <= 5; old++) {
      const { grade, tier } = migrateLegacyGrade(old);
      const l = permitLimitsFor(grade, tier);
      expect(l.maxChargeKg).toBeGreaterThanOrEqual(LEGACY_PERMIT_LIMITS[old]!.maxChargeKg);
      expect(l.maxAreaM2).toBeGreaterThanOrEqual(LEGACY_PERMIT_LIMITS[old]!.maxAreaM2);
    }
  });

  it('keeps the order of the old grades: a higher old grade never lands lower', () => {
    for (let old = 1; old <= 12; old++) {
      const a = migrateLegacyGrade(old - 1);
      const b = migrateLegacyGrade(old);
      expect(gradeRung(b)).toBeGreaterThanOrEqual(gradeRung(a));
    }
  });
});

describe('sanitizeGradeState — legacy saves without a tier (#2277)', () => {
  /** A sub-state as the pre-tier game saved it: no `tier` key. */
  const legacy = (over: Record<string, unknown> = {}): Record<string, unknown> => {
    const { tier: _tier, ...rest } = createGradeState();
    return { ...rest, ...over };
  };

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 12])('old grade %i is migrated to its new grade and tier', (old) => {
    const out = sanitizeGradeState(legacy({ grade: old }))!;
    const want = migrateLegacyGrade(old);
    expect(out.grade).toBe(want.grade);
    expect(out.tier).toBe(want.tier);
  });

  it('old grade 5 loads as grade 3 tier 3', () => {
    expect(sanitizeGradeState(legacy({ grade: 5 }))).toMatchObject({ grade: 3, tier: 3 });
  });

  it('a legacy site never holds fewer caps than it was granted', () => {
    for (let old = 0; old <= 5; old++) {
      const out = sanitizeGradeState(legacy({ grade: old }))!;
      const l = permitLimitsForRung(gradeRung(out));
      expect(l.maxChargeKg).toBeGreaterThanOrEqual(LEGACY_PERMIT_LIMITS[old]!.maxChargeKg);
      expect(l.maxAreaM2).toBeGreaterThanOrEqual(LEGACY_PERMIT_LIMITS[old]!.maxAreaM2);
    }
  });

  it('keeps every tracker as saved', () => {
    const out = sanitizeGradeState(legacy({ grade: 2, oreDeliveredKg: 1234.5, deepestPitM: 11, rockBrokenM3: 300, blastsFired: 4, strikeTicks: [5], inspectionRolls: 3 }))!;
    expect(out).toMatchObject({ oreDeliveredKg: 1234.5, deepestPitM: 11, rockBrokenM3: 300, blastsFired: 4, strikeTicks: [5], inspectionRolls: 3 });
  });

  it('maps an unseen approval likewise', () => {
    for (const old of [1, 3, 5, 7]) {
      expect(sanitizeGradeState(legacy({ grade: old, unseenApproval: old }))!.unseenApproval).toBe(migrateLegacyGrade(old).grade);
    }
  });

  it('keeps no unseen approval as none', () => {
    expect(sanitizeGradeState(legacy({ grade: 3, unseenApproval: null }))!.unseenApproval).toBeNull();
  });

  it('maps a pending target likewise, never below the new current grade + 1', () => {
    for (let old = 0; old <= 12; old++) {
      const out = sanitizeGradeState(legacy({ grade: old, pending: { toGrade: old + 1, ticksLeft: 17 } }))!;
      const cur = migrateLegacyGrade(old);
      expect(out.pending!.ticksLeft).toBe(17);
      expect(out.pending!.toGrade).toBe(Math.max(migrateLegacyGrade(old + 1).grade, cur.grade + 1));
      expect(out.pending!.toGrade).toBeGreaterThanOrEqual(out.grade + 1);
    }
  });

  it('old grade 0 with an application for grade 1 still points at grade 1', () => {
    expect(sanitizeGradeState(legacy({ grade: 0, pending: { toGrade: 1, ticksLeft: 4 } }))!.pending).toEqual({ toGrade: 1, ticksLeft: 4 });
  });

  it('a legacy pending application still approves into a grade above the current one', () => {
    const out = sanitizeGradeState(legacy({ grade: 5, pending: { toGrade: 6, ticksLeft: 1 } }))!;
    approvePendingApplication(out);
    expect(out.grade).toBeGreaterThan(3);
    expect(out.tier).toBe(1);
  });

  it.each([
    ['negative grade', { grade: -1 }],
    ['fractional grade', { grade: 2.5 }],
    ['malformed pending', { pending: { toGrade: 2 } }],
    ['negative ore', { oreDeliveredKg: -3 }],
  ])('still rejects a legacy state with %s', (_n, patch) => {
    expect(sanitizeGradeState(legacy({ grade: 2, ...patch }))).toBeUndefined();
  });
});

describe('unseenApproval (#1926)', () => {
  it('a fresh grade state has no unseen approval', () => {
    expect(createGradeState().unseenApproval).toBeNull();
  });

  it('approving a pending application records the granted grade as unseen and emits the event', () => {
    const g = createGradeState();
    g.pending = { toGrade: 1, ticksLeft: 1 };
    const emitter = new EventEmitter();
    const seen: number[] = [];
    emitter.on('progression:grade_approved', e => seen.push(e.grade));
    expect(approvePendingApplication(g, emitter)).toBe(true);
    expect(g.grade).toBe(1);
    expect(g.unseenApproval).toBe(1);
    expect(seen).toEqual([1]);
  });

  it('approving without a pending application leaves unseenApproval untouched', () => {
    const g = createGradeState();
    expect(approvePendingApplication(g)).toBe(false);
    expect(g.unseenApproval).toBeNull();
  });

  it('advanceGradeApplication sets unseenApproval when the countdown completes', () => {
    const state = progressionState({ pending: { toGrade: 2, ticksLeft: 1 } });
    advanceGradeApplication(state, new EventEmitter());
    expect(state.grade!.unseenApproval).toBe(2);
  });

  it('acknowledgeApproval clears a pending approval and reports true', () => {
    const g = createGradeState();
    g.unseenApproval = 3;
    expect(acknowledgeApproval(g)).toBe(true);
    expect(g.unseenApproval).toBeNull();
  });

  it('acknowledgeApproval reports false when nothing is pending, also when the field is absent', () => {
    const g = createGradeState();
    expect(acknowledgeApproval(g)).toBe(false);
    delete g.unseenApproval;
    expect(acknowledgeApproval(g)).toBe(false);
  });

  it('sanitizeGradeState keeps a well-formed unseenApproval', () => {
    const raw = { ...createGradeState(), unseenApproval: 2 };
    expect(sanitizeGradeState(raw)!.unseenApproval).toBe(2);
  });

  it.each([
    ['a string', '2'],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['NaN', NaN],
    ['an object', {}],
    ['undefined', undefined],
  ])('sanitizeGradeState turns %s into null', (_n, bad) => {
    const raw = { ...createGradeState(), unseenApproval: bad };
    expect(sanitizeGradeState(raw)!.unseenApproval).toBeNull();
  });

  it('an old save lacking the field loads as null', () => {
    const raw: Record<string, unknown> = { ...createGradeState() };
    delete raw['unseenApproval'];
    expect(sanitizeGradeState(raw)!.unseenApproval).toBeNull();
  });
});

describe('applyForGrade emitter (#1926)', () => {
  it('emits progression:grade_applied with target grade and fee on success', () => {
    const state = siteReadyForNextGrade(0);
    const emitter = new EventEmitter();
    const seen: { toGrade: number; fee: number }[] = [];
    emitter.on('progression:grade_applied', e => seen.push(e));
    const res = applyForGrade(state, emitter);
    expect(res.ok).toBe(true);
    expect(seen).toEqual([{ toGrade: 1, fee: gradeDef(1).fee }]);
  });

  it('does not emit when the application is refused', () => {
    const state = progressionState();
    state.cash = 1_000_000;
    const emitter = new EventEmitter();
    let calls = 0;
    emitter.on('progression:grade_applied', () => { calls++; });
    expect(applyForGrade(state, emitter).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('does not emit when refused as tier_incomplete', () => {
    const state = siteReadyForNextGrade(0);
    state.grade!.tier = 2;
    const emitter = new EventEmitter();
    let calls = 0;
    emitter.on('progression:grade_applied', () => { calls++; });
    expect(applyForGrade(state, emitter)).toMatchObject({ refusal: 'tier_incomplete' });
    expect(calls).toBe(0);
  });

  it('still works without an emitter', () => {
    expect(applyForGrade(siteReadyForNextGrade(0)).ok).toBe(true);
  });
});

describe('unlockLinesFor (#1926, #2277)', () => {
  const EN_HINTS: Record<number, string> = {
    1: 'Your pile of rubble is a logistics problem now.',
    2: 'Deeper benches: keep the floor clear before you drill.',
    3: 'Deep pits need long roads: think spiral.',
  };

  it.each([1, 2, 3])('grade %i lists the permit limits, then flavour, then hint, in that order', (g) => {
    const lines = unlockLinesFor(g);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const limits = permitLimitsFor(g);
    expect(lines[0]!.params).toMatchObject({ maxChargeKg: limits.maxChargeKg, maxAreaM2: limits.maxAreaM2, fee: formatMoney(limits.fee) });
    setLocale('en');
    expect(t(lines[0]!.key, lines[0]!.params)).toContain(`${limits.maxAreaM2} m² of pattern`);
    const keys = lines.map(l => l.key);
    expect(keys.indexOf(`progression.unlock.flavour.${g}`)).toBe(1);
    expect(keys.indexOf(`progression.unlock.hint.${g}`)).toBe(2);
  });

  it.each([1, 2, 3])('grade %i hint reads the issue text in English', (g) => {
    setLocale('en');
    expect(t(`progression.unlock.hint.${g}`)).toBe(EN_HINTS[g]);
  });

  it('grade 3 hint is the depth hint in French (#2045)', () => {
    expect(fr['progression.unlock.hint.3']).toBe('Les fosses profondes veulent de longues routes : pensez en spirale.');
  });

  it('every seeded line key resolves to real text in en and fr, not the raw key', () => {
    for (const g of [1, 2, 3, 4, 5, 9]) {
      for (const line of unlockLinesFor(g)) {
        for (const loc of [en, fr] as Record<string, string>[]) {
          expect(loc[line.key], `${line.key}`).toBeTypeOf('string');
        }
      }
    }
  });

  it('lines for different grades differ', () => {
    expect(unlockLinesFor(1).map(l => l.key)).not.toEqual(unlockLinesFor(2).map(l => l.key));
  });

  it('endless classes (grade 4 and up) get the limits line plus generic class flavour and hint', () => {
    for (const g of [4, 5, 12]) {
      const lines = unlockLinesFor(g);
      const limits = permitLimitsFor(g);
      expect(lines[0]!.params).toMatchObject({ maxChargeKg: limits.maxChargeKg, maxAreaM2: limits.maxAreaM2, fee: formatMoney(limits.fee) });
      const keys = lines.map(l => l.key);
      expect(keys).toContain('progression.unlock.flavour.class');
      expect(keys).toContain('progression.unlock.hint.class');
      expect(keys.some(k => /(flavour|hint)\.[1-5]$/.test(k))).toBe(false);
    }
  });

  it.each([0, -1, -5])('grade %i has no lines', (g) => {
    expect(unlockLinesFor(g)).toEqual([]);
  });

  it('a line registered later appears after the seeded ones, in registration order, only for its grade', () => {
    const before = unlockLinesFor(2).map(l => l.key);
    registerUnlockLine({ grade: 2, key: 'test.unlock.first', params: g => ({ grade: g }) });
    registerUnlockLine({ grade: 2, key: 'test.unlock.second' });
    registerUnlockLine({ grade: 3, key: 'test.unlock.other' });
    const after = unlockLinesFor(2);
    expect(after.map(l => l.key)).toEqual([...before, 'test.unlock.first', 'test.unlock.second']);
    expect(after[after.length - 2]!.params).toEqual({ grade: 2 });
    expect(after[after.length - 1]!.params).toEqual({});
    expect(unlockLinesFor(3).map(l => l.key)).toContain('test.unlock.other');
    expect(unlockLinesFor(1).map(l => l.key)).not.toContain('test.unlock.first');
  });

  it('a class line registered later appears for every endless class and no named grade', () => {
    registerUnlockLine({ grade: 'class', key: 'test.unlock.class' });
    expect(unlockLinesFor(4).map(l => l.key)).toContain('test.unlock.class');
    expect(unlockLinesFor(8).map(l => l.key)).toContain('test.unlock.class');
    expect(unlockLinesFor(3).map(l => l.key)).not.toContain('test.unlock.class');
  });
});
