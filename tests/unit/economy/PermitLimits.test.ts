// BlastSimulator2026 — Permit limits: per-blast caps, inspections, strikes, suspension (#1923)

import { describe, it, expect } from 'vitest';
import {
  permitLimitsFor,
  permitLimitsForRung,
  preFireCheck,
  liveStrikes,
  inspectionChance,
  inspectionFine,
  rollInspection,
  resolveOvershoot,
} from '../../../src/core/economy/PermitLimits.js';
import { createGradeState, sanitizeGradeState, gradeRung, type GradeState } from '../../../src/core/economy/MineGrade.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { Random, rollSeed } from '../../../src/core/math/Random.js';
import { isActive } from '../../../src/core/events/ActiveModifiers.js';
import { DRILL_GRID_DEFAULT_SPACING_M, PERMIT_CLASS_AREA_FACTOR, PERMIT_CLASS_CHARGE_FACTOR, PERMIT_CLASS_FEE_FACTOR, PERMIT_LIMITS } from '../../../src/core/config/balance.js';
import { RUNGS, NAMED_GRADES, TIERS, rungOf, gradeTierOfRung, perkTotals } from '../../helpers/gradeLadder.js';

const SEED = 42;

/** Pattern area (m²) of `holes` holes on the default 4 m x 4 m grid cell, what `patternAreaM2` measures for such a grid. */
const areaOf = (holes: number): number => holes * DRILL_GRID_DEFAULT_SPACING_M ** 2;

function charges(count: number, kgEach: number): Record<string, { amountKg: number }> {
  const out: Record<string, { amountKg: number }> = {};
  for (let i = 0; i < count; i++) out[`h${i}`] = { amountKg: kgEach };
  return out;
}

function site(tick = 500): { state: GameState; g: GradeState; emitter: EventEmitter } {
  const state = createGame({ seed: SEED });
  state.tickCount = tick;
  state.cash = 1_000_000;
  const g = createGradeState();
  state.grade = g;
  return { state, g, emitter: new EventEmitter() };
}

/** The verdict the seeded roll gives at `tick` as the `salt`-th roll, from the same seed recipe the bribe rolls use. */
function predictedInspection(tick: number, salt: number, overshoot: number): boolean {
  return rollInspection(new Random(rollSeed(SEED, tick, salt)), overshoot);
}

function findTick(overshoot: number, wantInspected: boolean, salt = 0): number {
  for (let tick = 1; tick < 1000; tick++) {
    if (predictedInspection(tick, salt, overshoot) === wantInspected) return tick;
  }
  throw new Error(`no tick with inspected=${wantInspected}`);
}

/** Table fee less the notification-fee perk of the rung, however the rounding falls. */
function expectDiscountedFee(actual: number, tableFee: number, rung: number): void {
  const exact = tableFee * (1 - perkTotals(rung).notification_fee_pct / 100);
  expect(Math.abs(actual - exact)).toBeLessThanOrEqual(1.5);
}

