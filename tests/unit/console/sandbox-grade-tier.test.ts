// BlastSimulator2026 — `sandbox start grade:N tier:M` starts a progression site on a rung of the ladder (#2277)

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { gradeRung } from '../../../src/core/economy/MineGrade.js';
import { permitLimitsFor } from '../../../src/core/economy/PermitLimits.js';
import { serializeGameState } from '../../../src/console-api.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const BASE = 'sandbox start biome:desert_badlands seed:42';

function start(args = '') {
  const { runner, ctx } = createRunner();
  const result = runner.run(`${BASE} ${args}`.trim());
  return { runner, ctx, result };
}

describe('sandbox start grade:N tier:M (#2277)', () => {
  beforeAll(() => setLocale('en'));

  it('without either starts at grade 0, tier 1', () => {
    const { ctx, result } = start();
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.grade).toMatchObject({ grade: 0, tier: 1 });
  });

  it('tier defaults to 1 when only a grade is given', () => {
    const { ctx, result } = start('grade:2');
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.grade).toMatchObject({ grade: 2, tier: 1 });
  });

  it.each([[0, 2], [0, 3], [1, 1], [1, 3], [2, 2], [3, 3]])('grade:%i tier:%i starts there', (grade, tier) => {
    const { ctx, result } = start(`grade:${grade} tier:${tier}`);
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.grade).toMatchObject({ grade, tier });
  });

  it('tier alone raises the tier of grade 0', () => {
    const { ctx, result } = start('tier:2');
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.grade).toMatchObject({ grade: 0, tier: 2 });
  });

  it.each([4, 5, 9])('a class grade (%i) is forced to tier 1', (grade) => {
    const { ctx, result } = start(`grade:${grade} tier:3`);
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.grade).toMatchObject({ grade, tier: 1 });
  });

  it.each([['0'], ['4'], ['-1'], ['1.5'], ['x'], ['NaN']])('tier:%s is refused as an invalid tier', (raw) => {
    const { result } = start(`grade:1 tier:${raw}`);
    expect(result.success).toBe(false);
    expect(result.output).toContain(raw);
    expect(result.output).not.toBe('sandbox.invalid_tier');
  });

  it('an invalid tier starts no game', () => {
    const { ctx, result } = start('tier:7');
    expect(result.success).toBe(false);
    expect(ctx.state?.grade).toBeUndefined();
  });

  it('the invalid-tier message has text in both locales, differing between them', () => {
    expect((en as Record<string, string>)['sandbox.invalid_tier']).toBeTruthy();
    expect((fr as Record<string, string>)['sandbox.invalid_tier']).toBeTruthy();
    expect((fr as Record<string, string>)['sandbox.invalid_tier']).not.toBe((en as Record<string, string>)['sandbox.invalid_tier']);
    expect(t('sandbox.invalid_tier', { value: '9' })).not.toBe('sandbox.invalid_tier');
  });

  it('the started rung drives the permit: status names grade and tier, limits follow', () => {
    const { runner, ctx } = start('grade:2 tier:3');
    const out = runner.run('permit status').output;
    expect(out).toContain(t('permit.status.grade', { grade: 2, tier: 3, name: t('permit.grade.2') }));
    const l = permitLimitsFor(2, 3);
    expect(out).toContain(`${l.maxChargeKg} kg`);
    expect(gradeRung(ctx.state!.grade!)).toBe(8);
  });

  it('the console state carries the tier next to the grade', () => {
    const { ctx } = start('grade:1 tier:2');
    expect(serializeGameState(ctx as unknown as MiningContext)!.mineGrade).toMatchObject({ grade: 1, tier: 2 });
  });

  it('a tier started above 1 still owes the tier-3 gate: apply below tier 3 is refused', () => {
    const { runner, ctx } = start('grade:1 tier:2');
    ctx.state!.cash = 1_000_000_000;
    const r = runner.run('permit apply');
    expect(r.success).toBe(false);
    expect(ctx.state!.grade!.pending).toBeNull();
  });
});
