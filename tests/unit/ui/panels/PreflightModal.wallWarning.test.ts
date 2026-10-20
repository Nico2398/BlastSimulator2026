// @vitest-environment jsdom
// BlastSimulator2026 — Pre-flight wall-slump warning row (#1943)
import { describe, it, expect, vi } from 'vitest';
import { PreflightModal } from '../../../../src/ui/panels/PreflightModal.js';
import { buildWallGrid, standardShot } from '../../../helpers/wallWarningFixture.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';
import type { VoxelGrid } from '../../../../src/core/world/VoxelGrid.js';
import type { GameState } from '../../../../src/core/state/GameState.js';

const ROW = '[data-role="preflight-wall-warning"]';

function open(grid: VoxelGrid | null, state: GameState): { modal: PreflightModal; gameConsole: ReturnType<typeof vi.fn> } {
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

describe('PreflightModal wall warning', () => {
  it('adds a warning row naming height, rock and safe height when the shot leaves an overheight face', () => {
    setLocale('en');
    const { modal } = open(buildWallGrid({ plateauTop: 25 }), standardShot().state);
    const row = modal.root.querySelector(ROW);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('13');
    expect(row!.textContent).toContain('Cruite');
    expect(row!.textContent).toContain('12');
  });

  it('adds the row for a face in the 80-100% band too', () => {
    const { modal } = open(buildWallGrid({ plateauTop: 23 }), standardShot().state);
    expect(modal.root.querySelector(ROW)).not.toBeNull();
  });

  it('adds no row when only low faces are left', () => {
    const { modal } = open(buildWallGrid({ plateauTop: 21 }), standardShot().state);
    expect(modal.root.querySelector(ROW)).toBeNull();
  });

  it('adds no row on a non-progression site', () => {
    const { modal } = open(buildWallGrid({ plateauTop: 25 }), standardShot('krackle', 8, false).state);
    expect(modal.root.querySelector(ROW)).toBeNull();
  });

  it('adds no row without a grid', () => {
    const { modal } = open(null, standardShot().state);
    expect(modal.root.querySelector(ROW)).toBeNull();
  });

  it('is a warning, not a gate: detonate is as usable as without the warning and still fires', () => {
    const warned = open(buildWallGrid({ plateauTop: 25 }), standardShot().state);
    const quiet = open(buildWallGrid({ plateauTop: 21 }), standardShot().state);
    expect(warned.modal.root.querySelector(ROW)).not.toBeNull();
    expect(detonate(warned.modal).disabled).toBe(detonate(quiet.modal).disabled);
    expect(detonate(warned.modal).disabled).toBe(false);
    detonate(warned.modal).click();
    expect(warned.gameConsole).toHaveBeenCalledWith('blast detonate');
  });
});
