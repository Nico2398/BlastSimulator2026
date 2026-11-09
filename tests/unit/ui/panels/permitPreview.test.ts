// BlastSimulator2026 — permitPreview view model (#1925): plan vs the mine's permit.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { permitPreview, gridHoleLimitWarning, chargeKgLimitWarning } from '../../../../src/ui/panels/permitPreview.js';
import { createGradeState } from '../../../../src/core/economy/MineGrade.js';
import { permitLimitsFor, preFireCheck, inspectionChance, inspectionFine, liveStrikes } from '../../../../src/core/economy/PermitLimits.js';
import { PERMIT_STRIKE_WINDOW_TICKS, PERMIT_STRIKES_TO_SUSPEND } from '../../../../src/core/config/balance.js';
import { formatMoney } from '../../../../src/core/economy/formatMoney.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';

/** Plan of `holes` holes with `kgPerHole` kg each. */
function plan(holes: number, kgPerHole: number) {
  const ids = Array.from({ length: holes }, (_, i) => ({ id: i + 1 }));
  const charges: Record<string, { amountKg: number }> = {};
  for (const h of ids) charges[String(h.id)] = { amountKg: kgPerHole };
  return { holes: ids, charges };
}

describe('permitPreview', () => {
  it('returns null when the mine has no grade (non-progression site)', () => {
    expect(permitPreview(undefined, plan(3, 5), 0)).toBeNull();
  });

  it('within limit: shows used / limit kg and holes at grade 0 and is not over', () => {
    const p = permitPreview(createGradeState(), plan(9, 4), 0)!;
    expect(p.over).toBe(false);
    expect(p.kgText).toContain('36 / 40 kg');
    expect(p.holesText).toContain('9 / 9 holes');
  });

  it('exactly at both limits is not over', () => {
    const lim = permitLimitsFor(0);
    const p = permitPreview(createGradeState(), plan(lim.maxHoles, lim.maxChargeKg / lim.maxHoles), 0)!;
    expect(p.over).toBe(false);
  });

  it('over by kg only', () => {
    const p = permitPreview(createGradeState(), plan(9, 5), 0)!;
    expect(p.over).toBe(true);
    expect(p.kgText).toContain('45 / 40 kg');
    expect(p.holesText).toContain('9 / 9 holes');
    expect(p.warningText.length).toBeGreaterThan(0);
  });

  it('over by holes only', () => {
    const p = permitPreview(createGradeState(), plan(10, 1), 0)!;
    expect(p.over).toBe(true);
    expect(p.holesText).toContain('10 / 9 holes');
    expect(p.kgText).toContain('10 / 40 kg');
  });

  it('over by both', () => {
    const p = permitPreview(createGradeState(), plan(12, 5), 0)!;
    expect(p.over).toBe(true);
    expect(p.kgText).toContain('60 / 40 kg');
    expect(p.holesText).toContain('12 / 9 holes');
  });

  it('within the limit carries an empty warning', () => {
    expect(permitPreview(createGradeState(), plan(1, 1), 0)!.warningText).toBe('');
  });

  it('carries the notification fee of the grade, in number and text', () => {
    const p = permitPreview(createGradeState(), plan(1, 1), 0)!;
    expect(p.fee).toBe(permitLimitsFor(0).fee);
    expect(p.feeText).toContain(String(permitLimitsFor(0).fee));
  });

  it('counts strikes inside the window', () => {
    const g = createGradeState();
    g.strikeTicks = [900, 1500];
    const p = permitPreview(g, plan(1, 1), 2000)!;
    expect(p.strikes).toBe(2);
    expect(p.strikesText).toContain('2');
  });

  it('drops strikes outside the window', () => {
    const g = createGradeState();
    g.strikeTicks = [10, 5000];
    const tick = 10 + PERMIT_STRIKE_WINDOW_TICKS;
    expect(permitPreview(g, plan(1, 1), tick)!.strikes).toBe(1);
  });

  it('zero strikes when none recorded', () => {
    expect(permitPreview(createGradeState(), plan(1, 1), 0)!.strikes).toBe(0);
  });

  it('never exposes the raw overshoot', () => {
    const p = permitPreview(createGradeState(), plan(12, 5), 0)!;
    expect(Object.keys(p)).not.toContain('overshoot');
    expect(JSON.stringify(p).toLowerCase()).not.toContain('overshoot');
  });
});