describe('permitLimitsFor and permitLimitsForRung (#2277)', () => {
  it('grade 0 tier 1 keeps the old grade-0 caps and fee: 40 kg, 144 m², $250', () => {
    expect(permitLimitsFor(0, 1)).toEqual({ maxChargeKg: 40, maxAreaM2: 144, fee: 250 });
    expect(permitLimitsForRung(0)).toEqual({ maxChargeKg: 40, maxAreaM2: 144, fee: 250 });
  });

  it('grade 3 tier 3 reaches the old grade-5 caps: 25,000 kg and 6,400 m²', () => {
    const l = permitLimitsFor(3, 3);
    expect(l.maxChargeKg).toBe(25_000);
    expect(l.maxAreaM2).toBe(6_400);
    expect(permitLimitsForRung(11)).toEqual(l);
  });

  it('tier defaults to 1', () => {
    for (const g of NAMED_GRADES) expect(permitLimitsFor(g)).toEqual(permitLimitsFor(g, 1));
  });

  it('grade x tier maps onto the rung table, and the two entry points agree', () => {
    for (const g of NAMED_GRADES) for (const tier of TIERS) {
      const rung = rungOf(g, tier);
      expect(permitLimitsFor(g, tier)).toEqual(permitLimitsForRung(rung));
      expect(permitLimitsForRung(rung).maxChargeKg).toBe(PERMIT_LIMITS[rung]!.maxChargeKg);
      expect(permitLimitsForRung(rung).maxAreaM2).toBe(PERMIT_LIMITS[rung]!.maxAreaM2);
    }
  });

  it('caps rise at every tier and never fall: strictly increasing charge and area across all 12 steps', () => {
    for (let rung = 1; rung <= 11; rung++) {
      const a = permitLimitsForRung(rung - 1);
      const b = permitLimitsForRung(rung);
      const { grade, tier } = gradeTierOfRung(rung);
      expect(b.maxChargeKg, `grade ${grade} tier ${tier} charge`).toBeGreaterThan(a.maxChargeKg);
      expect(b.maxAreaM2, `grade ${grade} tier ${tier} area`).toBeGreaterThan(a.maxAreaM2);
    }
  });

  it('caps rise through the endless classes too, from the last named step', () => {
    for (let rung = 12; rung <= 40; rung++) {
      expect(permitLimitsForRung(rung).maxChargeKg).toBeGreaterThan(permitLimitsForRung(rung - 1).maxChargeKg);
      expect(permitLimitsForRung(rung).maxAreaM2).toBeGreaterThan(permitLimitsForRung(rung - 1).maxAreaM2);
    }
  });

  it('the notification fee is the table fee less the rung\'s notification-fee perk', () => {
    for (const rung of RUNGS) expectDiscountedFee(permitLimitsForRung(rung).fee, PERMIT_LIMITS[rung]!.fee, rung);
  });

  it('a rung with a notification-fee perk pays less than the table fee', () => {
    const rung = [...RUNGS].reverse().find(r => perkTotals(r).notification_fee_pct > 0)!;
    expect(permitLimitsForRung(rung).fee).toBeLessThan(PERMIT_LIMITS[rung]!.fee);
  });

  it('the first class is grade 4: 1.6x charge, 1.4x area, 1.5x fee from the last named step', () => {
    expect(PERMIT_CLASS_AREA_FACTOR).toBe(1.4);
    expect(PERMIT_CLASS_CHARGE_FACTOR).toBe(1.6);
    expect(PERMIT_CLASS_FEE_FACTOR).toBe(1.5);
    const l = permitLimitsFor(4);
    expect(l.maxChargeKg).toBe(40_000);
    expect(l.maxAreaM2).toBe(8_960);
    expectDiscountedFee(l.fee, 75_000, 11);
  });

  it('grade 5 compounds the class factors', () => {
    const l = permitLimitsFor(5);
    expect(l.maxChargeKg).toBe(Math.round(25_000 * 1.6 ** 2));
    expect(l.maxAreaM2).toBe(Math.round(6_400 * 1.4 ** 2));
    expectDiscountedFee(l.fee, Math.round(50_000 * 1.5 ** 2), 11);
  });

  it('endless classes follow the formula for grade 3 + k, and the rung 11 + k reads the same', () => {
    for (let k = 1; k <= 8; k++) {
      const l = permitLimitsFor(3 + k);
      expect(l.maxChargeKg).toBe(Math.round(25_000 * 1.6 ** k));
      expect(l.maxAreaM2).toBe(Math.round(6_400 * 1.4 ** k));
      expect(permitLimitsForRung(11 + k)).toEqual(l);
    }
  });

  it('a class is a step above the last named one in charge and area', () => {
    expect(permitLimitsFor(4).maxChargeKg).toBeGreaterThan(permitLimitsFor(3, 3).maxChargeKg);
    expect(permitLimitsFor(4).maxAreaM2).toBeGreaterThan(permitLimitsFor(3, 3).maxAreaM2);
  });

  it('charge, area and fee keep growing deep into the endless classes: the area has no hole cap to stop at', () => {
    for (const grade of [40, 200]) {
      expect(permitLimitsFor(grade + 1).maxChargeKg).toBeGreaterThan(permitLimitsFor(grade).maxChargeKg);
      expect(permitLimitsFor(grade + 1).maxAreaM2).toBeGreaterThan(permitLimitsFor(grade).maxAreaM2);
      expect(permitLimitsFor(grade + 1).fee).toBeGreaterThan(permitLimitsFor(grade).fee);
    }
  });

  it('the grade and tier order is the rung order: every (grade, tier) is above the one before it', () => {
    let prev = permitLimitsFor(0, 1);
    for (const g of NAMED_GRADES) for (const tier of TIERS) {
      if (g === 0 && tier === 1) continue;
      const l = permitLimitsFor(g, tier);
      expect(l.maxChargeKg).toBeGreaterThan(prev.maxChargeKg);
      expect(l.maxAreaM2).toBeGreaterThan(prev.maxAreaM2);
      prev = l;
    }
  });

  it('returns a fresh object, never the shared balance entry', () => {
    const a = permitLimitsFor(0);
    a.fee = 1;
    a.maxChargeKg = 1;
    expect(permitLimitsFor(0).fee).toBe(250);
    expect(PERMIT_LIMITS[0]!.fee).toBe(250);
    expect(PERMIT_LIMITS[0]!.maxChargeKg).toBe(40);
    const b = permitLimitsForRung(3);
    b.maxAreaM2 = 1;
    expect(permitLimitsForRung(3).maxAreaM2).toBe(PERMIT_LIMITS[3]!.maxAreaM2);
  });
});

