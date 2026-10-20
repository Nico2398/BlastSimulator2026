// BlastSimulator2026 — permitPreview view model (#1925): plan vs the mine's permit.
import { describe, it, expect } from 'vitest';
import { permitPreview, gridHoleLimitWarning } from '../../../../src/ui/panels/permitPreview.js';
import { createGradeState } from '../../../../src/core/economy/MineGrade.js';
import { permitLimitsFor } from '../../../../src/core/economy/PermitLimits.js';
import { PERMIT_STRIKE_WINDOW_TICKS } from '../../../../src/core/config/balance.js';

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

  it('never exposes the overshoot or an inspection chance', () => {
    const p = permitPreview(createGradeState(), plan(12, 5), 0)!;
    const json = JSON.stringify(p).toLowerCase();
    expect(Object.keys(p)).not.toContain('overshoot');
    expect(Object.keys(p).join(' ').toLowerCase()).not.toContain('chance');
    expect(json).not.toContain('chance');
    expect(json).not.toContain('overshoot');
  });
});

describe('gridHoleLimitWarning', () => {
  it('null for an undefined grade', () => {
    expect(gridHoleLimitWarning(undefined, 500)).toBeNull();
  });

  it('null at the limit', () => {
    expect(gridHoleLimitWarning(createGradeState(), 9)).toBeNull();
  });

  it('null below the limit', () => {
    expect(gridHoleLimitWarning(createGradeState(), 1)).toBeNull();
  });

  it('text above the limit', () => {
    const w = gridHoleLimitWarning(createGradeState(), 10);
    expect(typeof w).toBe('string');
    expect(w!.length).toBeGreaterThan(0);
  });

  it('never mentions an inspection chance', () => {
    expect(gridHoleLimitWarning(createGradeState(), 50)!.toLowerCase()).not.toContain('chance');
  });
});
