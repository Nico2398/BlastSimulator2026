// BlastSimulator2026 — permitRefusalText / permitApplyBlocker (#1924)
import { describe, it, expect, beforeAll } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { applyForGrade, createGradeState, gradeDef, nextGradeTargets } from '../../../src/core/economy/MineGrade.js';
import { permitApplyBlocker, permitRefusalText } from '../../../src/core/economy/permitRefusalText.js';

function progression(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.grade = createGradeState();
  s.cash = 1_000_000;
  return s;
}

function meetTargets(s: GameState): void {
  s.grade!.oreDeliveredKg = 5_000;
  s.grade!.blastsFired = 2;
}

describe('permitRefusalText (#1924)', () => {
  beforeAll(() => setLocale('en'));

  it('no_ladder reads permit.no_ladder', () => {
    expect(permitRefusalText('no_ladder', [], 0, 0)).toBe(t('permit.no_ladder'));
  });

  it('pending reads permit.refusal.pending', () => {
    expect(permitRefusalText('pending', [], 0, 0)).toBe(t('permit.refusal.pending'));
  });

  it('unmet_targets names every unmet kind, comma separated', () => {
    const text = permitRefusalText('unmet_targets', ['ore_kg', 'blasts'], 0, 0);
    expect(text).toBe(t('permit.refusal.unmet_targets', { targets: `${t('permit.kind.ore_kg')}, ${t('permit.kind.blasts')}` }));
  });

  it('unmet_targets with one kind names only it', () => {
    const text = permitRefusalText('unmet_targets', ['blasts'], 20_000, 5);
    expect(text).toContain(t('permit.kind.blasts'));
    expect(text).not.toContain(t('permit.kind.ore_kg'));
  });

  it('insufficient_funds formats fee and cash as money', () => {
    expect(permitRefusalText('insufficient_funds', [], 20_000, 1_234)).toBe(
      t('permit.refusal.insufficient_funds', { fee: formatMoney(20_000), cash: formatMoney(1_234) }),
    );
  });

  it('follows the locale', () => {
    setLocale('fr');
    const fr = permitRefusalText('pending', [], 0, 0);
    setLocale('en');
    expect(fr.length).toBeGreaterThan(0);
    expect(fr).not.toBe(permitRefusalText('pending', [], 0, 0));
  });
});

describe('permitApplyBlocker (#1924)', () => {
  beforeAll(() => setLocale('en'));

  it('is null when targets are met, cash covers the fee and nothing is pending', () => {
    const s = progression();
    meetTargets(s);
    expect(permitApplyBlocker(s)).toBeNull();
  });

  it('is null when cash equals the fee exactly', () => {
    const s = progression();
    meetTargets(s);
    s.cash = gradeDef(1).fee;
    expect(permitApplyBlocker(s)).toBeNull();
  });

  it('reports unmet_targets with the unmet kinds', () => {
    const s = progression();
    s.grade!.oreDeliveredKg = 5_000;
    expect(permitApplyBlocker(s)).toEqual({ refusal: 'unmet_targets', unmet: ['blasts'] });
  });

  it('lists every unmet kind on a fresh site', () => {
    const s = progression();
    const expected = nextGradeTargets(s).map(x => x.kind);
    expect(permitApplyBlocker(s)).toEqual({ refusal: 'unmet_targets', unmet: expected });
  });

  it('unmet targets take precedence over insufficient funds', () => {
    const s = progression();
    s.cash = 0;
    expect(permitApplyBlocker(s)?.refusal).toBe('unmet_targets');
  });

  it('reports insufficient_funds when targets are met and cash is one short', () => {
    const s = progression();
    meetTargets(s);
    s.cash = gradeDef(1).fee - 1;
    expect(permitApplyBlocker(s)).toEqual({ refusal: 'insufficient_funds', unmet: [] });
  });

  it('reports pending while an application is on the pile', () => {
    const s = progression();
    meetTargets(s);
    s.grade!.pending = { toGrade: 1, ticksLeft: 10 };
    expect(permitApplyBlocker(s)?.refusal).toBe('pending');
  });

  it('reports no_ladder without grade state', () => {
    const s = createGame({ seed: 1, mineType: 'desert' });
    expect(permitApplyBlocker(s)?.refusal).toBe('no_ladder');
  });

  it('does not mutate the state', () => {
    const s = progression();
    meetTargets(s);
    const before = JSON.stringify(s.grade) + s.cash;
    permitApplyBlocker(s);
    expect(JSON.stringify(s.grade) + s.cash).toBe(before);
  });

  it('agrees with applyForGrade on cloned states', () => {
    const variants: Array<(s: GameState) => void> = [
      () => {},
      (s) => { meetTargets(s); },
      (s) => { meetTargets(s); s.cash = 5; },
      (s) => { s.cash = 5; },
      (s) => { meetTargets(s); s.grade!.pending = { toGrade: 1, ticksLeft: 3 }; },
      (s) => { delete s.grade; },
    ];
    for (const mutate of variants) {
      const s = progression();
      mutate(s);
      const blocker = permitApplyBlocker(s);
      const result = applyForGrade(structuredClone(s));
      if (blocker === null) expect(result.ok).toBe(true);
      else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.refusal).toBe(blocker.refusal);
          expect(result.unmet ?? []).toEqual(blocker.unmet);
        }
      }
    }
  });
});
