// @vitest-environment jsdom
// Proves the countdown derives from BANKRUPTCY_GRACE_TICKS rather than a
// hardcoded 100: the constant is mocked to 60 (#1376).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/core/campaign/Bankruptcy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/campaign/Bankruptcy.js')>()),
  BANKRUPTCY_GRACE_TICKS: 60,
}));

import { FinancesPanel } from '../../../../src/ui/panels/FinancesPanel.js';
import { formatGameDuration } from '../../../../src/ui/formatGameDuration.js';
import { createGame } from '../../../../src/core/state/GameState.js';

function textFor(ticks: number): string {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new FinancesPanel(container);
  panel.show();
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.bankruptcy.ticksBelowThreshold = ticks;
  panel.update(s);
  return panel.root.textContent ?? '';
}

describe('FinancesPanel countdown uses BANKRUPTCY_GRACE_TICKS', () => {
  it('40 ticks below with grace 60 shows 20', () => {
    expect(textFor(40)).toContain(`Bankruptcy in ${formatGameDuration(20)}`);
  });
  it('grace-length streak shows 0', () => {
    expect(textFor(60)).toContain(`Bankruptcy in ${formatGameDuration(0)}`);
  });
  it('clamps at 0 beyond grace', () => {
    expect(textFor(75)).toContain(`Bankruptcy in ${formatGameDuration(0)}`);
  });
});