describe('preFireCheck', () => {
  it('the standard opening (a 4 m 3x3 at 4 kg a hole: 36 kg over 144 m²) is within the grade-0 permit', () => {
    const c = preFireCheck(0, charges(9, 4), areaOf(9));
    expect(c.over).toBe(false);
    expect(c.overshoot).toBe(0);
    expect(c.planKg).toBe(36);
    expect(c.planAreaM2).toBe(144);
    expect(c.fee).toBe(250);
    expect(c.limits).toEqual({ maxChargeKg: 40, maxAreaM2: 144, fee: 250 });
  });

  it('exactly at both limits is not over', () => {
    const c = preFireCheck(0, charges(8, 5), areaOf(9));
    expect(c.planKg).toBe(40);
    expect(c.planAreaM2).toBe(permitLimitsFor(0).maxAreaM2);
    expect(c.over).toBe(false);
    expect(c.overshoot).toBe(0);
  });

  it('a 3x3 at 5 kg per hole (45 kg) is over by 12.5%', () => {
    const c = preFireCheck(0, charges(9, 5), areaOf(9));
    expect(c.planKg).toBe(45);
    expect(c.over).toBe(true);
    expect(c.overshoot).toBeCloseTo(0.125, 10);
  });

  it('too much area alone is over, by its fraction of the limit', () => {
    const c = preFireCheck(0, charges(12, 1), areaOf(12));
    expect(c.over).toBe(true);
    expect(c.overshoot).toBeCloseTo((192 - 144) / 144, 10);
  });

  it('a hair over the area limit is over', () => {
    const c = preFireCheck(0, {}, 144.5);
    expect(c.over).toBe(true);
    expect(c.overshoot).toBeCloseTo(0.5 / 144, 10);
  });

  it('the larger of the two shares counts', () => {
    // 45 kg is 12.5% over, 288 m² is 100% over.
    const c = preFireCheck(0, charges(9, 5), areaOf(18));
    expect(c.overshoot).toBeCloseTo(1, 10);
    // 80 kg is 100% over, 160 m² is 11% over.
    expect(preFireCheck(0, charges(8, 10), areaOf(10)).overshoot).toBeCloseTo(1, 10);
  });

  it('the area comes from the argument, the kg from the charges', () => {
    const c = preFireCheck(0, charges(2, 5), areaOf(9));
    expect(c.planKg).toBe(10);
    expect(c.planAreaM2).toBe(144);
    expect(c.over).toBe(false);
  });

  it('an empty plan is within every permit', () => {
    const c = preFireCheck(0, {}, 0);
    expect(c.over).toBe(false);
    expect(c.planKg).toBe(0);
    expect(c.planAreaM2).toBe(0);
    expect(c.overshoot).toBe(0);
  });

  it('a higher tier admits the same plan and charges its own fee', () => {
    const c = preFireCheck(1, charges(9, 5), areaOf(9));
    expect(c.over).toBe(false);
    expect(c.fee).toBe(permitLimitsForRung(1).fee);
    expect(c.limits).toEqual(permitLimitsForRung(1));
  });

  it('the plan that is over the first step is within the second: a tier-up widens the permit', () => {
    expect(preFireCheck(0, charges(9, 5), areaOf(9)).over).toBe(true);
    expect(preFireCheck(1, charges(9, 5), areaOf(9)).over).toBe(false);
  });

  it('takes the rung, not the grade: rung 11 holds a plan rung 8 refuses', () => {
    const big = charges(1, permitLimitsForRung(11).maxChargeKg);
    expect(preFireCheck(11, big, areaOf(1)).over).toBe(false);
    expect(preFireCheck(8, big, areaOf(1)).over).toBe(true);
  });

  it('the fee is due even when the plan is tiny', () => {
    expect(preFireCheck(8, charges(1, 1), areaOf(1)).fee).toBe(permitLimitsForRung(8).fee);
  });

  it('works on an endless class', () => {
    const rung = gradeRung({ grade: 5, tier: 1 });
    const l = permitLimitsForRung(rung);
    const c = preFireCheck(rung, charges(1, l.maxChargeKg * 2), areaOf(1));
    expect(c.over).toBe(true);
    expect(c.overshoot).toBeCloseTo(1, 10);
    expect(c.fee).toBe(l.fee);
  });

  it('measures an endless class\'s area against its own, larger limit', () => {
    const rung = gradeRung({ grade: 4, tier: 1 });
    const l = permitLimitsForRung(rung);
    expect(preFireCheck(rung, {}, l.maxAreaM2).over).toBe(false);
    expect(preFireCheck(rung, {}, l.maxAreaM2 * 1.5).overshoot).toBeCloseTo(0.5, 10);
  });
});

