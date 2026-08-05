// @vitest-environment jsdom
// BlastSimulator2026 — UIManager NavGrid overlay wiring (issue #407)
//
// Regression coverage: UIManager never fed the live NavGrid into the MiniMap,
// and toggleNavGridOverlay() was an empty stub, so there was no player-facing
// way to see the nav-grid overlay even though MiniMap's drawing code was correct.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';
import { MiniMap } from '../../../src/ui/MiniMap.js';
import { CrewPanel } from '../../../src/ui/panels/CrewPanel.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';

function makeState() {
  const state = createGame({ seed: 1, mineType: 'desert' });
  // Give the state a real, non-null NavGrid so the assertion below verifies
  // actual object pass-through, not just a null default.
  const grid = new VoxelGrid(4, 4, 4);
  for (let z = 0; z < 4; z++)
    for (let x = 0; x < 4; x++)
      grid.setVoxel(x, 0, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  state.navGrid = NavGrid.buildNavGrid(grid, [], []);
  return state;
}

describe('UIManager — NavGrid overlay wiring', () => {
  let container: HTMLElement;
  let uiManager: UIManager | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = null;
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('update() feeds the current GameState.navGrid into the MiniMap', () => {
    // jsdom has no real canvas backend, so MiniMap.update()'s canvas drawing
    // would throw regardless of this fix — stub it out and verify only the
    // navGrid-feeding wiring under test.
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const setNavGridSpy = vi.spyOn(MiniMap.prototype, 'setNavGrid');
    uiManager = new UIManager(container);
    const state = makeState();

    uiManager.update(state);

    expect(setNavGridSpy).toHaveBeenCalledWith(state.navGrid);
  });

  it('update() re-feeds the NavGrid on every call', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const setNavGridSpy = vi.spyOn(MiniMap.prototype, 'setNavGrid');
    uiManager = new UIManager(container);
    const state = makeState();

    uiManager.update(state);
    uiManager.update(state);
    uiManager.update(state);

    expect(setNavGridSpy).toHaveBeenCalledTimes(3);
  });

  it('toggleNavGridOverlay() turns the overlay on from its default-off state', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenCalledWith(true);
  });

  it('toggleNavGridOverlay() flips back off on a second call', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenNthCalledWith(1, true);
    expect(setVisibleSpy).toHaveBeenNthCalledWith(2, false);
  });

  it('toggleNavGridOverlay() alternates on repeated calls', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenNthCalledWith(3, true);
  });
});

// ── Locale switch re-renders owned panels + toolbar (issue #457, bug 1) ───────
//
// Nothing wired SettingsMenu's language buttons into the rest of the app, so
// switching locale flipped I18n's global state but left every panel showing
// whatever locale was active when its constructor last called t(). These
// tests click the real DOM button a player uses (never call setLocale()
// directly) and check text that was baked in at construction time.

