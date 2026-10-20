// @vitest-environment jsdom
// BlastSimulator2026 — Pre-flight predicted-hazard-rating row (#1968)
import { describe, it, expect, vi } from 'vitest';
import { PreflightModal } from '../../../../src/ui/panels/PreflightModal.js';
import { standardShot } from '../../../helpers/wallWarningFixture.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';
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
  state.lastBlastPreview = {
    tier,
    energy: { affectedVoxels: 10, minEnergy: 1, maxEnergy: 5 },
    fragments: tier >= 2 ? { fractured: 5, cracked: 1, unaffected: 0, avgFragmentSizeCm: 40 } : null,
    projections: tier >= 3
      ? {
        projectionZoneVoxels: 1, collapseFragments: 0,
        ...(rating ? { predictedRating: rating, thrownFragments: 3, totalFragments: 10, thrownShare: 0.3, furthestThrowM: 13 } : {}),
      }
      : null,
    vibrations: null,
  };
  modal.show();
  modal.update(state, 'sunny');
  return modal;
}

describe('PreflightModal predicted rating row', () => {
  it.each<BlastRating>(['catastrophic', 'bad'])('warns when %s is predicted at T3', (rating) => {
    const row = open(3, rating).root.querySelector(ROW);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(t(`blast.rating.${rating}`));
  });

  it.each<BlastRating>(['perfect', 'good', 'mediocre'])('adds no row for %s', (rating) => {
    expect(open(3, rating).root.querySelector(ROW)).toBeNull();
  });

  it('adds no row without a forecast', () => {
    expect(open(3, null).root.querySelector(ROW)).toBeNull();
  });

  it('below T3 adds no row and keeps the locked projections line', () => {
    const modal = open(2, null);
    expect(modal.root.querySelector(ROW)).toBeNull();
    expect(modal.root.textContent).toContain('projections — T3');
  });

  it('is a warning, not a gate: detonate stays enabled', () => {
    const modal = open(3, 'catastrophic');
    const btn = modal.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;
    const quiet = open(3, 'good').root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(quiet.disabled);
  });
});