describe('inspectionChance', () => {
  it('is 25% plus the overshoot', () => {
    expect(inspectionChance(0.125)).toBeCloseTo(0.375, 10);
    expect(inspectionChance(0.5)).toBeCloseTo(0.75, 10);
  });

  it('caps at certainty', () => {
    expect(inspectionChance(0.75)).toBe(1);
    expect(inspectionChance(5)).toBe(1);
  });

  it('a hair over the limit is still a quarter chance', () => {
    expect(inspectionChance(0.0001)).toBeCloseTo(0.2501, 10);
  });

  it('the rung defaults to 0: no perk', () => {
    expect(inspectionChance(0.125, 0)).toBe(inspectionChance(0.125));
  });

  it.each(RUNGS)('rung %i cuts the base chance by its inspection perk', (rung) => {
    const pct = perkTotals(rung).inspection_pct;
    expect(inspectionChance(0.125, rung)).toBeCloseTo(0.375 * (1 - pct / 100), 10);
  });

  it('a higher rung never raises the chance, and the top rung lowers it', () => {
    for (let rung = 1; rung <= 11; rung++) {
      expect(inspectionChance(0.125, rung)).toBeLessThanOrEqual(inspectionChance(0.125, rung - 1) + 1e-12);
    }
    expect(inspectionChance(0.125, 11)).toBeLessThan(inspectionChance(0.125, 0));
  });

  it('stays a probability at every rung, however far over the limit', () => {
    for (const rung of [0, 5, 11, 14, 40]) {
      const c = inspectionChance(50, rung);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('an endless class keeps the perks of the last named step', () => {
    expect(inspectionChance(0.125, 14)).toBeCloseTo(inspectionChance(0.125, 11), 10);
  });
});

describe('inspectionFine', () => {
  it('is ten notification fees scaled by (1 + overshoot), rounded', () => {
    expect(inspectionFine(250, 0.125)).toBe(Math.round(10 * 250 * 1.125));
    expect(inspectionFine(250, 0.125)).toBe(2813);
  });

  it('at zero overshoot is exactly ten fees', () => {
    expect(inspectionFine(1_000, 0)).toBe(10_000);
  });

  it('doubles the base at 100% overshoot', () => {
    expect(inspectionFine(3_000, 1)).toBe(60_000);
  });

  it('is a whole number', () => {
    expect(Number.isInteger(inspectionFine(250, 0.333))).toBe(true);
  });
});

describe('rollInspection', () => {
  it('is deterministic for a seed', () => {
    for (let tick = 1; tick < 50; tick++) {
      expect(predictedInspection(tick, 0, 0.125)).toBe(predictedInspection(tick, 0, 0.125));
    }
  });

  it('always inspects once the chance reaches certainty', () => {
    for (let tick = 1; tick < 50; tick++) {
      expect(rollInspection(new Random(rollSeed(SEED, tick, 0)), 10)).toBe(true);
    }
  });

  it('inspects some seeds and spares others at a middling overshoot', () => {
    const outcomes = new Set<boolean>();
    for (let tick = 1; tick < 200; tick++) outcomes.add(predictedInspection(tick, 0, 0.125));
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it('a higher rung inspects less often over the same ticks, never more', () => {
    let low = 0;
    let high = 0;
    for (let tick = 1; tick < 3000; tick++) {
      if (rollInspection(new Random(rollSeed(SEED, tick, 0)), 0.125, 0)) low++;
      if (rollInspection(new Random(rollSeed(SEED, tick, 0)), 0.125, 11)) high++;
    }
    expect(high).toBeLessThan(low);
  });

  it('rung 0 is the default', () => {
    for (let tick = 1; tick < 200; tick++) {
      expect(rollInspection(new Random(rollSeed(SEED, tick, 0)), 0.125, 0)).toBe(rollInspection(new Random(rollSeed(SEED, tick, 0)), 0.125));
    }
  });

  it('a larger overshoot inspects at least as often', () => {
    let small = 0;
    let large = 0;
    for (let tick = 1; tick < 400; tick++) {
      if (predictedInspection(tick, 0, 0.05)) small++;
      if (predictedInspection(tick, 0, 0.5)) large++;
    }
    expect(large).toBeGreaterThan(small);
  });
});

describe('liveStrikes', () => {
  it('keeps strikes newer than 2000 ticks', () => {
    expect(liveStrikes([1500, 2099], 2100)).toEqual([1500, 2099]);
  });

  it('a strike exactly 2000 ticks old has lapsed', () => {
    expect(liveStrikes([100], 2100)).toEqual([]);
    expect(liveStrikes([101], 2100)).toEqual([101]);
  });

  it('drops only the lapsed ones', () => {
    expect(liveStrikes([10, 100, 1900, 2000], 2100)).toEqual([1900, 2000]);
  });

  it('empty in, empty out', () => {
    expect(liveStrikes([], 5000)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [10, 3000];
    liveStrikes(input, 3100);
    expect(input).toEqual([10, 3000]);
  });
});

describe('resolveOvershoot', () => {
  const overshoot = 0.125;
  const check = () => preFireCheck(0, charges(9, 5), areaOf(9));

  it('a caught blast pays the fine under fines, loses 5 neighbour points and takes a strike', () => {
    const tick = findTick(overshoot, true);
    const { state, g, emitter } = site(tick);
    const cash = state.cash;
    const nuisance = state.scores.nuisance;
    const v = resolveOvershoot(state, g, check(), emitter);
    expect(v.rolled).toBe(true);
    expect(v.caught).toBe(true);
    expect(v.fine).toBe(inspectionFine(250, overshoot));
    expect(v.overshoot).toBeCloseTo(overshoot, 10);
    expect(v.strikes).toBe(1);
    expect(v.suspended).toBe(false);
    expect(state.cash).toBe(cash - v.fine);
    const fines = state.finances.transactions.filter(t => t.category === 'fines');
    expect(fines).toHaveLength(1);
    expect(fines[0]!.amount).toBe(v.fine);
    expect(state.scores.nuisance).toBe(nuisance - 5);
    expect(g.strikeTicks).toEqual([tick]);
  });

  it('a spared blast costs nothing and takes no strike', () => {
    const tick = findTick(overshoot, false);
    const { state, g, emitter } = site(tick);
    const cash = state.cash;
    const nuisance = state.scores.nuisance;
    const v = resolveOvershoot(state, g, check(), emitter);
    expect(v.rolled).toBe(true);
    expect(v.caught).toBe(false);
    expect(v.fine).toBe(0);
    expect(v.suspended).toBe(false);
    expect(state.cash).toBe(cash);
    expect(state.scores.nuisance).toBe(nuisance);
    expect(g.strikeTicks).toEqual([]);
    expect(state.finances.transactions.filter(t => t.category === 'fines')).toHaveLength(0);
  });

  it('the verdict is deterministic for a seed and tick', () => {
    for (const wantInspected of [true, false]) {
      const tick = findTick(overshoot, wantInspected);
      const a = site(tick);
      const b = site(tick);
      const va = resolveOvershoot(a.state, a.g, check(), a.emitter);
      const vb = resolveOvershoot(b.state, b.g, check(), b.emitter);
      expect(va).toEqual(vb);
      expect(va.caught).toBe(wantInspected);
    }
  });

  it('each roll advances the salt counter', () => {
    const { state, g, emitter } = site(500);
    expect(g.inspectionRolls ?? 0).toBe(0);
    resolveOvershoot(state, g, check(), emitter);
    expect(g.inspectionRolls).toBe(1);
    resolveOvershoot(state, g, check(), emitter);
    expect(g.inspectionRolls).toBe(2);
  });

  it('the second roll in one tick uses the next salt, not the first again', () => {
    // A tick where salt 0 spares and salt 1 inspects: the two rolls must differ.
    let tick = -1;
    for (let t = 1; t < 2000; t++) {
      if (!predictedInspection(t, 0, overshoot) && predictedInspection(t, 1, overshoot)) { tick = t; break; }
    }
    expect(tick).toBeGreaterThan(0);
    const { state, g, emitter } = site(tick);
    expect(resolveOvershoot(state, g, check(), emitter).caught).toBe(false);
    expect(resolveOvershoot(state, g, check(), emitter).caught).toBe(true);
  });

  it('a roll continues from the stored counter', () => {
    const tick = findTick(overshoot, true, 3);
    const { state, g, emitter } = site(tick);
    g.inspectionRolls = 3;
    expect(resolveOvershoot(state, g, check(), emitter).caught).toBe(true);
    expect(g.inspectionRolls).toBe(4);
  });

  it('a larger overshoot costs a larger fine', () => {
    const big = preFireCheck(0, charges(8, 10), areaOf(18)); // 100% over on both
    const tick = findTick(1, true);
    const { state, g, emitter } = site(tick);
    const v = resolveOvershoot(state, g, big, emitter);
    expect(v.caught).toBe(true);
    expect(v.fine).toBe(inspectionFine(250, 1));
  });

  it('neighbour relations never drop below zero', () => {
    const tick = findTick(overshoot, true);
    const { state, g, emitter } = site(tick);
    state.scores.nuisance = 3;
    resolveOvershoot(state, g, check(), emitter);
    expect(state.scores.nuisance).toBe(0);
  });

  it('emits progression:blast_inspected with the verdict', () => {
    const tick = findTick(overshoot, true);
    const { state, g, emitter } = site(tick);
    const seen: unknown[] = [];
    emitter.on('progression:blast_inspected', e => seen.push(e));
    const v = resolveOvershoot(state, g, check(), emitter);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      overshoot: v.overshoot, caught: true, fine: v.fine, strikes: v.strikes, suspended: false,
    });
  });

  it('emits for a spared blast too, with no fine', () => {
    const tick = findTick(overshoot, false);
    const { state, g, emitter } = site(tick);
    const seen: Array<{ caught: boolean; fine: number }> = [];
    emitter.on('progression:blast_inspected', e => seen.push(e));
    resolveOvershoot(state, g, check(), emitter);
    expect(seen).toEqual([expect.objectContaining({ caught: false, fine: 0 })]);
  });

  it('the tier perk spares a roll the first step would have caught (the site\'s own rung decides)', () => {
    const planKg = 1.125 * permitLimitsForRung(11).maxChargeKg;
    const lowPlan = preFireCheck(0, charges(1, 45), areaOf(1));
    const highPlan = preFireCheck(11, charges(1, planKg), areaOf(1));
    const c0 = inspectionChance(lowPlan.overshoot, 0);
    const c11 = inspectionChance(highPlan.overshoot, 11);
    expect(c11).toBeLessThan(c0);
    let tick = -1;
    for (let t = 1; t < 5000 && tick < 0; t++) {
      const r = new Random(rollSeed(SEED, t, 0)).next();
      if (r >= c11 + 1e-9 && r < c0 - 1e-9) tick = t;
    }
    expect(tick).toBeGreaterThan(0);
    const first = site(tick);
    expect(resolveOvershoot(first.state, first.g, lowPlan, first.emitter).caught).toBe(true);
    const top = site(tick);
    top.g.grade = 3;
    top.g.tier = 3;
    expect(resolveOvershoot(top.state, top.g, highPlan, top.emitter).caught).toBe(false);
  });

  describe('strikes and suspension', () => {
    it('two live strikes plus a catch suspend the permit for 72 ticks', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      g.strikeTicks = [tick - 10, tick - 20];
      const v = resolveOvershoot(state, g, check(), emitter);
      expect(v.caught).toBe(true);
      expect(v.suspended).toBe(true);
      const ban = state.events.activeModifiers.find(m => m.kind === 'blast_ban');
      expect(ban).toBeDefined();
      expect(ban!.endTick).toBe(tick + 72);
      expect(isActive(state.events.activeModifiers, 'blast_ban', tick)).toBe(true);
      expect(isActive(state.events.activeModifiers, 'blast_ban', tick + 71)).toBe(true);
      expect(isActive(state.events.activeModifiers, 'blast_ban', tick + 72)).toBe(false);
    });

    it('suspension clears the strikes', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      g.strikeTicks = [tick - 10, tick - 20];
      resolveOvershoot(state, g, check(), emitter);
      expect(g.strikeTicks).toEqual([]);
    });

    it('strikes older than the window do not count toward suspension', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      g.strikeTicks = [tick - 2000, tick - 2500]; // exactly at and beyond the window edge
      const v = resolveOvershoot(state, g, check(), emitter);
      expect(v.caught).toBe(true);
      expect(v.suspended).toBe(false);
      expect(v.strikes).toBe(1);
      expect(g.strikeTicks).toEqual([tick]);
      expect(state.events.activeModifiers.some(m => m.kind === 'blast_ban')).toBe(false);
    });

    it('one live strike plus a catch is two strikes, not a suspension', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      g.strikeTicks = [tick - 100];
      const v = resolveOvershoot(state, g, check(), emitter);
      expect(v.strikes).toBe(2);
      expect(v.suspended).toBe(false);
      expect(g.strikeTicks).toEqual([tick - 100, tick]);
    });

    it('a spared blast with two live strikes does not suspend', () => {
      const tick = findTick(overshoot, false);
      const { state, g, emitter } = site(tick);
      g.strikeTicks = [tick - 10, tick - 20];
      const v = resolveOvershoot(state, g, check(), emitter);
      expect(v.suspended).toBe(false);
      expect(g.strikeTicks).toEqual([tick - 10, tick - 20]);
      expect(state.events.activeModifiers.some(m => m.kind === 'blast_ban')).toBe(false);
    });

    it('lapsed strikes are pruned from the state when a new one lands', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      g.strikeTicks = [tick - 3000, tick - 50];
      resolveOvershoot(state, g, check(), emitter);
      expect(g.strikeTicks).toEqual([tick - 50, tick]);
    });

    it('a suspension reached by the third strike reports it on the bus', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      g.strikeTicks = [tick - 1, tick - 2];
      const seen: Array<{ suspended: boolean }> = [];
      emitter.on('progression:blast_inspected', e => seen.push(e));
      resolveOvershoot(state, g, check(), emitter);
      expect(seen[0]!.suspended).toBe(true);
    });
  });

  describe('inspector protection', () => {
    const protect = (state: GameState, tick: number) => {
      state.corruption.protections.push({ target: 'inspector', expiresAtTick: tick + 100, dismissalsLeft: 0, shielded: false });
    };

    it('skips the roll entirely, even on a tick that would have been caught', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      protect(state, tick);
      const cash = state.cash;
      const v = resolveOvershoot(state, g, check(), emitter);
      expect(v.rolled).toBe(false);
      expect(v.caught).toBe(false);
      expect(v.fine).toBe(0);
      expect(state.cash).toBe(cash);
      expect(g.strikeTicks).toEqual([]);
    });

    it('does not consume a roll from the salt counter', () => {
      const { state, g, emitter } = site(500);
      g.inspectionRolls = 4;
      protect(state, 500);
      resolveOvershoot(state, g, check(), emitter);
      expect(g.inspectionRolls).toBe(4);
    });

    it('counts as having shielded something (the linger rule)', () => {
      const { state, g, emitter } = site(500);
      protect(state, 500);
      expect(state.corruption.protections[0]!.shielded).toBe(false);
      resolveOvershoot(state, g, check(), emitter);
      expect(state.corruption.protections[0]!.shielded).toBe(true);
    });

    it('never inspects across many ticks', () => {
      for (let tick = 1; tick < 100; tick++) {
        const { state, g, emitter } = site(tick);
        protect(state, tick);
        expect(resolveOvershoot(state, g, check(), emitter).caught).toBe(false);
      }
    });

    it('an expired protection no longer shields', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      state.corruption.protections.push({ target: 'inspector', expiresAtTick: tick - 1, dismissalsLeft: 0, shielded: true });
      expect(resolveOvershoot(state, g, check(), emitter).caught).toBe(true);
    });

    it('a protection from another target does not shield inspections', () => {
      const tick = findTick(overshoot, true);
      const { state, g, emitter } = site(tick);
      state.corruption.protections.push({ target: 'judge', expiresAtTick: tick + 100, dismissalsLeft: 1, shielded: false });
      const v = resolveOvershoot(state, g, check(), emitter);
      expect(v.rolled).toBe(true);
      expect(v.caught).toBe(true);
    });
  });
});

