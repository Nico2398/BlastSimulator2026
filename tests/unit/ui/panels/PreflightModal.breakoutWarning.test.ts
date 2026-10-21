// @vitest-environment jsdom
// BlastSimulator2026 — Pre-flight breakout warning row (#2003)
import { describe, it, expect, vi } from 'vitest';
import { PreflightModal } from '../../../../src/ui/panels/PreflightModal.js';
import { sandboxPadGrid, breakoutShotState } from '../../../helpers/breakoutWarningFixture.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';
import type { VoxelGrid } from '../../../../src/core/world/VoxelGrid.js';
import type { GameState } from '../../../../src/core/state/GameState.js';

const ROW = '[data-role="preflight-breakout-warning"]';

function open(grid: VoxelGrid | null, state: GameState): { modal: PreflightModal; gameConsole: ReturnType<typeof vi.fn> } {
  setLocale('en');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modal = new PreflightModal(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  modal.setGameConsole(gameConsole);
  modal.setGridProvider(() => grid);
  modal.show();
  modal.update(state, 'sunny');
  return { modal, gameConsole };
}

const detonate = (m: PreflightModal) => m.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;

describe('PreflightModal breakout warning', () => {
  it('warns for a 12 m x 10 kg Krackle pattern and names the too-deep hole count', () => {
    const { modal } = open(sandboxPadGrid(), breakoutShotState(12, 'krackle', 10));
    const row = modal.root.querySelector(ROW);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('9');
  });

  it('suggests shorter holes and never a wider hole', () => {
    const text = open(sandboxPadGrid(), breakoutShotState(12, 'krackle', 10)).modal.root.querySelector(ROW)!.textContent!;
    expect(text).toMatch(/shorter/i);
    expect(text).not.toMatch(/wider|bigger|larger|diameter/i);
  });

  it.each([0, 4])('shows at software tier %i', (tier) => {
    const state = breakoutShotState(12, 'krackle', 10);
    state.softwareTier = tier;
    expect(open(sandboxPadGrid(), state).modal.root.querySelector(ROW)).not.toBeNull();
  });

  it('warns for a partial seal (10 m x 10 kg Krackle)', () => {
    expect(open(sandboxPadGrid(), breakoutShotState(10, 'krackle', 10)).modal.root.querySelector(ROW)).not.toBeNull();
  });

  it('warns for 127 mm holes with 20 kg Krackle at 12 m', () => {
    expect(open(sandboxPadGrid(), breakoutShotState(12, 'krackle', 20, 0.127)).modal.root.querySelector(ROW)).not.toBeNull();
  });

  it('adds no row for the 8 m x 8 kg defaults-like shot', () => {
    expect(open(sandboxPadGrid(), breakoutShotState(8, 'krackle', 8)).modal.root.querySelector(ROW)).toBeNull();
  });

  it('adds no row for 12 m x 15 kg Shatternite, which breaks out', () => {
    expect(open(sandboxPadGrid(), breakoutShotState(12, 'shatternite', 15)).modal.root.querySelector(ROW)).toBeNull();
  });

  it('adds no row without a grid', () => {
    expect(open(null, breakoutShotState(12, 'krackle', 10)).modal.root.querySelector(ROW)).toBeNull();
  });

  it('is a warning, not a gate: detonate is enabled and still fires', () => {
    const warned = open(sandboxPadGrid(), breakoutShotState(12, 'krackle', 10));
    const quiet = open(sandboxPadGrid(), breakoutShotState(8, 'krackle', 8));
    expect(detonate(warned.modal).disabled).toBe(detonate(quiet.modal).disabled);
    expect(detonate(warned.modal).disabled).toBe(false);
    detonate(warned.modal).click();
    expect(warned.gameConsole).toHaveBeenCalledWith('blast detonate');
  });
});
