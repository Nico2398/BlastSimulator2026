// BlastSimulator2026 — Mine grades: Ministry of Holes permit ladder (#1921)

import { describe, it, expect } from 'vitest';
import {
  createGradeState,
  sanitizeGradeState,
  gradeDef,
  nextGradeTargets,
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
} from '../../../src/core/economy/MineGrade.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { setVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { MINE_GRADES } from '../../../src/core/config/balance.js';
// Importing PermitLimits registers its unlock line at module level (#1926).
import { permitLimitsFor } from '../../../src/core/economy/PermitLimits.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

function progressionState(grade: Partial<GradeState> = {}): GameState {
  const state = createGame({ seed: 42 });
  state.grade = { ...createGradeState(), ...grade };
  return state;
}

/** A progression site that meets every grade-1 target and can afford the fee. */
function readyForGrade1(): GameState {
  const state = progressionState({ oreDeliveredKg: 5_000, blastsFired: 2 });
  state.cash = 1_000_000;
  return state;
}

function targetOf(state: GameState, kind: GradeTargetKind) {
  const found = nextGradeTargets(state).find(t => t.kind === kind);
  expect(found, `target ${kind}`).toBeDefined();
  return found!;
}

describe('createGradeState', () => {
  it('starts at grade 0 with nothing tracked and nothing pending', () => {
    expect(createGradeState()).toEqual({
      grade: 0, oreDeliveredKg: 0, deepestPitM: 0, rockBrokenM3: 0, blastsFired: 0, pending: null,
      strikeTicks: [], inspectionRolls: 0, lastBlastChargeShare: 0, unseenApproval: null,
    });
  });

  it('returns an independent object each call', () => {
    const a = createGradeState();
    a.blastsFired = 9;
    expect(createGradeState().blastsFired).toBe(0);
  });
});

describe('gradeDef — named grades', () => {
  it.each([
    [1, 20_000, 48, [['ore_kg', 5_000], ['blasts', 2]]],
    [2, 75_000, 72, [['ore_kg', 30_000], ['depth_m', 10], ['safety', 40]]],
    [3, 250_000, 96, [['ore_kg', 150_000], ['depth_m', 20], ['neighbours', 35], ['no_death', 1_000]]],
    [4, 800_000, 120, [['ore_kg', 600_000], ['depth_m', 30], ['safety', 50], ['ecology', 30]]],
    [5, 2_500_000, 144, [['ore_kg', 2_500_000], ['depth_m', 40], ['neighbours', 40], ['no_death', 2_000]]],
  ] as const)('grade %i has fee %i, %i processing ticks and its table targets', (grade, fee, ticks, targets) => {
    const def = gradeDef(grade);
    expect(def.grade).toBe(grade);
    expect(def.fee).toBe(fee);
    expect(def.processingTicks).toBe(ticks);
    expect(def.targets.map(t => [t.kind, t.value])).toEqual(targets);
    expect(def.nameKey).toBe(MINE_GRADES[grade]!.nameKey);
  });

  it('grade 0 is the start grade: free, no targets', () => {
    const def = gradeDef(0);
    expect(def.grade).toBe(0);
    expect(def.fee).toBe(0);
    expect(def.targets).toEqual([]);
  });
});