describe('GradeState strike bookkeeping (sanitize defaults)', () => {
  const base = (): Record<string, unknown> => ({
    grade: 2, oreDeliveredKg: 1500, deepestPitM: 11, rockBrokenM3: 300, blastsFired: 4, pending: null,
  });

  it('a fresh grade state has no strikes and no rolls', () => {
    const g = createGradeState();
    expect(g.strikeTicks).toEqual([]);
    expect(g.inspectionRolls).toBe(0);
  });

  it('strikes and roll count round-trip through sanitize', () => {
    const out = sanitizeGradeState({ ...base(), strikeTicks: [120, 340], inspectionRolls: 7 });
    expect(out?.strikeTicks).toEqual([120, 340]);
    expect(out?.inspectionRolls).toBe(7);
  });

  it('a save from before permit limits gets empty strikes and zero rolls', () => {
    const out = sanitizeGradeState(base());
    expect(out).toBeDefined();
    expect(out!.strikeTicks).toEqual([]);
    expect(out!.inspectionRolls).toBe(0);
  });

  it.each([
    ['a string', 'x'],
    ['a number', 4],
    ['negative ticks', [-5, 10]],
    ['non-numeric entries', ['a', 3]],
    ['NaN entries', [NaN]],
    ['fractional ticks', [1.5]],
  ])('malformed strikeTicks (%s) fall back to empty without rejecting the state', (_n, raw) => {
    const out = sanitizeGradeState({ ...base(), strikeTicks: raw });
    expect(out).toBeDefined();
    expect(out!.strikeTicks).toEqual([]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', NaN],
    ['a string', '3'],
  ])('a %s inspectionRolls falls back to zero', (_n, raw) => {
    const out = sanitizeGradeState({ ...base(), inspectionRolls: raw });
    expect(out).toBeDefined();
    expect(out!.inspectionRolls).toBe(0);
  });

  it('does not alias the input array', () => {
    const strikes = [10, 20];
    const out = sanitizeGradeState({ ...base(), strikeTicks: strikes });
    out!.strikeTicks!.push(30);
    expect(strikes).toEqual([10, 20]);
  });
});
