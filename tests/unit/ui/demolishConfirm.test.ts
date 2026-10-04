// @vitest-environment jsdom
// Demolish confirmation modal config (#1399).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildDemolishConfirm } from '../../../src/ui/demolishConfirm.js';
import { getDemolishCost, type Building } from '../../../src/core/entities/Building.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { t } from '../../../src/core/i18n/I18n.js';
import { BuildMenu } from '../../../src/ui/BuildMenu.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 7, type: 'management_office', tier: 1, x: 5, z: 5, hp: 100, active: true, occupantIds: [], ...overrides };
}

describe('buildDemolishConfirm (#1399)', () => {
  it('uses the demolish label, trash icon and a localized title', () => {
    const cfg = buildDemolishConfirm(makeBuilding(), vi.fn());
    expect(cfg.confirmLabel).toBe(t('ui.build.demolish'));
    expect(cfg.icon).toBe('trash');
    expect(cfg.title).toBe(t('ui.build.demolish_confirm_title'));
    expect(cfg.title).not.toBe('ui.build.demolish_confirm_title');
  });

  it('body names the building and the formatted demolish cost', () => {
    const b = makeBuilding();
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).toContain(t('building.management_office.t1.name'));
    expect(cfg.body).toContain(formatMoney(getDemolishCost(b)));
    expect(cfg.body).not.toContain('ui.build.demolish_confirm_body');
  });

  it('cost string tracks the tier', () => {
    const b = makeBuilding({ tier: 2 });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).toContain(formatMoney(getDemolishCost(b)));
    expect(cfg.body).toContain(t('building.management_office.t2.name'));
  });

  it('plain building body has no lost-explosives line', () => {
    const cfg = buildDemolishConfirm(makeBuilding(), vi.fn());
    expect(cfg.body).not.toContain(t('ui.build.demolish_confirm_loses_explosives', { kg: 0 }));
    expect(cfg.body).not.toContain('ui.build.demolish_confirm_loses_explosives');
  });

  it('explosive warehouse with stock warns with the kg lost', () => {
    const b = makeBuilding({ type: 'explosive_warehouse', storedExplosivesKg: 250 });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).toContain(t('ui.build.demolish_confirm_loses_explosives', { kg: 250 }));
    expect(cfg.body).toContain('250');
    expect(cfg.body).not.toContain('{kg}');
  });

  it('explosive warehouse with zero stock has no warning', () => {
    const b = makeBuilding({ type: 'explosive_warehouse', storedExplosivesKg: 0 });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).not.toContain(t('ui.build.demolish_confirm_loses_explosives', { kg: 0 }));
  });

  it('explosive warehouse with undefined stock has no warning', () => {
    const b = makeBuilding({ type: 'explosive_warehouse' });
    const cfg = buildDemolishConfirm(b, vi.fn());
    expect(cfg.body).not.toContain('ui.build.demolish_confirm_loses_explosives');
    expect(cfg.body).not.toMatch(/\bkg\b.*lost|lost.*\bkg\b/i);
  });

  it('does not invoke onConfirm when only built (cancel path)', () => {
    const onConfirm = vi.fn();
    buildDemolishConfirm(makeBuilding(), onConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('onConfirm callback is the one passed in', () => {
    const onConfirm = vi.fn();
    buildDemolishConfirm(makeBuilding(), onConfirm).onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('BuildMenu demolish confirm failure path (#1399)', () => {
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { container.remove(); });

  it('shows the command output when the destroy is refused', async () => {
    const { createGame } = await import('../../../src/core/state/GameState.js');
    const menu = new BuildMenu(container);
    const gameConsole = vi.fn<[string], CommandResult>().mockReturnValue({ success: false, output: 'Nope: broke' });
    menu.setGameConsole(gameConsole);
    const handler = vi.fn();
    menu.setConfirmHandler(handler);
    const state = createGame({ seed: 42, mineType: 'desert' });
    state.cash = 99999;
    state.buildings.buildings = [makeBuilding({ id: 3 })];
    menu.update(state);
    container.querySelector<HTMLButtonElement>('.bs-build-placed-row[data-building-id="3"] .bs-build-demolish-btn')!.click();

    handler.mock.calls[0]![0].onConfirm();

    expect(gameConsole).toHaveBeenCalledWith('build destroy 3');
    expect(container.textContent).toContain('Nope: broke');
  });
});