// ── #2166: the over-permit warning states what going over costs ─────────────

describe('permitPreview consequence (#2166)', () => {
  beforeEach(() => { setLocale('en'); });

  /** What the Contract says the consequence is, derived from the permit rules for `p`'s plan. */
  function expected(holes: number, kgPerHole: number, strikeTicks: number[], tick: number) {
    const pl = plan(holes, kgPerHole);
    const check = preFireCheck(0, pl.charges, pl.holes.length);
    const chance = inspectionChance(check.overshoot);
    const fine = inspectionFine(check.fee, check.overshoot);
    const strikes = liveStrikes(strikeTicks, tick).length;
    const consequence = t('permit.preview.consequence', {
      chance: Math.round(chance * 100), fine: formatMoney(fine), strikes, limit: PERMIT_STRIKES_TO_SUSPEND,
    });
    return { chance, fine, consequence, strikes };
  }

  function preview(holes: number, kgPerHole: number, strikeTicks: number[] = [], tick = 0) {
    const g = createGradeState();
    g.strikeTicks = strikeTicks;
    return permitPreview(g, plan(holes, kgPerHole), tick)!;
  }

  it('over by kg: carries the inspection chance and the fine', () => {
    const e = expected(9, 5, [], 0);
    const p = preview(9, 5);
    expect(p.inspectionChance).toBe(e.chance);
    expect(p.fine).toBe(e.fine);
    expect(p.inspectionChance).toBeGreaterThan(0);
    expect(p.fine).toBeGreaterThan(0);
  });

  it('over by holes only: chance and fine follow the hole overshoot', () => {
    const e = expected(10, 1, [], 0);
    const p = preview(10, 1);
    expect(p.inspectionChance).toBe(e.chance);
    expect(p.fine).toBe(e.fine);
    expect(p.consequenceText).toBe(e.consequence);
  });

  it('a bigger overshoot raises the chance and the fine', () => {
    const small = preview(9, 5);
    const big = preview(9, 6);
    expect(big.inspectionChance).toBeGreaterThan(small.inspectionChance);
    expect(big.fine).toBeGreaterThan(small.fine);
  });

  it('a huge overshoot caps the chance at 1', () => {
    const p = preview(100, 5);
    expect(p.inspectionChance).toBe(1);
    expect(p.consequenceText).toBe(expected(100, 5, [], 0).consequence);
  });

  it('consequenceText is the consequence line with chance in whole percent, formatted fine, live strikes and the ban limit', () => {
    const strikeTicks = [900, 1500];
    const e = expected(9, 5, strikeTicks, 2000);
    const p = preview(9, 5, strikeTicks, 2000);
    expect(p.consequenceText).toBe(e.consequence);
    expect(p.consequenceText).toContain(String(Math.round(e.chance * 100)));
    expect(p.consequenceText).toContain(formatMoney(e.fine));
  });

  it('counts only strikes still inside the window', () => {
    const tick = 10 + PERMIT_STRIKE_WINDOW_TICKS;
    const p = preview(9, 5, [10, 5000], tick);
    expect(p.consequenceText).toBe(expected(9, 5, [10, 5000], tick).consequence);
    expect(p.consequenceText).not.toBe(expected(9, 5, [5000, 5001], tick).consequence);
  });

  it('warningText wraps the consequence in the satirical warning', () => {
    const p = preview(9, 5);
    expect(p.warningText).toBe(t('permit.preview.warning', { consequence: p.consequenceText }));
    expect(p.warningText).toContain(p.consequenceText);
    expect(p.warningText).toContain('Over your permit');
  });

  it('within the permit: no chance, no fine, no consequence, no warning', () => {
    const p = preview(9, 4);
    expect(p.inspectionChance).toBe(0);
    expect(p.fine).toBe(0);
    expect(p.consequenceText).toBe('');
    expect(p.warningText).toBe('');
  });

  it('exactly at both limits: nothing to warn about', () => {
    const lim = permitLimitsFor(0);
    const p = permitPreview(createGradeState(), plan(lim.maxHoles, lim.maxChargeKg / lim.maxHoles), 0)!;
    expect(p.over).toBe(false);
    expect(p.inspectionChance).toBe(0);
    expect(p.fine).toBe(0);
    expect(p.consequenceText).toBe('');
  });

  it('an empty plan carries no consequence', () => {
    const p = permitPreview(createGradeState(), plan(0, 0), 0)!;
    expect(p.over).toBe(false);
    expect(p.consequenceText).toBe('');
    expect(p.fine).toBe(0);
  });

  it('en and fr define the consequence line with its parameters, in different text', () => {
    const read = (l: string): Record<string, string> => JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8'));
    const en = read('en');
    const fr = read('fr');
    for (const loc of [en, fr]) {
      const line = loc['permit.preview.consequence'];
      expect(line).toBeTruthy();
      for (const param of ['{chance}', '{fine}', '{strikes}', '{limit}']) expect(line).toContain(param);
      expect(loc['permit.preview.warning']).toContain('{consequence}');
    }
    expect(en['permit.preview.consequence']).not.toBe(fr['permit.preview.consequence']);
  });
});