describe('gradeDef — endless classes', () => {
  it('class 1 (grade 6) asks 6,250 t ore, 60,000 m3 rock, fee 5,000,000, 144 ticks', () => {
    const def = gradeDef(6);
    expect(def.grade).toBe(6);
    expect(def.fee).toBe(5_000_000);
    expect(def.processingTicks).toBe(144);
    expect(def.targets.find(t => t.kind === 'ore_kg')?.value).toBe(6_250_000);
    expect(def.targets.find(t => t.kind === 'rock_m3')?.value).toBe(60_000);
  });

  it('class 1 asks rock broken instead of depth', () => {
    expect(gradeDef(6).targets.some(t => t.kind === 'depth_m')).toBe(false);
  });

  it('class 2 multiplies ore by 2.5, fee by 2 and rock by 2', () => {
    const def = gradeDef(7);
    expect(def.fee).toBe(10_000_000);
    expect(def.targets.find(t => t.kind === 'ore_kg')?.value).toBe(15_625_000);
    expect(def.targets.find(t => t.kind === 'rock_m3')?.value).toBe(120_000);
  });

  it('class 3 keeps compounding', () => {
    const def = gradeDef(8);
    expect(def.fee).toBe(20_000_000);
    expect(def.targets.find(t => t.kind === 'rock_m3')?.value).toBe(240_000);
    expect(def.targets.find(t => t.kind === 'ore_kg')?.value).toBe(39_062_500);
  });

  it('is endless: a far class has a finite definition', () => {
    const def = gradeDef(30);
    expect(Number.isFinite(def.fee)).toBe(true);
    expect(def.fee).toBe(5_000_000 * 2 ** 24);
    expect(def.processingTicks).toBe(144);
  });

  it('each class carries its class number in the name params', () => {
    expect(Object.values(gradeDef(6).nameParams ?? {})).toContain(1);
    expect(Object.values(gradeDef(9).nameParams ?? {})).toContain(4);
    expect(gradeDef(6).nameKey).not.toBe(gradeDef(5).nameKey);
  });
});

