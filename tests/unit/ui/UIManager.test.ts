// @vitest-environment jsdom
// BlastSimulator2026 — UIManager NavGrid overlay wiring (issue #407)
//
// Regression coverage: UIManager never fed the live NavGrid into the MiniMap,
// and toggleNavGridOverlay() was an empty stub, so there was no player-facing
// way to see the nav-grid overlay even though MiniMap's drawing code was correct.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';
import { MiniMap } from '../../../src/ui/MiniMap.js';
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

  it('toolbar button captions switch language after clicking FR in Settings', () => {
    uiManager = new UIManager(container);
    const blastToolbarBtn = container.querySelector<HTMLButtonElement>(
      '.bs-toolbar-btn[data-panel="blast"]',
    );
    expect(blastToolbarBtn?.textContent).toBe('💣 ' + t('ui.toolbar.blast'));

    clickFrenchButton(container);

    expect(getLocale()).toBe('fr');
    expect(blastToolbarBtn?.textContent).toBe('💣 ' + t('ui.toolbar.blast'));
    expect(blastToolbarBtn?.textContent).not.toContain('Blast');
  });

  it('every toolbar button caption switches language, not just one', () => {
    uiManager = new UIManager(container);
    const panelKeys: [string, string][] = [
      ['blast', 'ui.toolbar.blast'],
      ['contracts', 'ui.toolbar.contracts'],
      ['build', 'ui.toolbar.build'],
      ['vehicles', 'ui.toolbar.vehicles'],
      ['employees', 'ui.toolbar.employees'],
      ['survey', 'ui.toolbar.survey'],
      ['settings', 'ui.toolbar.settings'],
    ];
    const before = panelKeys.map(([panel]) =>
      container.querySelector<HTMLButtonElement>(`.bs-toolbar-btn[data-panel="${panel}"]`)?.textContent,
    );

    clickFrenchButton(container);

    for (let i = 0; i < panelKeys.length; i++) {
      const [panel, key] = panelKeys[i]!;
      const btn = container.querySelector<HTMLButtonElement>(`.bs-toolbar-btn[data-panel="${panel}"]`);
      expect(btn?.textContent, `toolbar button "${panel}" must switch language`).not.toBe(before[i]);
      expect(btn?.textContent?.endsWith(t(key)), `toolbar button "${panel}" must show the French translation`).toBe(true);
    }
  });

  it('the currently shown panel\'s static title switches language', () => {
    uiManager = new UIManager(container);
    uiManager.showPanel('vehicles');
    const title = container.querySelector('#bs-vehicle-panel .bs-panel-title');
    expect(title?.textContent).toBe(t('ui.vehicles.title')); // English baseline

    clickFrenchButton(container);

    expect(title?.textContent).toBe(t('ui.vehicles.title'));
    expect(title?.textContent).not.toBe('Vehicles');
  });

  it('every owned panel with a .bs-panel-title re-renders to a different string after the switch', () => {
    uiManager = new UIManager(container);
    const titleEls = Array.from(container.querySelectorAll('.bs-panel-title'));
    // Sanity: UIManager owns several titled panels (blast, contracts, build,
    // vehicles, employees, survey, settings, minimap, event dialog).
    expect(titleEls.length).toBeGreaterThanOrEqual(8);
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
    const buildTitle = container.querySelector('#bs-build-panel .bs-panel-title');
    const before = buildTitle?.textContent;

    clickFrenchButton(container);

    expect(buildTitle?.textContent).not.toBe(before);
    expect(buildTitle?.textContent).toBe(t('ui.build.title'));
  });

  it('calling refreshLocale() directly re-renders every owned panel title to the current locale', () => {
    uiManager = new UIManager(container);
    setLocale('fr');

    uiManager.refreshLocale();

    const buildTitle = container.querySelector('#bs-build-panel .bs-panel-title');
    expect(buildTitle?.textContent).toBe(t('ui.build.title'));
    expect(buildTitle?.textContent).not.toBe('Build');
  });
});