/** The consequence text the Contract attaches to a plan of `holes` holes and `kg` kg in total. */
function consequenceFor(holes: number, kg: number, strikeTicks: number[] = [], tick = 0): string {
  const g = createGradeState();
  g.strikeTicks = strikeTicks;
  const ids = Array.from({ length: holes }, (_, i) => ({ id: i + 1 }));
  return permitPreview(g, { holes: ids, charges: kg > 0 ? { total: { amountKg: kg } } : {} }, tick)!.consequenceText;
}

describe('gridHoleLimitWarning (#2167: plan total)', () => {
  beforeEach(() => { setLocale('en'); });

  it('null for an undefined grade', () => {
    expect(gridHoleLimitWarning(undefined, 500)).toBeNull();
    expect(gridHoleLimitWarning(undefined, 500, 500)).toBeNull();
  });

  it('null at the limit', () => {
    expect(gridHoleLimitWarning(createGradeState(), 9)).toBeNull();
  });

  it('null below the limit', () => {
    expect(gridHoleLimitWarning(createGradeState(), 1)).toBeNull();
  });

  it('null when added + existing sit exactly at the limit', () => {
    expect(gridHoleLimitWarning(createGradeState(), 4, 5)).toBeNull();
  });

  it('a grid that fits alone but overflows with existing holes warns', () => {
    expect(gridHoleLimitWarning(createGradeState(), 9)).toBeNull();
    expect(gridHoleLimitWarning(createGradeState(), 9, 3)).not.toBeNull();
  });

  it('one existing hole too many over the limit warns even for a single added hole', () => {
    expect(gridHoleLimitWarning(createGradeState(), 1, 9)).not.toBeNull();
    expect(gridHoleLimitWarning(createGradeState(), 1, 8)).toBeNull();
  });

  it('states the plan total and the limit', () => {
    const w = gridHoleLimitWarning(createGradeState(), 9, 3)!;
    expect(w).toContain('12');
    expect(w).toContain(String(permitLimitsFor(0).maxHoles));
  });

  it('the total is existing + added, not the added count alone', () => {
    const w = gridHoleLimitWarning(createGradeState(), 10, 5)!;
    expect(w).toContain('15');
  });

  it('carries the consequence text of the plan total', () => {
    const w = gridHoleLimitWarning(createGradeState(), 9, 3)!;
    expect(w).toContain(consequenceFor(12, 0));
    expect(consequenceFor(12, 0).length).toBeGreaterThan(0);
  });

  it('a bigger plan total carries a bigger consequence than a smaller one', () => {
    const small = gridHoleLimitWarning(createGradeState(), 10)!;
    const big = gridHoleLimitWarning(createGradeState(), 20)!;
    expect(small).toContain(consequenceFor(10, 0));
    expect(big).toContain(consequenceFor(20, 0));
    expect(small).not.toContain(consequenceFor(20, 0));
  });

  it('counts only live strikes at the given tick in the consequence', () => {
    const g = createGradeState();
    g.strikeTicks = [900, 1500];
    const w = gridHoleLimitWarning(g, 10, 0, 2000)!;
    expect(w).toContain(consequenceFor(10, 0, [900, 1500], 2000));
    expect(w).not.toContain(consequenceFor(10, 0, [], 2000));
  });

  it('tick defaults to 0', () => {
    const g = createGradeState();
    g.strikeTicks = [10];
    expect(gridHoleLimitWarning(g, 10)).toContain(consequenceFor(10, 0, [10], 0));
  });

  it('en and fr both define the warning text', () => {
    const read = (l: string): Record<string, string> => JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8'));
    setLocale('fr');
    try {
      const w = gridHoleLimitWarning(createGradeState(), 9, 3)!;
      expect(w).toContain('12');
      expect(w).toContain(consequenceFor(12, 0));
      expect(w).not.toMatch(/^permit\./);
    } finally { setLocale('en'); }
    expect(Object.keys(read('en')).filter(k => k.startsWith('permit.preview.')).sort())
      .toEqual(Object.keys(read('fr')).filter(k => k.startsWith('permit.preview.')).sort());
  });
});