describe('nextGradeTargets', () => {
  it('is empty on a site without a ladder', () => {
    expect(nextGradeTargets(createGame({ seed: 42 }))).toEqual([]);
  });

  it('lists the grade-1 targets of a fresh progression site, unmet', () => {
    const targets = nextGradeTargets(progressionState());
    expect(targets.map(t => t.kind)).toEqual(['ore_kg', 'blasts']);
    expect(targets.every(t => !t.met)).toBe(true);
    expect(targetOf(progressionState(), 'ore_kg')).toMatchObject({ current: 0, needed: 5_000 });
    expect(targetOf(progressionState(), 'blasts')).toMatchObject({ current: 0, needed: 2 });
  });

  it('ore_kg: one kg short is unmet, exactly the need is met', () => {
    expect(targetOf(progressionState({ oreDeliveredKg: 4_999 }), 'ore_kg').met).toBe(false);
    const t = targetOf(progressionState({ oreDeliveredKg: 5_000 }), 'ore_kg');
    expect(t.met).toBe(true);
    expect(t.current).toBe(5_000);
  });

  it('blasts: 1 unmet, 2 met', () => {
    expect(targetOf(progressionState({ blastsFired: 1 }), 'blasts').met).toBe(false);
    expect(targetOf(progressionState({ blastsFired: 2 }), 'blasts').met).toBe(true);
  });

  it('depth_m (grade 2): 9.9 unmet, 10 met', () => {
    expect(targetOf(progressionState({ grade: 1, deepestPitM: 9.9 }), 'depth_m').met).toBe(false);
    const t = targetOf(progressionState({ grade: 1, deepestPitM: 10 }), 'depth_m');
    expect(t).toMatchObject({ met: true, needed: 10 });
  });

  it('safety (grade 2) reads the safety score: 39 unmet, 40 met', () => {
    const low = progressionState({ grade: 1 });
    low.scores.safety = 39;
    expect(targetOf(low, 'safety')).toMatchObject({ met: false, current: 39, needed: 40 });
    const ok = progressionState({ grade: 1 });
    ok.scores.safety = 40;
    expect(targetOf(ok, 'safety').met).toBe(true);
  });

  it('ecology (grade 4) reads the ecology score: 29 unmet, 30 met', () => {
    const low = progressionState({ grade: 3 });
    low.scores.ecology = 29;
    expect(targetOf(low, 'ecology').met).toBe(false);
    const ok = progressionState({ grade: 3 });
    ok.scores.ecology = 30;
    expect(targetOf(ok, 'ecology').met).toBe(true);
  });

  it('neighbours (grade 3) reads the nuisance score: 34 unmet, 35 met', () => {
    const low = progressionState({ grade: 2 });
    low.scores.nuisance = 34;
    expect(targetOf(low, 'neighbours').met).toBe(false);
    const ok = progressionState({ grade: 2 });
    ok.scores.nuisance = 35;
    expect(targetOf(ok, 'neighbours')).toMatchObject({ met: true, needed: 35 });
  });

  it('no_death (grade 3): a death inside the 1,000-tick window fails, one just outside passes', () => {
    const state = progressionState({ grade: 2 });
    state.tickCount = 5_000;
    expect(targetOf(state, 'no_death').met).toBe(true);
    state.damage.accidents.push({ tick: 4_500, type: 'death', entityId: 1, fragmentId: -1, kineticEnergy: 0 });
    expect(targetOf(state, 'no_death').met).toBe(false);
    state.damage.accidents.length = 0;
    state.damage.accidents.push({ tick: 3_999, type: 'death', entityId: 1, fragmentId: -1, kineticEnergy: 0 });
    expect(targetOf(state, 'no_death').met).toBe(true);
  });

  it('no_death ignores injuries', () => {
    const state = progressionState({ grade: 2 });
    state.tickCount = 5_000;
    state.damage.accidents.push({ tick: 4_990, type: 'injury', entityId: 1, fragmentId: -1, kineticEnergy: 0 });
    expect(targetOf(state, 'no_death').met).toBe(true);
  });

  it('no_death (grade 5) uses the 2,000-tick window', () => {
    const state = progressionState({ grade: 4 });
    state.tickCount = 5_000;
    state.damage.accidents.push({ tick: 3_500, type: 'death', entityId: 1, fragmentId: -1, kineticEnergy: 0 });
    expect(targetOf(state, 'no_death').met).toBe(false);
  });

  it('rock_m3 (class 1): 59,999 unmet, 60,000 met', () => {
    expect(targetOf(progressionState({ grade: 5, rockBrokenM3: 59_999 }), 'rock_m3').met).toBe(false);
    expect(targetOf(progressionState({ grade: 5, rockBrokenM3: 60_000 }), 'rock_m3')).toMatchObject({ met: true, needed: 60_000 });
  });

  it('follows the grade: grade 1 asks the grade-2 targets', () => {
    expect(nextGradeTargets(progressionState({ grade: 1 })).map(t => t.kind)).toEqual(['ore_kg', 'depth_m', 'safety']);
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

  it('pending beats unmet targets', () => {
    const state = progressionState({ pending: { toGrade: 1, ticksLeft: 10 } });
    expect(applyForGrade(state)).toMatchObject({ ok: false, refusal: 'pending' });
  });

  it('unmet_targets names every unmet kind', () => {
    const state = progressionState();
    state.cash = 1_000_000;
    expect(applyForGrade(state)).toEqual({ ok: false, refusal: 'unmet_targets', unmet: ['ore_kg', 'blasts'] });
  });

  it('unmet_targets names only the kinds still unmet', () => {
    const state = progressionState({ oreDeliveredKg: 5_000 });
    state.cash = 1_000_000;
    expect(applyForGrade(state)).toEqual({ ok: false, refusal: 'unmet_targets', unmet: ['blasts'] });
  });

  it('unmet_targets beats insufficient_funds', () => {
    const state = progressionState();
    state.cash = 0;
    expect(applyForGrade(state)).toMatchObject({ refusal: 'unmet_targets' });
  });

  it('insufficient_funds when cash is below the fee', () => {
    const state = readyForGrade1();
    state.cash = 19_999;
    expect(applyForGrade(state)).toMatchObject({ ok: false, refusal: 'insufficient_funds' });
  });

  it('a refusal books nothing and starts nothing', () => {
    const state = readyForGrade1();
    state.cash = 19_999;
    const txBefore = state.finances.transactions.length;
    applyForGrade(state);
    expect(state.cash).toBe(19_999);
    expect(state.finances.transactions.length).toBe(txBefore);
    expect(state.grade!.pending).toBeNull();
  });
});

describe('applyForGrade — success', () => {
  it('returns the fee and target grade', () => {
    expect(applyForGrade(readyForGrade1())).toEqual({ ok: true, fee: 20_000, toGrade: 1 });
  });

  it('cash exactly equal to the fee is enough', () => {
    const state = readyForGrade1();
    state.cash = 20_000;
    expect(applyForGrade(state).ok).toBe(true);
    expect(state.cash).toBe(0);
  });

  it('books the fee as a permits expense', () => {
    const state = readyForGrade1();
    const cashBefore = state.cash;
    applyForGrade(state);
    expect(state.cash).toBe(cashBefore - 20_000);
    const tx = state.finances.transactions.filter(t => t.category === 'permits');
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: 'expense', amount: 20_000 });
  });

  it('starts processing for the full 48 ticks without raising the grade', () => {
    const state = readyForGrade1();
    applyForGrade(state);
    expect(state.grade!.pending).toEqual({ toGrade: 1, ticksLeft: 48 });
    expect(state.grade!.grade).toBe(0);
  });

  it('a second application while pending is refused and charges nothing', () => {
    const state = readyForGrade1();
    applyForGrade(state);
    const cash = state.cash;
    expect(applyForGrade(state)).toMatchObject({ refusal: 'pending' });
    expect(state.cash).toBe(cash);
  });
});

