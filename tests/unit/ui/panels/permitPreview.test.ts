// BlastSimulator2026 — permitPreview view model (#1925): plan vs the mine's permit.
// The permit caps a blast's kilograms and the ground it works: the area of its holes' pattern cells
// (`patternAreaM2`), measured from the real holes — never how many holes do it.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { permitPreview, gridAreaLimitWarning, chargeKgLimitWarning } from '../../../../src/ui/panels/permitPreview.js';
import { createGradeState } from '../../../../src/core/economy/MineGrade.js';
import { permitLimitsFor, preFireCheck, inspectionChance, inspectionFine, liveStrikes } from '../../../../src/core/economy/PermitLimits.js';
import {
  DRILL_GRID_DEFAULT_SPACING_M, PERMIT_STRIKE_WINDOW_TICKS, PERMIT_STRIKES_TO_SUSPEND,
} from '../../../../src/core/config/balance.js';
import { formatMoney } from '../../../../src/core/economy/formatMoney.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { DrillHole } from '../../../../src/core/mining/DrillPlan.js';

/** A hole as the permit measures it: where it stands and the pattern cell it was drilled in. */
type PermitHole = Pick<DrillHole, 'id' | 'x' | 'z' | 'spacingM' | 'burdenM'>;

/** Cell side (m) of the test patterns: the default 4 m grid the permit areas are written for, 16 m² a hole. */
const CELL_M = DRILL_GRID_DEFAULT_SPACING_M;
const CELL_M2 = CELL_M * CELL_M;

/**
 * `count` holes of one grid pattern `cellM` apart, rows of ten, each recording its `cellM` x `cellM` cell as a
 * drilled grid does. `firstId` continues an earlier batch of the same pattern (ids and positions both).
 */
function gridHoles(count: number, cellM = CELL_M, firstId = 1): PermitHole[] {
  return Array.from({ length: count }, (_, i) => {
    const index = firstId - 1 + i;
    return { id: `H${index + 1}`, x: (index % 10) * cellM, z: Math.floor(index / 10) * cellM, spacingM: cellM, burdenM: cellM };
  });
}

/** Plan of `holes` grid holes `cellM` apart with `kgPerHole` kg each. */
function plan(holes: number, kgPerHole: number, cellM = CELL_M) {
  const pattern = gridHoles(holes, cellM);
  const charges: Record<string, { amountKg: number }> = {};
  for (const h of pattern) charges[h.id] = { amountKg: kgPerHole };
  return { holes: pattern, charges };
}

