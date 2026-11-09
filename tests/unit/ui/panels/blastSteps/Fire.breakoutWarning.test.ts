// @vitest-environment jsdom
// BlastSimulator2026 — Blast step Pre-Flight breakout warning row (#2003)
import { describe, it, expect } from 'vitest';
import { FireStep } from '../../../../../src/ui/panels/blastSteps/Fire.js';
import { sandboxPadGrid, breakoutShotState } from '../../../../helpers/breakoutWarningFixture.js';
import { nothingBreaksGrid, nothingBreaksState } from '../../../../helpers/breaksNothingFixture.js';
import { setLocale, t } from '../../../../../src/core/i18n/I18n.js';
import type { VoxelGrid } from '../../../../../src/core/world/VoxelGrid.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';

const ROW = '[data-role="breakout-check"]';

function render(grid: VoxelGrid | null, state: GameState): FireStep {
  setLocale('en');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new FireStep(container);
  step.setGridProvider(() => grid);
  step.update(state, 'sunny');
  return step;
}

describe('FireStep breakout warning', () => {
  it('shows the row for a 12 m x 10 kg Krackle pattern, naming the too-deep hole count', () => {
    const row = render(sandboxPadGrid(), breakoutShotState(12, 'krackle', 10)).root.querySelector(ROW);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('9');
  });

  it('suggests shorter holes and never a wider hole', () => {
    const text = render(sandboxPadGrid(), breakoutShotState(12, 'krackle', 10)).root.querySelector(ROW)!.textContent!;
    expect(text).toMatch(/shorter/i);
    expect(text).not.toMatch(/wider|bigger|larger|diameter/i);
  });

  it.each([0, 4])('shows at software tier %i', (tier) => {
    const state = breakoutShotState(12, 'krackle', 10);
    state.softwareTier = tier;
    expect(render(sandboxPadGrid(), state).root.querySelector(ROW)).not.toBeNull();
  });

  it('shows the row for a partial seal (10 m x 10 kg Krackle)', () => {
    expect(render(sandboxPadGrid(), breakoutShotState(10, 'krackle', 10)).root.querySelector(ROW)).not.toBeNull();
  });

  it('shows no row for the 8 m x 8 kg shot', () => {
    expect(render(sandboxPadGrid(), breakoutShotState(8, 'krackle', 8)).root.querySelector(ROW)).toBeNull();
  });

  it('shows no row for 12 m x 15 kg Shatternite', () => {
    expect(render(sandboxPadGrid(), breakoutShotState(12, 'shatternite', 15)).root.querySelector(ROW)).toBeNull();
  });

  it('shows no row without a grid', () => {
    expect(render(null, breakoutShotState(12, 'krackle', 10)).root.querySelector(ROW)).toBeNull();
  });

  it('shows no row without holes', () => {
    const state = breakoutShotState(12, 'krackle', 10);
    state.drillHoles.length = 0;
    expect(render(sandboxPadGrid(), state).root.querySelector(ROW)).toBeNull();
  });
});

describe('FireStep breaks-nothing warning (#2197)', () => {
  const KEY = 'ui.blast_workshop.fire.check_breakout_nothing';

  it('shows the breaks-nothing row, in the nothing wording rather than the too-deep one', () => {
    const row = render(nothingBreaksGrid(), nothingBreaksState()).root.querySelector(ROW);
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe(t(KEY));
    expect(row!.textContent).not.toBe(t('ui.blast_workshop.fire.check_breakout_none', { count: 9, total: 9 }));
  });

  it.each([0, 1, 2, 3, 4])('shows at software tier %i', (tier) => {
    const state = nothingBreaksState();
    state.softwareTier = tier;
    expect(render(nothingBreaksGrid(), state).root.querySelector(ROW)).not.toBeNull();
  });

  it('renders in French too', () => {
    const step = render(nothingBreaksGrid(), nothingBreaksState());
    setLocale('fr');
    step.update(nothingBreaksState(), 'sunny');
    const text = step.root.querySelector(ROW)!.textContent!;
    setLocale('en');
    expect(text).toMatch(/Rien ne casse/);
  });

  it('shows no row without a grid', () => {
    expect(render(null, nothingBreaksState()).root.querySelector(ROW)).toBeNull();
  });

  it('shows no row without holes', () => {
    const state = nothingBreaksState();
    state.drillHoles.length = 0;
    expect(render(nothingBreaksGrid(), state).root.querySelector(ROW)).toBeNull();
  });
});