describe('advanceGradeApplication', () => {
  it('raises the grade after exactly 48 ticks and emits progression:grade_approved', () => {
    const state = readyForGrade1();
    const emitter = new EventEmitter();
    const approved: number[] = [];
    emitter.on('progression:grade_approved', e => approved.push(e.grade));
    applyForGrade(state);
    for (let i = 0; i < 47; i++) advanceGradeApplication(state, emitter);
    expect(state.grade!.grade).toBe(0);
    expect(state.grade!.pending).not.toBeNull();
    expect(approved).toEqual([]);
    advanceGradeApplication(state, emitter);
    expect(state.grade!.grade).toBe(1);
    expect(state.grade!.pending).toBeNull();
    expect(approved).toEqual([1]);
  });

  it('counts down one tick at a time', () => {
    const state = readyForGrade1();
    applyForGrade(state);
    advanceGradeApplication(state, new EventEmitter());
    expect(state.grade!.pending?.ticksLeft).toBe(47);
  });

  it('does nothing without a pending application', () => {
    const state = progressionState();
    const emitter = new EventEmitter();
    let fired = 0;
    emitter.on('progression:grade_approved', () => fired++);
    advanceGradeApplication(state, emitter);
    expect(state.grade).toEqual(createGradeState());
    expect(fired).toBe(0);
  });

  it('is a no-op on a site without grade state', () => {
    const state = createGame({ seed: 42 });
    expect(() => advanceGradeApplication(state, new EventEmitter())).not.toThrow();
    expect(state.grade).toBeUndefined();
  });

  it('after approval the next targets are the next grade, and a new application is possible', () => {
    const state = readyForGrade1();
    applyForGrade(state);
    for (let i = 0; i < 48; i++) advanceGradeApplication(state, new EventEmitter());
    expect(nextGradeTargets(state).map(t => t.kind)).toEqual(['ore_kg', 'depth_m', 'safety']);
    expect(applyForGrade(state)).toMatchObject({ refusal: 'unmet_targets' });
  });

  it('there is no demotion: targets are checked only at application', () => {
    const state = readyForGrade1();
    applyForGrade(state);
    state.grade!.oreDeliveredKg = 0;
    for (let i = 0; i < 48; i++) advanceGradeApplication(state, new EventEmitter());
    expect(state.grade!.grade).toBe(1);
  });
});

