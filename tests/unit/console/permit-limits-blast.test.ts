// BlastSimulator2026 — Permit limits at detonation: fee, verdict and fine on every fire path (#1923)

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { Random, rollSeed } from '../../../src/core/math/Random.js';
import { inspectionFine, rollInspection } from '../../../src/core/economy/PermitLimits.js';
import { isActive } from '../../../src/core/events/ActiveModifiers.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { fundForDeliveryWait } from '../../helpers/playthrough.js';

const SEED = 42;
const FEE = 250;

/** Sandbox site with a 3x3 pattern drilled and charged at `kgPerHole`, ready to fire. */
function loadedSite(kgPerHole: number) {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands difficulty:normal seed:${SEED}`).success).toBe(true);
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  const refresh = () => {
    fundForDeliveryWait(state);
    for (const e of state.employees.employees) e.fatigue = 100;
  };
  refresh();
  expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:36,30').success).toBe(true);
  expect(run(`charge hole:* explosive:krackle amount:${kgPerHole} stemming:2`).success).toBe(true);
  for (let i = 0; i < 5000 && !(state.drillHoles.length === 9 && Object.keys(state.chargesByHole).length === 9); i++) {
    refresh();
    run('tick 1');
  }
  expect(state.drillHoles).toHaveLength(9);
  expect(Object.keys(state.chargesByHole)).toHaveLength(9);
  state.cash = 100_000;
  return { run, state, ctx };
}

function predicted(tick: number, salt: number, overshoot: number): boolean {
  return rollInspection(new Random(rollSeed(SEED, tick, salt)), overshoot);
}

/** First tick after `from` where the seeded first roll gives the wanted verdict. */
function tickWithVerdict(from: number, overshoot: number, inspected: boolean): number {
  for (let tick = from + 1; tick < from + 2000; tick++) {
    if (predicted(tick, 0, overshoot) === inspected) return tick;
  }
  throw new Error('no tick found');
}

const OVERSHOOT = 0.125; // 90 kg against the 80 kg grade-0 limit

function txOf(state: GameState, category: string) {
  return state.finances.transactions.filter(x => x.category === category);
}

describe('blast on a progression site, within the permit (#1923)', () => {
  beforeAll(() => setLocale('en'));

  it('pays only the notification fee, under permits', () => {
    const { run, state } = loadedSite(8); // 72 kg, 9 holes: the standard opening
    const cash = state.cash;
    const r = run('blast');
    expect(r.success, r.output).toBe(true);
    expect(state.cash).toBe(cash - FEE);
    const permits = txOf(state, 'permits');
    expect(permits).toHaveLength(1);
    expect(permits[0]!.amount).toBe(FEE);
    expect(permits[0]!.description).toContain('Blast Notification Form B-52');
  });

  it('rolls no inspection and adds no fine or strike', () => {
    const { run, state } = loadedSite(8);
    run('blast');
    expect(txOf(state, 'fines')).toHaveLength(0);
    expect(state.grade!.strikeTicks ?? []).toEqual([]);
    expect(state.grade!.inspectionRolls ?? 0).toBe(0);
  });

  it('reports the fee in the blast output and no inspection chance', () => {
    const { run } = loadedSite(8);
    const r = run('blast');
    expect(r.output).toContain(formatMoney(FEE));
    expect(r.output).not.toMatch(/chance/i);
  });

  it('fires no inspection event on the bus', () => {
    const { run, ctx } = loadedSite(8);
    let seen = 0;
    ctx.emitter.on('progression:blast_inspected', () => { seen++; });
    run('blast');
    expect(seen).toBe(0);
  });

  it('a refused blast (nothing charged) does not charge the fee', () => {
    const { run, state } = loadedSite(8);
    run('blast');
    const cash = state.cash;
    const r = run('blast');
    expect(r.success).toBe(false);
    expect(state.cash).toBe(cash);
    expect(txOf(state, 'permits')).toHaveLength(1);
  });
});

describe('blast on a progression site, over the permit (#1923)', () => {
  beforeAll(() => setLocale('en'));

  it('the loaded 3x3 at 10 kg is 90 kg, 12.5% over', () => {
    const { state } = loadedSite(10);
    const kg = Object.values(state.chargesByHole).reduce((sum, c) => sum + c.amountKg, 0);
    expect(kg).toBe(90);
    expect(OVERSHOOT).toBeCloseTo(0.125, 10);
  });

  it('still fires, and pays the fee, when the seeded roll spares it', () => {
    const { run, state } = loadedSite(10);
    state.tickCount = tickWithVerdict(state.tickCount, OVERSHOOT, false);
    const cash = state.cash;
    const r = run('blast');
    expect(r.success, r.output).toBe(true);
    expect(state.cash).toBe(cash - FEE);
    expect(txOf(state, 'fines')).toHaveLength(0);
    expect(state.grade!.strikeTicks ?? []).toEqual([]);
    expect(state.grade!.inspectionRolls).toBe(1);
  });

  it('when the seeded roll catches it: fine under fines, neighbours -5, one strike', () => {
    const { run, state } = loadedSite(10);
    const tick = tickWithVerdict(state.tickCount, OVERSHOOT, true);
    state.tickCount = tick;
    const cash = state.cash;
    const nuisance = state.scores.nuisance;
    const fine = inspectionFine(FEE, OVERSHOOT);
    const r = run('blast');
    expect(r.success, r.output).toBe(true);
    expect(state.cash).toBe(cash - FEE - fine);
    const fines = txOf(state, 'fines');
    expect(fines).toHaveLength(1);
    expect(fines[0]!.amount).toBe(fine);
    expect(state.grade!.strikeTicks).toEqual([tick]);
    expect(state.scores.nuisance).toBeLessThanOrEqual(nuisance - 5);
    expect(r.output).toContain(formatMoney(fine));
  });

  it('the same seed and tick give the same verdict every time', () => {
    const first = loadedSite(10);
    const tick = tickWithVerdict(first.state.tickCount, OVERSHOOT, true);
    first.state.tickCount = tick;
    first.run('blast');
    const second = loadedSite(10);
    second.state.tickCount = tick;
    second.run('blast');
    expect(second.state.grade!.strikeTicks).toEqual(first.state.grade!.strikeTicks);
    expect(txOf(second.state, 'fines').map(x => x.amount)).toEqual(txOf(first.state, 'fines').map(x => x.amount));
  });

  it('the blast output never shows the inspection chance', () => {
    for (const inspected of [true, false]) {
      const { run, state } = loadedSite(10);
      state.tickCount = tickWithVerdict(state.tickCount, OVERSHOOT, inspected);
      const r = run('blast');
      expect(r.output).not.toMatch(/chance/i);
      expect(r.output).not.toMatch(/37\.?5\s*%/);
      expect(r.output).not.toMatch(/0\.375/);
    }
  });

  it('emits progression:blast_inspected with the overshoot, the verdict, the fine and the strikes', () => {
    const { run, state, ctx } = loadedSite(10);
    state.tickCount = tickWithVerdict(state.tickCount, OVERSHOOT, true);
    const seen: Array<{ overshoot: number; caught: boolean; fine: number; strikes: number; suspended: boolean }> = [];
    ctx.emitter.on('progression:blast_inspected', e => seen.push(e));
    run('blast');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.caught).toBe(true);
    expect(seen[0]!.overshoot).toBeCloseTo(OVERSHOOT, 10);
    expect(seen[0]!.fine).toBe(inspectionFine(FEE, OVERSHOOT));
    expect(seen[0]!.strikes).toBe(1);
    expect(seen[0]!.suspended).toBe(false);
  });

  it('a bribed inspector shields the overshoot: no roll, no fine, no strike', () => {
    const { run, state } = loadedSite(10);
    const tick = tickWithVerdict(state.tickCount, OVERSHOOT, true);
    state.tickCount = tick;
    state.corruption.protections.push({ target: 'inspector', expiresAtTick: tick + 200, dismissalsLeft: 0, shielded: false });
    const cash = state.cash;
    const r = run('blast');
    expect(r.success, r.output).toBe(true);
    expect(state.cash).toBe(cash - FEE);
    expect(txOf(state, 'fines')).toHaveLength(0);
    expect(state.grade!.strikeTicks ?? []).toEqual([]);
    expect(state.grade!.inspectionRolls ?? 0).toBe(0);
    expect(state.corruption.protections[0]!.shielded).toBe(true);
  });

  it('a third strike inside 2000 ticks suspends the permit and the next shot is refused', () => {
    const { run, state } = loadedSite(10);
    const tick = tickWithVerdict(state.tickCount, OVERSHOOT, true);
    state.tickCount = tick;
    state.grade!.strikeTicks = [tick - 100, tick - 500];
    const r = run('blast');
    expect(r.success, r.output).toBe(true);
    expect(isActive(state.events.activeModifiers, 'blast_ban', tick)).toBe(true);
    expect(state.events.activeModifiers.find(m => m.kind === 'blast_ban')!.endTick).toBe(tick + 72);
    expect(state.grade!.strikeTicks).toEqual([]);
    const refused = run('blast');
    expect(refused.success).toBe(false);
    expect(refused.output).toBe(t('mining.blast.banned'));
    expect(refused.output).toContain("Your permit has been laminated and pinned to the Ministry's corkboard.");
  });

  it('strikes older than the window do not suspend', () => {
    const { run, state } = loadedSite(10);
    const tick = tickWithVerdict(state.tickCount + 3000, OVERSHOOT, true);
    state.tickCount = tick;
    state.grade!.strikeTicks = [tick - 2000, tick - 2600];
    run('blast');
    expect(isActive(state.events.activeModifiers, 'blast_ban', tick)).toBe(false);
    expect(state.grade!.strikeTicks).toEqual([tick]);
  });

  it('a refusal under suspension charges no fee', () => {
    const { run, state } = loadedSite(10);
    state.events.activeModifiers.push({
      id: 900, kind: 'blast_ban', sourceEventId: 'permit', role: null, targetId: null, category: null,
      magnitude: 1, startTick: state.tickCount, endTick: state.tickCount + 72,
    });
    const cash = state.cash;
    const r = run('blast');
    expect(r.success).toBe(false);
    expect(state.cash).toBe(cash);
    expect(txOf(state, 'permits')).toHaveLength(0);
    expect(state.grade!.inspectionRolls ?? 0).toBe(0);
  });
});

describe('blast detonate reaches the same check once the danger zone clears (#1923)', () => {
  beforeAll(() => setLocale('en'));

  /** Arm, then tick until the sequence has fired. */
  function detonate(site: ReturnType<typeof loadedSite>) {
    const { run, state } = site;
    const armed = run('blast detonate');
    expect(armed.success, armed.output).toBe(true);
    for (let i = 0; i < 800 && state.lastBlastReport === null; i++) {
      for (const e of state.employees.employees) e.fatigue = 100;
      fundForDeliveryWait(state);
      run('tick 1');
    }
    expect(state.lastBlastReport).not.toBeNull();
  }

  it('an in-limit pattern pays the fee once', () => {
    const site = loadedSite(8);
    detonate(site);
    const permits = txOf(site.state, 'permits');
    expect(permits).toHaveLength(1);
    expect(permits[0]!.amount).toBe(FEE);
  });

  it('an over-limit pattern rolls the verdict on the auto-fire', () => {
    const site = loadedSite(10);
    detonate(site);
    expect(txOf(site.state, 'permits')).toHaveLength(1);
    expect(site.state.grade!.inspectionRolls).toBe(1);
  });

  it('a suspension refuses the arm', () => {
    const site = loadedSite(10);
    const { state, run } = site;
    state.events.activeModifiers.push({
      id: 901, kind: 'blast_ban', sourceEventId: 'permit', role: null, targetId: null, category: null,
      magnitude: 1, startTick: state.tickCount, endTick: state.tickCount + 72,
    });
    const r = run('blast detonate');
    expect(r.success).toBe(false);
    expect(txOf(state, 'permits')).toHaveLength(0);
  });
});

describe('blast off a progression site is unchanged (#1923)', () => {
  beforeAll(() => setLocale('en'));

  function nonProgressionSite(kg: number) {
    const site = loadedSite(kg);
    delete (site.state as { grade?: unknown }).grade;
    return site;
  }

  it('an over-limit pattern pays no fee, takes no roll, no fine and no strike', () => {
    const { run, state, ctx } = nonProgressionSite(10);
    let seen = 0;
    ctx.emitter.on('progression:blast_inspected', () => { seen++; });
    const cash = state.cash;
    const r = run('blast');
    expect(r.success, r.output).toBe(true);
    expect(state.cash).toBe(cash);
    expect(txOf(state, 'permits')).toHaveLength(0);
    expect(txOf(state, 'fines')).toHaveLength(0);
    expect(seen).toBe(0);
    expect(r.output).not.toContain('Blast Notification');
  });

  it('a campaign start has no ladder and no permit charge', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game mine_type:desert seed:42 size:32').success).toBe(true);
    expect(ctx.state!.grade).toBeUndefined();
    expect(txOf(ctx.state!, 'permits')).toHaveLength(0);
  });

  it('the blast output carries none of the permit lines', () => {
    const { run } = nonProgressionSite(8);
    const r = run('blast');
    expect(r.output).not.toMatch(/notification/i);
  });
});

describe('permit status shows limits, fee and strikes (#1923)', () => {
  beforeAll(() => setLocale('en'));

  function sandbox() {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    ctx.state!.events.eventFreqMultiplier = 0;
    return { run: (c: string) => runner.run(c), state: ctx.state! };
  }

  it('lists the grade-0 limits and the notification fee', () => {
    const { run } = sandbox();
    const r = run('permit status');
    expect(r.success).toBe(true);
    expect(r.output).toContain('80');
    expect(r.output).toMatch(/\b9\b/);
    expect(r.output).toContain(formatMoney(FEE));
  });

  it('lists the strikes inside the window', () => {
    const { run, state } = sandbox();
    const before = run('permit status').output;
    state.tickCount = 500;
    state.grade!.strikeTicks = [400, 450];
    const after = run('permit status').output;
    expect(after).not.toBe(before);
    expect(after).toMatch(/\b2\b/);
  });

  it('does not count strikes that have lapsed', () => {
    const { run, state } = sandbox();
    const clean = run('permit status').output;
    state.tickCount = 9000;
    state.grade!.strikeTicks = [10, 20, 30];
    const lapsed = run('permit status').output;
    expect(lapsed).toBe(clean);
  });

  it('follows the grade: grade 1 shows its own limits', () => {
    const { run, state } = sandbox();
    state.grade!.grade = 1;
    const r = run('permit status');
    expect(r.output).toContain('250');
    expect(r.output).toContain(formatMoney(1_000));
  });

  it('never shows the inspection chance', () => {
    const { run, state } = sandbox();
    state.grade!.strikeTicks = [1, 2];
    const r = run('permit status');
    expect(r.output).not.toMatch(/chance/i);
    expect(r.output).not.toMatch(/%/);
  });

  it('is still refused without a ladder', () => {
    const { runner } = createRunner();
    runner.run('new_game mine_type:desert seed:42 size:32');
    expect(runner.run('permit status').success).toBe(false);
  });
});

describe('permit limits i18n (#1923)', () => {
  const KEYS = [
    'permit.status.limits',
    'permit.status.strikes',
    'mining.blast.permit_fee',
    'mining.blast.permit_over_unchecked',
    'mining.blast.permit_caught',
    'mining.blast.permit_suspended',
    'mining.blast.banned',
  ];

  it.each(KEYS)('%s exists in en and fr and differs between them', key => {
    setLocale('en');
    const en = t(key);
    setLocale('fr');
    const fr = t(key);
    setLocale('en');
    expect(en).not.toBe(key);
    expect(fr).not.toBe(key);
    expect(fr).not.toBe(en);
  });

  it('the suspension refusal is the corkboard line', () => {
    setLocale('en');
    expect(t('mining.blast.banned')).toContain("Your permit has been laminated and pinned to the Ministry's corkboard.");
  });
});
