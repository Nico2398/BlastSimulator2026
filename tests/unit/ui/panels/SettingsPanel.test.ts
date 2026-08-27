// @vitest-environment jsdom
// BlastSimulator2026 — SettingsPanel (redesign P10)
//
// Includes the issue #457 regression coverage this file replaces
// (SettingsMenu.test.ts): a language switch made from Settings' own EN/FR
// buttons has to re-render every other already-constructed panel's static
// text, not just Settings' own — driven through a real UIManager, not
// setLocale() directly, so the assertions exercise the actual click path a
// player uses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UIManager } from '../../../../src/ui/UIManager.js';
import { SettingsPanel } from '../../../../src/ui/panels/SettingsPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { t, setLocale, getLocale } from '../../../../src/core/i18n/I18n.js';
import type { AudioManager, AudioCategory } from '../../../../src/audio/AudioManager.js';
import type { ConfirmModalConfig } from '../../../../src/ui/panels/ConfirmModal.js';
import type { SaveBackend, SaveMeta } from '../../../../src/core/state/SaveBackend.js';

/** Finds a button anywhere under `root` whose text matches `label` exactly. */
function findButtonByText(root: ParentNode, label: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button with text "${label}" found`);
  return btn;
}

/** True when `el` or any ancestor has an inline display:none — jsdom doesn't
 *  compute layout, so this walks the real .style property (not the
 *  serialized `style` attribute string, whose exact formatting jsdom is
 *  free to normalize differently from however it was set). */
function isHiddenByAncestor(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.style.display === 'none') return true;
    node = node.parentElement;
  }
  return false;
}

function mount(): { container: HTMLDivElement; panel: SettingsPanel } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, panel: new SettingsPanel(container) };
}

function fakeBackend(metas: SaveMeta[]): SaveBackend {
  return {
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => metas),
  };
}

/** jsdom has no Web Audio API — AudioManager's constructor calls `new
 *  AudioContext()` unconditionally, so a real instance can't be built here.
 *  SettingsPanel only ever calls getVolume/setVolume, so a plain object
 *  satisfying that shape (SettingsPanel imports the type only) stands in. */
function fakeAudioManager(initial: Partial<Record<'master' | AudioCategory, number>> = {}): AudioManager {
  const volumes: Record<string, number> = { master: 1, effects: 1, ambient: 1, ui: 1, ...initial };
  return {
    getVolume: (ch: string) => volumes[ch] ?? 1,
    setVolume: (ch: string, v: number) => { volumes[ch] = v; },
  } as unknown as AudioManager;
}

describe('SettingsPanel — language switch re-renders constructed panels (issue #457)', () => {
  let container: HTMLElement;
  let uiManager: UIManager;

  beforeEach(() => {
    setLocale('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);
  });

  afterEach(() => {
    uiManager.dispose();
    container.remove();
    setLocale('en');
  });

  function clickFrenchButton(): void {
    const settingsPanel = container.querySelector('#bs-settings-panel');
    if (!settingsPanel) throw new Error('#bs-settings-panel not found — was UIManager constructed?');
    const frBtn = findButtonByText(settingsPanel, t('ui.settings.french'));
    frBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it('clicking the FR button in the Settings UI switches the active locale', () => {
    clickFrenchButton();
    expect(getLocale()).toBe('fr');
  });

  it('clicking the FR button re-renders the BuildMenu title to French — without calling refreshLocale() or setLocale() directly', () => {
    // BuildMenu (P10) moved off the legacy .bs-panel-title class onto the
    // shared bsx-root header — its title has no dedicated selector anymore
    // (same as every other migrated panel), so check the whole panel's text.
    const buildPanel = container.querySelector('#bs-build-panel') as HTMLElement;
    expect(buildPanel.textContent).toContain(t('ui.build.title')); // English baseline

    clickFrenchButton();

    expect(getLocale()).toBe('fr');
    expect(buildPanel.textContent).toContain(t('ui.build.title'));
    expect(buildPanel.textContent).not.toContain('Build');
  });

  it('re-renders SettingsPanel\'s own title after its language button is clicked', () => {
    const settingsPanel = container.querySelector('#bs-settings-panel') as HTMLElement;
    const before = t('ui.settings.title'); // English baseline
    expect(settingsPanel.textContent).toContain(before);

    clickFrenchButton();

    expect(getLocale()).toBe('fr');
    expect(settingsPanel.textContent).toContain(t('ui.settings.title'));
    expect(settingsPanel.textContent).not.toContain(before);
  });

  it('switching back to EN after FR re-renders text back to English', () => {
    clickFrenchButton();
    const buildPanel = container.querySelector('#bs-build-panel') as HTMLElement;
    expect(buildPanel.textContent).toContain(t('ui.build.title')); // now French

    const settingsPanel = container.querySelector('#bs-settings-panel')!;
    const enBtn = findButtonByText(settingsPanel, t('ui.settings.english'));
    enBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(getLocale()).toBe('en');
    expect(buildPanel.textContent).toContain('Build');
  });
});

describe('SettingsPanel', () => {
  afterEach(() => { setLocale('en'); });

  it('carries a stable root id and is hidden by default', () => {
    const { container, panel } = mount();
    expect(container.querySelector('#bs-settings-panel')).not.toBeNull();
    expect(panel.visible).toBe(false);
    panel.dispose();
  });

  it('show/hide toggle visibility', () => {
    const { panel } = mount();
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
    panel.dispose();
  });

  it('the close button fires the close handler', () => {
    const { container, panel } = mount();
    let closed = false;
    panel.setCloseHandler(() => { closed = true; });
    (container.querySelector('#bs-settings-panel button') as HTMLButtonElement).click();
    expect(closed).toBe(true);
    panel.dispose();
  });

  describe('session controls — game-dependent visibility', () => {
    it('the session section is hidden before update() has ever seen a game', () => {
      const { container, panel } = mount();
      panel.show();
      const replayBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.replay_tutorial'));
      expect(replayBtn).toBeDefined();
      expect(isHiddenByAncestor(replayBtn!)).toBe(true);
      panel.dispose();
    });

    it('reveals once update() is called with a real state', () => {
      const { container, panel } = mount();
      panel.update(createGame({ seed: 1, mineType: 'desert' }));
      panel.show();
      const replayBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.replay_tutorial'));
      expect(replayBtn).toBeDefined();
      expect(isHiddenByAncestor(replayBtn!)).toBe(false);
      panel.dispose();
    });

    it('hides again once update() is called with null', () => {
      const { container, panel } = mount();
      panel.update(createGame({ seed: 1, mineType: 'desert' }));
      panel.update(null);
      panel.show();
      const replayBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.replay_tutorial'));
      expect(isHiddenByAncestor(replayBtn!)).toBe(true);
      panel.dispose();
    });
  });

  describe('audio', () => {
    it('setAudioManager seeds every slider from the AudioManager volume', () => {
      const { container, panel } = mount();
      const mgr = fakeAudioManager({ master: 0.5, effects: 0.25 });
      panel.setAudioManager(mgr);
      panel.show();

      const sliders = Array.from(container.querySelectorAll('input[type="range"]')) as HTMLInputElement[];
      expect(sliders).toHaveLength(4);
      expect(sliders[0]!.value).toBe('50'); // master
      expect(sliders[1]!.value).toBe('25'); // effects
      panel.dispose();
    });

    it('dragging a slider calls AudioManager.setVolume for that channel', () => {
      const { container, panel } = mount();
      const mgr = fakeAudioManager();
      panel.setAudioManager(mgr);
      panel.show();

      const sliders = Array.from(container.querySelectorAll('input[type="range"]')) as HTMLInputElement[];
      sliders[2]!.value = '10'; // ambient
      sliders[2]!.dispatchEvent(new Event('input'));

      expect(mgr.getVolume('ambient')).toBeCloseTo(0.1);
      panel.dispose();
    });
  });

  describe('session actions', () => {
    it('REPLAY TUTORIAL closes the panel and fires the replay handler', () => {
      const { container, panel } = mount();
      panel.update(createGame({ seed: 1, mineType: 'desert' }));
      panel.show();
      let closed = false;
      let replayed = false;
      panel.setCloseHandler(() => { closed = true; });
      panel.setReplayTutorialHandler(() => { replayed = true; });

      const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.replay_tutorial'))!;
      btn.click();

      expect(closed).toBe(true);
      expect(replayed).toBe(true);
      panel.dispose();
    });

    it('SAVE & LOAD closes the panel and fires the open-saves handler', () => {
      const { container, panel } = mount();
      panel.update(createGame({ seed: 1, mineType: 'desert' }));
      panel.show();
      let closed = false;
      let opened = false;
      panel.setCloseHandler(() => { closed = true; });
      panel.setOpenSavesHandler(() => { opened = true; });

      const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.save_and_load'))!;
      btn.click();

      expect(closed).toBe(true);
      expect(opened).toBe(true);
      panel.dispose();
    });

    it('RETURN TO MAIN MENU requests a confirm rather than acting immediately', () => {
      const { container, panel } = mount();
      panel.update(createGame({ seed: 1, mineType: 'desert' }));
      panel.show();
      let returned = false;
      panel.setConfirmHandler(() => {});
      panel.setReturnToMenuHandler(() => { returned = true; });

      const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.return_to_menu'))!;
      btn.click();

      expect(returned).toBe(false);
      panel.dispose();
    });

    it('the return confirm body states the real autosave age when one exists', async () => {
      const { panel } = mount();
      const state = createGame({ seed: 1, mineType: 'desert' });
      panel.update(state);
      panel.setGetState(() => state);
      panel.setBackend(fakeBackend([
        { slotId: 'auto', name: 'Auto', timestamp: Date.now() - 5 * 60_000, version: 1, campaignSummary: '', levelId: null },
      ]));
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      const btn = Array.from(panel.root.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.return_to_menu'))!;
      btn.click();
      await vi.waitFor(() => { if (!requested) throw new Error('confirm not requested yet'); });

      expect(requested).not.toBeNull();
      expect(requested!.body).not.toBe(t('ui.settings.return_confirm_body_none'));
      panel.dispose();
    });

    it('the return confirm body warns generically when there is no autosave yet', async () => {
      const { panel } = mount();
      const state = createGame({ seed: 1, mineType: 'desert' });
      panel.update(state);
      panel.setGetState(() => state);
      panel.setBackend(fakeBackend([]));
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      const btn = Array.from(panel.root.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.return_to_menu'))!;
      btn.click();
      await vi.waitFor(() => { if (!requested) throw new Error('confirm not requested yet'); });

      expect(requested!.body).toBe(t('ui.settings.return_confirm_body_none'));
      panel.dispose();
    });

    it('confirming RETURN TO MAIN MENU closes the panel and fires the return handler', async () => {
      const { panel } = mount();
      const state = createGame({ seed: 1, mineType: 'desert' });
      panel.update(state);
      panel.setGetState(() => state);
      panel.setBackend(fakeBackend([]));
      panel.show();

      let closed = false;
      let returned = false;
      panel.setCloseHandler(() => { closed = true; });
      panel.setReturnToMenuHandler(() => { returned = true; });
      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });

      const btn = Array.from(panel.root.querySelectorAll('button')).find(b => b.textContent === t('ui.settings.return_to_menu'))!;
      btn.click();
      await vi.waitFor(() => { if (!requested) throw new Error('confirm not requested yet'); });

      requested!.onConfirm();
      expect(closed).toBe(true);
      expect(returned).toBe(true);
      panel.dispose();
    });
  });

  it('a locale refresh re-renders static chrome', () => {
    const { container, panel } = mount();
    panel.show();
    expect(container.textContent).toContain(t('ui.settings.title'));

    setLocale('fr');
    panel.refreshLocale();

    expect(container.textContent).toContain(t('ui.settings.title'));
    setLocale('en');
  });

  it('dispose removes the panel from the DOM', () => {
    const { container, panel } = mount();
    panel.dispose();
    expect(container.querySelector('#bs-settings-panel')).toBeNull();
  });
});

// ── Language pill initial state and sync (#492 section 2) ────────────────────
// SettingsPanel's own EN/FR pill pair sets its initial `active` class through
// a constructor-local closure (setLangPills(getLocale())), so construction
// already tracks the real locale. What's broken is refreshLocale() -> its
// private updateLangPills() is currently a no-op stub, so the pills go stale
// the moment the locale changes anywhere else (e.g. from MainMenu's own
// toggle) while this panel instance is still alive.

describe('SettingsPanel — language pill initial state and sync (#492 section 2)', () => {
  afterEach(() => { setLocale('en'); });

  function langPills(panel: SettingsPanel): { enPill: HTMLButtonElement; frPill: HTMLButtonElement } {
    const enPill = panel.root.querySelector<HTMLButtonElement>('[data-lang="en"]');
    const frPill = panel.root.querySelector<HTMLButtonElement>('[data-lang="fr"]');
    if (!enPill || !frPill) throw new Error('SettingsPanel language pills not found');
    return { enPill, frPill };
  }

  it('EN pill is active on construction when the locale defaults to en', () => {
    const { panel } = mount();
    const { enPill, frPill } = langPills(panel);
    expect(enPill.classList.contains('active')).toBe(true);
    expect(frPill.classList.contains('active')).toBe(false);
    panel.dispose();
  });

  it('FR pill is active on construction when the locale is already fr — initial state tracks the real current locale, not hardcoded EN', () => {
    setLocale('fr');
    const { panel } = mount();
    const { enPill, frPill } = langPills(panel);
    expect(frPill.classList.contains('active')).toBe(true);
    expect(enPill.classList.contains('active')).toBe(false);
    panel.dispose();
  });

  it('stays in sync with a locale change made elsewhere once refreshLocale() runs', () => {
    const { panel } = mount();
    // Locale changed by some other code path (e.g. MainMenu's own toggle),
    // then this already-open panel is told to refresh.
    setLocale('fr');
    panel.refreshLocale();

    const { enPill, frPill } = langPills(panel);
    expect(frPill.classList.contains('active')).toBe(true);
    expect(enPill.classList.contains('active')).toBe(false);
    panel.dispose();
  });
});