describe('sanitizeGradeState', () => {
  const valid = (): GradeState => ({
    grade: 2, oreDeliveredKg: 1500.5, deepestPitM: 11, rockBrokenM3: 300, blastsFired: 4,
    pending: { toGrade: 3, ticksLeft: 20 }, strikeTicks: [], inspectionRolls: 0, lastBlastChargeShare: 0, unseenApproval: null,
  });

  it('accepts a valid state, pending or not', () => {
    expect(sanitizeGradeState(valid())).toEqual(valid());
    expect(sanitizeGradeState({ ...valid(), pending: null })).toEqual({ ...valid(), pending: null });
  });

  it('accepts a fresh state', () => {
    expect(sanitizeGradeState(createGradeState())).toEqual(createGradeState());
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
  ])('rejects %s', (_n, patch) => {
    expect(sanitizeGradeState({ ...valid(), ...patch })).toBeUndefined();
  });

  it('rejects a state with a missing tracker', () => {
    const raw: Record<string, unknown> = { ...valid() };
    delete raw['rockBrokenM3'];
    expect(sanitizeGradeState(raw)).toBeUndefined();
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
    const state = readyForGrade1();
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

  it('still works without an emitter', () => {
    expect(applyForGrade(readyForGrade1()).ok).toBe(true);
  });
});

describe('unlockLinesFor (#1926)', () => {
  const EN_HINTS: Record<number, string> = {
    1: 'Your pile of rubble is a logistics problem now.',
    2: 'Deeper benches: keep the floor clear before you drill.',
    3: 'Tall walls get ideas. Leave berms.',
    4: 'Big trucks hate steep ramps. Think spiral.',
    5: 'The whole planet is watching. Mostly the neighbours.',
  };

  it.each([1, 2, 3, 4, 5])('grade %i lists the permit limits, then flavour, then hint, in that order', (g) => {
    const lines = unlockLinesFor(g);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const limits = permitLimitsFor(g);
    expect(lines[0]!.params).toMatchObject({ maxChargeKg: limits.maxChargeKg, maxHoles: limits.maxHoles, fee: limits.fee });
    const keys = lines.map(l => l.key);
    expect(keys.indexOf(`progression.unlock.flavour.${g}`)).toBe(1);
    expect(keys.indexOf(`progression.unlock.hint.${g}`)).toBe(2);
  });

  it.each([1, 2, 3, 4, 5])('grade %i hint reads the issue text in English', (g) => {
    setLocale('en');
    expect(t(`progression.unlock.hint.${g}`)).toBe(EN_HINTS[g]);
  });

  it('every seeded line key resolves to real text in en and fr, not the raw key', () => {
    for (const g of [1, 2, 3, 4, 5, 6, 9]) {
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

  it('endless classes get the limits line plus generic class flavour and hint', () => {
    for (const g of [6, 7, 12]) {
      const lines = unlockLinesFor(g);
      const limits = permitLimitsFor(g);
      expect(lines[0]!.params).toMatchObject({ maxChargeKg: limits.maxChargeKg, maxHoles: limits.maxHoles, fee: limits.fee });
      const keys = lines.map(l => l.key);
      expect(keys).toContain('progression.unlock.flavour.class');
      expect(keys).toContain('progression.unlock.hint.class');
      expect(keys.some(k => /\.[1-5]$/.test(k))).toBe(false);
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

  it('a class line registered later appears for every endless class', () => {
    registerUnlockLine({ grade: 'class', key: 'test.unlock.class' });
    expect(unlockLinesFor(6).map(l => l.key)).toContain('test.unlock.class');
    expect(unlockLinesFor(8).map(l => l.key)).toContain('test.unlock.class');
    expect(unlockLinesFor(5).map(l => l.key)).not.toContain('test.unlock.class');
  });
});
