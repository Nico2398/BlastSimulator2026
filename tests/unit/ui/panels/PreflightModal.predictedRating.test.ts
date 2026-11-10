// @vitest-environment jsdom
// BlastSimulator2026 — Pre-flight predicted line: tag, locked texts, fragment summary and forecast row (#1968, #2201)
import { describe, it, expect, vi } from 'vitest';
import { PreflightModal } from '../../../../src/ui/panels/PreflightModal.js';
import { standardShot } from '../../../helpers/wallWarningFixture.js';
import { makePreviewSummary, PREVIEW_FIGURES } from '../../../helpers/blastPreviewFixture.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../../src/core/economy/formatMoney.js';
import type { BlastRating } from '../../../../src/core/mining/BlastExecution.js';
import type { GameState } from '../../../../src/core/state/GameState.js';

const ROW = '[data-role="preflight-predicted-rating"]';

function open(tier: number, rating: BlastRating | null): PreflightModal {
  setLocale('en');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modal = new PreflightModal(container);
  modal.setGameConsole(vi.fn().mockReturnValue({ success: true, output: '' }));
  const state: GameState = standardShot('krackle', 8, false).state;
  state.softwareTier = tier;
  const preview = makePreviewSummary(tier, { rating: rating ?? 'good' });
  if (rating === null) preview.projections = null;
  state.lastBlastPreview = preview;
  modal.show();
  modal.update(state, 'sunny');
  return modal;
}

const textOf = (m: PreflightModal): string => m.root.textContent!;

describe('PreflightModal predicted rating row', () => {
  it.each<BlastRating>(['catastrophic', 'bad'])('warns when %s is predicted at T2', (rating) => {
    const row = open(2, rating).root.querySelector(ROW);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(t(`blast.rating.${rating}`));
  });

  it.each<BlastRating>(['catastrophic', 'bad'])('warns when %s is predicted at T3 and T4 as well', (rating) => {
    for (const tier of [3, 4]) {
      expect(open(tier, rating).root.querySelector(ROW), `tier ${tier}`).not.toBeNull();
    }
  });

  it.each<BlastRating>(['perfect', 'good', 'mediocre'])('adds no row for %s', (rating) => {
    expect(open(2, rating).root.querySelector(ROW)).toBeNull();
  });

  it('adds no row without a forecast', () => {
    expect(open(2, null).root.querySelector(ROW)).toBeNull();
  });

  it('below T2 adds no row', () => {
    expect(open(1, null).root.querySelector(ROW)).toBeNull();
    expect(open(0, null).root.querySelector(ROW)).toBeNull();
  });

  it('is a warning, not a gate: detonate stays enabled', () => {
    const modal = open(2, 'catastrophic');
    const btn = modal.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;
    const quiet = open(2, 'good').root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(quiet.disabled).toBe(false);
  });
});

describe('PreflightModal predicted line — forecast row at T2 (#2201)', () => {
  it('shows rating, thrown share and furthest throw', () => {
    const text = textOf(open(2, 'good'));
    expect(text).toContain(t('blast.rating.good'));
    expect(text).toContain('25%');
    expect(text).toMatch(/14(\.0)? m/);
  });

  it('keeps them out of the line below T2', () => {
    const text = textOf(open(1, null));
    expect(text).not.toContain('25%');
    expect(text).not.toMatch(/furthest 14/);
  });
});

describe('PreflightModal predicted line — fragment summary at T1 (#2201)', () => {
  it('shows oversized count, fines plus dust volume and dust loss', () => {
    const text = textOf(open(1, null));
    expect(text).toContain(String(PREVIEW_FIGURES.oversized));
    const combined = String(PREVIEW_FIGURES.finesVolumeM3 + PREVIEW_FIGURES.dustVolumeM3);
    const separate = text.includes(String(PREVIEW_FIGURES.finesVolumeM3)) && text.includes(String(PREVIEW_FIGURES.dustVolumeM3));
    expect(text.includes(combined) || separate).toBe(true);
    expect(text).toContain(formatMoney(PREVIEW_FIGURES.dustLossValue));
  });

  it('is still shown at T2 and above, beside the forecast', () => {
    for (const tier of [2, 3, 4]) {
      const text = textOf(open(tier, 'good'));
      expect(text, `tier ${tier}`).toContain(String(PREVIEW_FIGURES.oversized));
      expect(text, `tier ${tier}`).toContain(formatMoney(PREVIEW_FIGURES.dustLossValue));
    }
  });

  it('shows none of it at tier 0', () => {
    const text = textOf(open(0, null));
    expect(text).not.toContain(formatMoney(PREVIEW_FIGURES.dustLossValue));
    expect(text).not.toContain(String(PREVIEW_FIGURES.oversized));
  });
});

describe('PreflightModal predicted line — locked texts and tag (#2201)', () => {
  it('at tier 0 names blasting software T1 for the fragments and T2 for the forecast', () => {
    const text = textOf(open(0, null));
    expect(text).toContain('blasting software T1');
    expect(text).toContain('blasting software T2');
  });

  it('at tier 1 only the forecast stays locked, and it names blasting software T2', () => {
    const text = textOf(open(1, null));
    expect(text).toContain('blasting software T2');
    expect(text).not.toContain('blasting software T1');
  });

  it('at tier 2 nothing in the predicted line is locked', () => {
    const text = textOf(open(2, 'good'));
    expect(text).not.toContain('blasting software T');
  });

  it('no longer names the old tier numbers', () => {
    const text = textOf(open(0, null));
    expect(text).not.toContain('fragments — T2');
    expect(text).not.toContain('projections — T3');
  });

  it('the "Predicted at tier" tag explains itself through data-explain', () => {
    const modal = open(1, null);
    const tag = [...modal.root.querySelectorAll<HTMLElement>('*')]
      .filter(e => /predicted at/i.test(e.textContent ?? ''))
      .filter(e => ![...e.children].some(c => /predicted at/i.test(c.textContent ?? '')))[0];
    expect(tag).toBeDefined();
    const explain = tag!.closest<HTMLElement>('[data-explain]')?.dataset['explain'];
    expect(explain).toBeDefined();
    expect(explain!.length).toBeGreaterThan(20);
  });
});