describe('chargeKgLimitWarning (#2167)', () => {
  beforeEach(() => { setLocale('en'); });

  it('null for an undefined grade', () => {
    expect(chargeKgLimitWarning(undefined, 5000)).toBeNull();
  });

  it('null below the kg limit', () => {
    expect(chargeKgLimitWarning(createGradeState(), 10)).toBeNull();
  });

  it('null at exactly the kg limit', () => {
    expect(chargeKgLimitWarning(createGradeState(), permitLimitsFor(0).maxChargeKg)).toBeNull();
  });

  it('null for a zero plan', () => {
    expect(chargeKgLimitWarning(createGradeState(), 0)).toBeNull();
  });

  it('warns just above the kg limit with the consequence text', () => {
    const kg = permitLimitsFor(0).maxChargeKg + 5;
    const w = chargeKgLimitWarning(createGradeState(), kg)!;
    expect(typeof w).toBe('string');
    expect(w).toContain(consequenceFor(0, kg));
    expect(consequenceFor(0, kg).length).toBeGreaterThan(0);
  });

  it('a bigger overshoot carries its own, bigger consequence', () => {
    const w = chargeKgLimitWarning(createGradeState(), 120)!;
    expect(w).toContain(consequenceFor(0, 120));
    expect(w).not.toContain(consequenceFor(0, 45));
  });

  it('counts only live strikes at the given tick', () => {
    const g = createGradeState();
    g.strikeTicks = [900, 1500];
    const w = chargeKgLimitWarning(g, 60, 2000)!;
    expect(w).toContain(consequenceFor(0, 60, [900, 1500], 2000));
    expect(w).not.toContain(consequenceFor(0, 60, [], 2000));
  });

  it('en and fr both render it', () => {
    setLocale('fr');
    try {
      const w = chargeKgLimitWarning(createGradeState(), 60)!;
      expect(w).toContain(consequenceFor(0, 60));
    } finally { setLocale('en'); }
  });
});
