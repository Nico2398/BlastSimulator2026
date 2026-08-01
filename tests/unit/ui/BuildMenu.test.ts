// @vitest-environment jsdom
// BlastSimulator2026 — Placed-buildings list layout (issue #462)
//
// Bug: `makePlacedRow()`'s `info` div uses plain `flex:1` (no basis) and its
// four action buttons (Move/Upgrade/Queue Research/Demolish) have no
// flex/white-space override. With 4 buttons in a 270px-wide `#bs-build-panel`
// the `info` column collapses to near-zero width, showing only a stray
// fragment of the label (e.g. a lone ':') for rows like Research Center that
// still show the "Queue Research" button. `makeCatalogRow()` already ships
// the fix for the identical defect (flex:1 1 50% on info, flex:0 1 auto +
// white-space:normal on buttons) — this file asserts `makePlacedRow()`
// matches that pattern. jsdom has no layout engine, so assertions check
// inline style VALUES, not rendered pixel widths.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BuildMenu } from '../../../src/ui/BuildMenu.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Building } from '../../../src/core/entities/Building.js';

/** Minimal GameState that won't crash the panel update loop. */
function makeMockState(overrides?: Partial<GameState>): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 99999;
  return { ...s, ...overrides };
}

function makeBuilding(overrides: Partial<Building> & Pick<Building, 'id' | 'type' | 'tier'>): Building {
  return {
    x: 5,
    z: 5,
    hp: 100,
    active: true,
    ...overrides,
  };
}

function setupMenu(): { container: HTMLDivElement; menu: BuildMenu } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const menu = new BuildMenu(container);
  return { container, menu };
}

/**
 * Find a placed-row by building id, scoped to this test's own container.
 * Deliberately avoids the `#bs-build-placed` id selector: jsdom resolves id
 * selectors against the whole document rather than the query root, so a
 * prior test's un-disposed BuildMenu (same id, different container) can
 * shadow this one. Class + attribute selectors don't have that failure mode.
 */
function findPlacedRow(container: HTMLElement, buildingId: number): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `.bs-build-placed-row[data-building-id="${buildingId}"]`,
  );
  if (!row) throw new Error(`no placed row found for building id ${buildingId}`);
  return row;
}

describe('BuildMenu — placed-row layout does not collapse the label column (issue #462)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  it('4-button row (Research Center, tier 2 locked + not queued): info div gets a flex basis and min-width:0, all 4 buttons get flex:0 1 auto + white-space:normal', () => {
    const researchCenter = makeBuilding({ id: 1, type: 'research_center', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [researchCenter];
    // Default unlockedTiers is {} (tier 2 not unlocked) and researchQueue is
    // empty (nothing queued), so researchBtn is visible — 4 buttons total.

    menu.update(state);

    const row = findPlacedRow(container, 1);

    const info = row.querySelector<HTMLElement>('div');
    expect(info).not.toBeNull();
    expect(info!.style.flex).toBe('1 1 50%');
    expect(info!.style.minWidth).toBe('0px');
    // Sanity: only CSS changed, label text still complete.
    expect(info!.textContent).toContain('#1');
    expect(info!.textContent).toContain('(5,5)');

    const moveBtn = row.querySelector<HTMLButtonElement>('.bs-build-move-btn');
    const upgradeBtn = row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn');
    const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn');
    const demolishBtn = row.querySelector<HTMLButtonElement>('.bs-build-demolish-btn');

    expect(moveBtn).not.toBeNull();
    expect(upgradeBtn).not.toBeNull();
    expect(researchBtn).not.toBeNull();
    expect(demolishBtn).not.toBeNull();
    // Research Center's own tier 2 must be locked and not queued for the
    // 4th button to be visible — confirm the fixture actually exercises the
    // 4-button case before asserting on its buttons.
    expect(researchBtn!.style.display).not.toBe('none');

    for (const btn of [moveBtn, upgradeBtn, researchBtn, demolishBtn]) {
      expect(btn!.style.flex).toBe('0 1 auto');
      expect(btn!.style.whiteSpace).toBe('normal');
    }
  });

  it('3-button row (Living Quarters at max tier 3, researchBtn hidden): info div gets a flex basis and min-width:0, all 3 visible buttons get flex:0 1 auto + white-space:normal', () => {
    const livingQuarters = makeBuilding({ id: 2, type: 'living_quarters', tier: 3 });
    const state = makeMockState();
    state.buildings.buildings = [livingQuarters];
    // Tier 3 is the max tier, so nextTier is null and researchBtn stays
    // hidden — exactly 3 visible buttons: Move, Upgrade (disabled), Demolish.

    menu.update(state);

    const row = findPlacedRow(container, 2);

    const info = row.querySelector<HTMLElement>('div');
    expect(info).not.toBeNull();
    expect(info!.style.flex).toBe('1 1 50%');
    expect(info!.style.minWidth).toBe('0px');
    expect(info!.textContent).toContain('#2');
    expect(info!.textContent).toContain('(5,5)');

    const moveBtn = row.querySelector<HTMLButtonElement>('.bs-build-move-btn');
    const upgradeBtn = row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn');
    const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn');
    const demolishBtn = row.querySelector<HTMLButtonElement>('.bs-build-demolish-btn');

    expect(moveBtn).not.toBeNull();
    expect(upgradeBtn).not.toBeNull();
    expect(demolishBtn).not.toBeNull();
    // Confirm the fixture actually exercises the 3-button case.
    expect(researchBtn!.style.display).toBe('none');

    for (const btn of [moveBtn, upgradeBtn, demolishBtn]) {
      expect(btn!.style.flex).toBe('0 1 auto');
      expect(btn!.style.whiteSpace).toBe('normal');
    }
  });
});