describe('permitPreview', () => {
  it('returns null when the mine has no grade (non-progression site)', () => {
    expect(permitPreview(undefined, plan(3, 5), 0)).toBeNull();
  });

  it('within limit: shows used / limit kg and area at grade 0 and is not over', () => {
    const p = permitPreview(createGradeState(), plan(9, 4), 0)!;
    expect(p.over).toBe(false);
    expect(p.kgOver).toBe(false);
    expect(p.areaOver).toBe(false);
    expect(p.kgText).toContain('36 / 40 kg');
    expect(p.areaText).toContain('144 / 144 m²');
  });

  it('exactly at both limits is not over', () => {
    const lim = permitLimitsFor(0);
    const holes = lim.maxAreaM2 / CELL_M2;
    expect(Number.isInteger(holes)).toBe(true);
    const p = permitPreview(createGradeState(), plan(holes, lim.maxChargeKg / holes), 0)!;
    expect(p.over).toBe(false);
  });

  it('over by kg only', () => {
    const p = permitPreview(createGradeState(), plan(9, 5), 0)!;
    expect(p.over).toBe(true);
    expect(p.kgOver).toBe(true);
    expect(p.areaOver).toBe(false);
    expect(p.kgText).toContain('45 / 40 kg');
    expect(p.areaText).toContain('144 / 144 m²');
    expect(p.warningText.length).toBeGreaterThan(0);
  });

  it('over by area only', () => {
    const p = permitPreview(createGradeState(), plan(10, 1), 0)!;
    expect(p.over).toBe(true);
    expect(p.areaOver).toBe(true);
    expect(p.kgOver).toBe(false);
    expect(p.areaText).toContain('160 / 144 m²');
    expect(p.kgText).toContain('10 / 40 kg');
  });

  it('over by both', () => {
    const p = permitPreview(createGradeState(), plan(12, 5), 0)!;
    expect(p.over).toBe(true);
    expect(p.kgText).toContain('60 / 40 kg');
    expect(p.areaText).toContain('192 / 144 m²');
  });

  it('measures the ground, not the hole count: a finer mesh over the same area fits the permit', () => {
    // Sixteen holes on a 3 m mesh work 144 m², the grade-0 area; on the 4 m mesh they work 256 m².
    const fine = permitPreview(createGradeState(), plan(16, 2, 3), 0)!;
    expect(fine.over).toBe(false);
    expect(fine.areaText).toContain('144 / 144 m²');
    const coarse = permitPreview(createGradeState(), plan(16, 2), 0)!;
    expect(coarse.areaOver).toBe(true);
    expect(coarse.areaText).toContain('256 / 144 m²');
  });

  it('a hole drilled without a pattern cell is measured from where it stands: a square as wide as its nearest neighbour is far', () => {
    const handPlaced = (gap: number): PermitHole[] =>
      Array.from({ length: 9 }, (_, i) => ({ id: `A${i}`, x: (i % 3) * gap, z: Math.floor(i / 3) * gap }));
    const tight = permitPreview(createGradeState(), { holes: handPlaced(4), charges: {} }, 0)!;
    expect(tight.areaText).toContain('144 / 144 m²');
    expect(tight.over).toBe(false);
    const spread = permitPreview(createGradeState(), { holes: handPlaced(5), charges: {} }, 0)!;
    expect(spread.areaText).toContain('225 / 144 m²');
    expect(spread.areaOver).toBe(true);
  });

  it('rounds the area to whole square metres', () => {
    // Nine 3.5 m cells: 110.25 m².
    expect(permitPreview(createGradeState(), plan(9, 1, 3.5), 0)!.areaText).toContain('110 / 144 m²');
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

  /** What the Contract says the consequence is, derived from the permit rules for `p`'s plan (16 m² a hole). */
  function expected(holes: number, kgPerHole: number, strikeTicks: number[], tick: number) {
    const pl = plan(holes, kgPerHole);
    const check = preFireCheck(0, pl.charges, holes * CELL_M2);
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

  it('over by area only: chance and fine follow the area overshoot', () => {
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

  it('a bigger area overshoot raises the chance and the fine too', () => {
    const small = preview(10, 1);
    const big = preview(11, 1);
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
    const holes = lim.maxAreaM2 / CELL_M2;
    const p = permitPreview(createGradeState(), plan(holes, lim.maxChargeKg / holes), 0)!;
    expect(p.over).toBe(false);
    expect(p.inspectionChance).toBe(0);
    expect(p.fine).toBe(0);
    expect(p.consequenceText).toBe('');
  });

  it('an empty plan carries no consequence', () => {
    const p = permitPreview(createGradeState(), plan(0, 0), 0)!;
    expect(p.over).toBe(false);
    expect(p.areaText).toContain('0 / 144 m²');
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
      for (const param of ['{used}', '{limit}']) expect(loc['permit.preview.area']).toContain(param);
    }
    expect(en['permit.preview.consequence']).not.toBe(fr['permit.preview.consequence']);
  });
});

/** The consequence text the Contract attaches to a plan of `holes` 16 m² grid holes and `kg` kg in total. */
function consequenceFor(holes: number, kg: number, strikeTicks: number[] = [], tick = 0): string {
  const g = createGradeState();
  g.strikeTicks = strikeTicks;
  return permitPreview(g, { holes: gridHoles(holes), charges: kg > 0 ? { total: { amountKg: kg } } : {} }, tick)!.consequenceText;
}

describe('gridAreaLimitWarning (#2167: the whole plan after the placement)', () => {
  beforeEach(() => { setLocale('en'); });

  it('null for an undefined grade', () => {
    expect(gridAreaLimitWarning(undefined, gridHoles(500))).toBeNull();
    expect(gridAreaLimitWarning(undefined, gridHoles(500), 500)).toBeNull();
  });

  it('null at the limit', () => {
    expect(gridAreaLimitWarning(createGradeState(), gridHoles(9))).toBeNull();
  });

  it('null below the limit', () => {
    expect(gridAreaLimitWarning(createGradeState(), gridHoles(1))).toBeNull();
    expect(gridAreaLimitWarning(createGradeState(), [])).toBeNull();
  });

  it('null when the planned holes and the added ones sit exactly at the limit', () => {
    expect(gridAreaLimitWarning(createGradeState(), [...gridHoles(5), ...gridHoles(4, CELL_M, 6)])).toBeNull();
  });

  it('a grid that fits alone but overflows with the holes already planned warns', () => {
    const grid = gridHoles(9, CELL_M, 4);
    expect(gridAreaLimitWarning(createGradeState(), grid)).toBeNull();
    expect(gridAreaLimitWarning(createGradeState(), [...gridHoles(3), ...grid])).not.toBeNull();
  });

  it('one hole too many over the limit warns even for a single added hole', () => {
    expect(gridAreaLimitWarning(createGradeState(), [...gridHoles(9), ...gridHoles(1, CELL_M, 10)])).not.toBeNull();
    expect(gridAreaLimitWarning(createGradeState(), [...gridHoles(8), ...gridHoles(1, CELL_M, 9)])).toBeNull();
  });

  it('states the plan area and the limit', () => {
    const w = gridAreaLimitWarning(createGradeState(), [...gridHoles(3), ...gridHoles(9, CELL_M, 4)])!;
    expect(w).toContain('192');
    expect(w).toContain(String(permitLimitsFor(0).maxAreaM2));
  });

  it('the area is the whole plan\'s, not the added holes\' alone', () => {
    const w = gridAreaLimitWarning(createGradeState(), [...gridHoles(5), ...gridHoles(10, CELL_M, 6)])!;
    expect(w).toContain('240');
  });

  it('counts area, not holes: sixteen holes on a 3 m mesh fit where sixteen on a 4 m mesh do not', () => {
    expect(gridAreaLimitWarning(createGradeState(), gridHoles(16, 3))).toBeNull();
    expect(gridAreaLimitWarning(createGradeState(), gridHoles(16))).toContain('256');
  });

  it('a hole added by hand (no pattern cell) counts the square to its nearest neighbour', () => {
    // Eight grid holes in one row (x = 0..28) work 128 m²; a hand hole 4 m past the row adds 16 m², 5 m past it 25 m².
    const row = gridHoles(8);
    expect(gridAreaLimitWarning(createGradeState(), [...row, { id: 'add', x: 32, z: 0 }])).toBeNull();
    const w = gridAreaLimitWarning(createGradeState(), [...row, { id: 'add', x: 33, z: 0 }])!;
    expect(w).toContain('153');
  });

  it('carries the consequence text of the plan area', () => {
    const w = gridAreaLimitWarning(createGradeState(), [...gridHoles(3), ...gridHoles(9, CELL_M, 4)])!;
    expect(w).toContain(consequenceFor(12, 0));
    expect(consequenceFor(12, 0).length).toBeGreaterThan(0);
  });

  it('a bigger plan area carries a bigger consequence than a smaller one', () => {
    const small = gridAreaLimitWarning(createGradeState(), gridHoles(10))!;
    const big = gridAreaLimitWarning(createGradeState(), gridHoles(20))!;
    expect(small).toContain(consequenceFor(10, 0));
    expect(big).toContain(consequenceFor(20, 0));
    expect(small).not.toContain(consequenceFor(20, 0));
  });

  it('counts only live strikes at the given tick in the consequence', () => {
    const g = createGradeState();
    g.strikeTicks = [900, 1500];
    const w = gridAreaLimitWarning(g, gridHoles(10), 2000)!;
    expect(w).toContain(consequenceFor(10, 0, [900, 1500], 2000));
    expect(w).not.toContain(consequenceFor(10, 0, [], 2000));
  });

  it('tick defaults to 0', () => {
    const g = createGradeState();
    g.strikeTicks = [10];
    expect(gridAreaLimitWarning(g, gridHoles(10))).toContain(consequenceFor(10, 0, [10], 0));
  });

  it('en and fr both define the warning text', () => {
    const read = (l: string): Record<string, string> => JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8'));
    setLocale('fr');
    try {
      const w = gridAreaLimitWarning(createGradeState(), [...gridHoles(3), ...gridHoles(9, CELL_M, 4)])!;
      expect(w).toContain('192');
      expect(w).toContain(consequenceFor(12, 0));
      expect(w).not.toMatch(/^permit\./);
    } finally { setLocale('en'); }
    expect(Object.keys(read('en')).filter(k => k.startsWith('permit.preview.')).sort())
      .toEqual(Object.keys(read('fr')).filter(k => k.startsWith('permit.preview.')).sort());
    for (const l of ['en', 'fr']) {
      for (const param of ['{area}', '{limit}', '{consequence}']) expect(read(l)['permit.preview.grid_warning']).toContain(param);
    }
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
