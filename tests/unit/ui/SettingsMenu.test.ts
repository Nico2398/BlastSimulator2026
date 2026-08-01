// @vitest-environment jsdom
// BlastSimulator2026 — Locale switch never re-renders already-constructed UI (issue #457, bug 1)
//
// SettingsMenu.setLanguageChangeHandler(cb) has always existed and is wired to
// its own EN/FR buttons, but nothing in the app called it — so setLocale() ran
// on click, yet every panel already on screen kept showing whatever locale was
// active when its constructor called t(). These tests drive the real DOM
// button a player would click (not setLocale() directly) and assert that
// constructor-baked static text on OTHER panels — not just SettingsMenu's own
// — updates to the newly active locale's translation, re-evaluated via t() so
// the assertions survive content changes to en.json/fr.json.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';

/** Finds a button anywhere under `root` whose text matches `label` exactly. */
function findButtonByText(root: ParentNode, label: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button with text "${label}" found`);
  return btn;
}

/** Clicks the Settings panel's French language button the way a player would. */
function clickFrenchButton(container: HTMLElement): void {
  const settingsPanel = container.querySelector('#bs-settings-panel');
  if (!settingsPanel) throw new Error('#bs-settings-panel not found — was UIManager constructed?');
  // 'Français' is byte-identical in en.json and fr.json (a proper noun), so the
  // label reads the same regardless of which locale is active at click time.
  const frBtn = findButtonByText(settingsPanel, t('ui.settings.french'));
  frBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('SettingsMenu — language button re-renders constructed panels (issue #457)', () => {
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

  it('BuildMenu title is baked in English at construction time', () => {
    const buildTitle = container.querySelector('#bs-build-panel .bs-panel-title');
    expect(buildTitle?.textContent).toBe(t('ui.build.title'));
  });

  it('clicking the FR button in the Settings UI switches the active locale', () => {
    clickFrenchButton(container);
    expect(getLocale()).toBe('fr');
  });

  it('clicking the FR button re-renders the BuildMenu title to French — without calling refreshLocale() or setLocale() directly', () => {
    const buildTitleEl = container.querySelector('#bs-build-panel .bs-panel-title');
    expect(buildTitleEl?.textContent).toBe(t('ui.build.title')); // English baseline

    clickFrenchButton(container);

    // Re-evaluate t() now that the locale has actually switched, rather than
    // hardcoding the French string, so this test survives translation edits.
    expect(getLocale()).toBe('fr');
    expect(buildTitleEl?.textContent).toBe(t('ui.build.title'));
    expect(buildTitleEl?.textContent).not.toBe('Build');
  });

  it('re-renders BuildMenu even while the panel is hidden (never shown)', () => {
    // BuildMenu starts hidden (display:none) and is never shown in this test —
    // the bug is that already-constructed text never refreshes, whether or not
    // the panel happens to be visible when the language changes.
    const buildEl = container.querySelector('#bs-build-panel') as HTMLElement;
    expect(buildEl.style.display).toBe('none');
    clickFrenchButton(container);
    const buildTitleEl = container.querySelector('#bs-build-panel .bs-panel-title');
    expect(buildTitleEl?.textContent).toBe(t('ui.build.title'));
  });

  it('re-renders the BuildMenu close button text to French', () => {
    const buildPanel = container.querySelector('#bs-build-panel')!;
    const closeBtn = buildPanel.lastElementChild as HTMLButtonElement;
    expect(closeBtn.textContent).toBe(t('ui.build.close')); // English baseline

    clickFrenchButton(container);

    expect(closeBtn.textContent).toBe(t('ui.build.close'));
    expect(closeBtn.textContent).not.toBe('Close');
  });

  it('re-renders SettingsMenu\'s own title after its language button is clicked', () => {
    const settingsTitle = container.querySelector('#bs-settings-panel .bs-panel-title');
    expect(settingsTitle?.textContent).toBe(t('ui.settings.title'));

    clickFrenchButton(container);

    expect(settingsTitle?.textContent).toBe(t('ui.settings.title'));
    expect(settingsTitle?.textContent).not.toBe('Settings');
  });

  it('switching back to EN after FR re-renders text back to English', () => {
    clickFrenchButton(container);
    const buildTitleEl = container.querySelector('#bs-build-panel .bs-panel-title');
    expect(buildTitleEl?.textContent).toBe(t('ui.build.title')); // now French

    const settingsPanel = container.querySelector('#bs-settings-panel')!;
    const enBtn = findButtonByText(settingsPanel, t('ui.settings.english'));
    enBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(getLocale()).toBe('en');
    expect(buildTitleEl?.textContent).toBe('Build');
  });
});