/** Clicks the Settings panel's French language button the way a player would. */
function clickFrenchButton(container: HTMLElement): void {
  const settingsPanel = container.querySelector('#bs-settings-panel');
  if (!settingsPanel) throw new Error('#bs-settings-panel not found');
  const frBtn = Array.from(settingsPanel.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => b.textContent === t('ui.settings.french'));
  if (!frBtn) throw new Error('French language button not found');
  frBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('UIManager — locale refresh on language switch (issue #457)', () => {
  let container: HTMLElement;
  let uiManager: UIManager | null;

  beforeEach(() => {
    setLocale('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = null;
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    setLocale('en');
    vi.restoreAllMocks();
  });

  it('tool rail button captions switch language after clicking FR in Settings', () => {
    uiManager = new UIManager(container);
    const blastRailBtn = container.querySelector<HTMLButtonElement>(
      '#bs-toolbar [data-panel="blast"]',
    );
    expect(blastRailBtn?.textContent).toBe(t('shell.rail.blast'));

    clickFrenchButton(container);

    expect(getLocale()).toBe('fr');
    expect(blastRailBtn?.textContent).toBe(t('shell.rail.blast'));
    expect(blastRailBtn?.textContent).not.toBe('Blast');
  });

  it('every tool rail button caption switches language, not just one', () => {
    uiManager = new UIManager(container);
    const panelKeys: [string, string][] = [
      ['blast', 'shell.rail.blast'],
      ['contracts', 'shell.rail.contracts'],
      ['build', 'shell.rail.build'],
      ['vehicles', 'shell.rail.vehicles'],
      ['employees', 'shell.rail.employees'],
      ['survey', 'shell.rail.survey'],
      ['settings', 'shell.rail.settings'],
    ];
    const before = panelKeys.map(([panel]) =>
      container.querySelector<HTMLButtonElement>(`#bs-toolbar [data-panel="${panel}"]`)?.textContent,
    );

    clickFrenchButton(container);

    for (let i = 0; i < panelKeys.length; i++) {
      const [panel, key] = panelKeys[i]!;
      const btn = container.querySelector<HTMLButtonElement>(`#bs-toolbar [data-panel="${panel}"]`);
      expect(btn?.textContent, `tool rail button "${panel}" must switch language`).not.toBe(before[i]);
      expect(btn?.textContent).toBe(t(key));
    }
  });

  it('the currently shown panel\'s static title switches language', () => {
    uiManager = new UIManager(container);
    uiManager.showPanel('vehicles');
    const fleetPanel = container.querySelector('#bs-vehicle-panel') as HTMLElement;
    expect(fleetPanel.textContent).toContain(t('ui.fleet.title')); // English baseline
    expect(t('ui.fleet.title')).toBe('Fleet');

    clickFrenchButton(container);

    expect(fleetPanel.textContent).toContain(t('ui.fleet.title'));
    expect(fleetPanel.textContent).not.toContain('Fleet');
  });

  it('every owned panel with a .bs-panel-title re-renders to a different string after the switch', () => {
    uiManager = new UIManager(container);
    const titleEls = Array.from(container.querySelectorAll('.bs-panel-title'));
    // Sanity: UIManager owns at least one titled panel still on the legacy
    // .bs-panel-title class (minimap).
    // Blast (P4), Contracts/Finances/Operations (P5), Fleet/Crew (P6),
    // Survey (P7), the event modal (P8, EventModal replacing EventDialog),
    // and Build/Settings (P10) migrated to the redesign's own title markup
    // and no longer count here — each surface-by-surface migration shrinks
    // this number further, same as it did when Blast moved off .bs-panel-title.
    expect(titleEls.length).toBeGreaterThanOrEqual(1);
    const before = titleEls.map((el) => el.textContent);

    clickFrenchButton(container);

    const after = titleEls.map((el) => el.textContent);
    for (let i = 0; i < titleEls.length; i++) {
      expect(after[i], `panel title #${i} ("${before[i]}") must change on locale switch`).not.toBe(before[i]);
    }
  });

  it('setLanguageChangeHandler(cb) still receives the new language after UIManager wires its own refresh', () => {
    uiManager = new UIManager(container);
    const cb = vi.fn();
    uiManager.setLanguageChangeHandler(cb);

    clickFrenchButton(container);

    expect(cb).toHaveBeenCalledWith('fr');
  });

  it('external setLanguageChangeHandler callback does not suppress UIManager\'s own panel refresh', () => {
    uiManager = new UIManager(container);
    uiManager.setLanguageChangeHandler(() => {});
    // Build (P10) moved off the legacy .bs-panel-title class onto the
    // shared bsx-root header — its title has no dedicated selector anymore
    // (same as Fleet/Contracts above), so check the whole panel's text.
    const buildPanel = container.querySelector('#bs-build-panel') as HTMLElement;
    expect(buildPanel.textContent).toContain(t('ui.build.title'));

    clickFrenchButton(container);

    expect(buildPanel.textContent).toContain(t('ui.build.title'));
    expect(buildPanel.textContent).not.toContain('Build');
  });

  it('calling refreshLocale() directly re-renders every owned panel title to the current locale', () => {
    uiManager = new UIManager(container);
    setLocale('fr');

    uiManager.refreshLocale();

    const buildPanel = container.querySelector('#bs-build-panel') as HTMLElement;
    expect(buildPanel.textContent).toContain(t('ui.build.title'));
    expect(buildPanel.textContent).not.toContain('Build');
  });
});

describe('UIManager — showEmployeeDetail (scene selection DETAIL/TRAIN, P2)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('opens the Crew panel', () => {
    uiManager = new UIManager(container);
    uiManager.showEmployeeDetail(3);
    const panel = container.querySelector('#bs-employee-panel') as HTMLElement;
    expect(panel.style.display).not.toBe('none');
  });

  it('expands the given employee\'s card in the Crew panel', () => {
    const expandSpy = vi.spyOn(CrewPanel.prototype, 'expandEmployee');
    uiManager = new UIManager(container);

    uiManager.showEmployeeDetail(3);

    expect(expandSpy).toHaveBeenCalledWith(3);
  });
});
