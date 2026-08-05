// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainMenu } from '../../../src/ui/MainMenu.js';
import { UIManager } from '../../../src/ui/UIManager.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';
import type { CampaignState } from '../../../src/core/campaign/Campaign.js';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import type { SaveBackend, SaveMeta } from '../../../src/core/state/SaveBackend.js';

function makeCampaign(): CampaignState {
  return {
    levels: {
      dusty_hollow: { unlocked: true, completed: true, bestSessionProfit: 160000 }, // > 80k threshold × 2
      grumpstone_ridge: { unlocked: true, completed: false, bestSessionProfit: 0 },
      treranium_depths: { unlocked: false, completed: false, bestSessionProfit: 0 },
    },
    currentLevelId: 'dusty_hollow',
    totalProfit: 160000,
  };
}

describe('MainMenu (12.8)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('is visible after show()', () => {
    const menu = new MainMenu(container);
    menu.show();
    expect(menu.visible).toBe(true);
    menu.dispose();
  });

  it('is hidden after hide()', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.hide();
    expect(menu.visible).toBe(false);
    menu.dispose();
  });

  it('calls onNewCampaign callback when button clicked', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    menu.setOnNewCampaign(cb);
    menu.show();
    const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes(t('menu.new_campaign')));
    btn?.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('calls onSettings callback when settings button clicked', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    menu.setOnSettings(cb);
    menu.show();
    // Find settings button by text content
    const buttons = Array.from(container.querySelectorAll('button'));
    const settingsBtn = buttons.find(b => b.textContent?.toLowerCase().includes('setting'));
    settingsBtn?.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('showWorldMap renders level cards', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // All 3 level names should appear in the rendered output
    const text = container.textContent ?? '';
    expect(text).toContain('Dusty Hollow');
    expect(text).toContain('Grumpstone Ridge');
    expect(text).toContain('Treranium Depths');
    menu.dispose();
  });

  it('showWorldMap shows locked indicator for locked level', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // Locked level should show 🔒
    expect(container.textContent).toContain('🔒');
    menu.dispose();
  });

  it('showWorldMap excludes tutorial_pit (difficultyTier 0) when campaign state provided', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeCampaign());
    const text = container.textContent ?? '';
    expect(text).not.toContain('Tutorial Pit');
    expect(text).toContain('Dusty Hollow');
    expect(text).toContain('Grumpstone Ridge');
    menu.dispose();
  });

  it('showWorldMap excludes tutorial_pit with null campaign', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(null);
    const text = container.textContent ?? '';
    expect(text).not.toContain('Tutorial Pit');
    expect(text).toContain('Dusty Hollow');
    menu.dispose();
  });

  it('showWorldMap shows stars for completed level', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // Completed level should show star characters
    expect(container.textContent).toMatch(/★/);
    menu.dispose();
  });

  it('calls onStartLevel when level start button clicked', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    menu.setOnStartLevel(cb);
    menu.show();
    menu.showWorldMap(makeCampaign());
    // Find Start/Resume buttons by text content (world map level buttons)
    const allBtns = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const startBtns = allBtns.filter(b =>
      b.textContent?.includes('Start') || b.textContent?.includes('Resume')
    );
    expect(startBtns.length).toBeGreaterThan(0);
    startBtns[0]?.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('dispose() removes overlay from container', () => {
    const menu = new MainMenu(container);
    menu.show();
    menu.dispose();
    expect(container.querySelector('#bs-main-menu')).toBeNull();
  });

  it('renders tutorial button with correct text', () => {
    const menu = new MainMenu(container);
    menu.show();
    const buttons = Array.from(container.querySelectorAll('button'));
    const tutorialBtn = buttons.find(b => b.textContent?.includes('Tutorial'));
    expect(tutorialBtn).not.toBeNull();
    expect(tutorialBtn).not.toBeUndefined();
    menu.dispose();
  });

  it('tutorial button shows a real step-count hint from TUTORIAL_STEPS', () => {
    const menu = new MainMenu(container);
    menu.show();
    const buttons = Array.from(container.querySelectorAll('button'));
    const tutorialBtn = buttons.find(b => b.textContent?.includes(t('menu.tutorial')))!;
    expect(tutorialBtn.textContent).toContain(String(TUTORIAL_STEPS.length));
    menu.dispose();
  });

  it('tutorial button calls onTutorial callback when clicked', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    menu.setOnTutorial(cb);
    menu.show();
    const buttons = Array.from(container.querySelectorAll('button'));
    const tutorialBtn = buttons.find(b => b.textContent?.includes('Tutorial'));
    tutorialBtn?.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('buttons follow the design order: Continue, New Campaign, Sandbox, Tutorial, Load, Settings', () => {
    const menu = new MainMenu(container);
    menu.show();
    const buttons = Array.from(container.querySelectorAll('button'));
    const idxContinue = buttons.findIndex(b => b.textContent?.includes(t('menu.continue')));
    const idxCampaign = buttons.findIndex(b => b.textContent?.includes(t('menu.new_campaign')));
    const idxSandbox = buttons.findIndex(b => b.textContent?.includes(t('menu.sandbox')));
    const idxTutorial = buttons.findIndex(b => b.textContent?.includes(t('menu.tutorial')));
    const idxLoad = buttons.findIndex(b => b.textContent?.includes(t('menu.load')));
    const idxSettings = buttons.findIndex(b => b.textContent?.includes(t('menu.settings')));
    expect(idxContinue).toBeLessThan(idxCampaign);
    expect(idxCampaign).toBeLessThan(idxSandbox);
    expect(idxSandbox).toBeLessThan(idxTutorial);
    expect(idxTutorial).toBeLessThan(idxLoad);
    expect(idxLoad).toBeLessThan(idxSettings);
    menu.dispose();
  });
});

// ── CONTINUE: live save summary from backend meta (redesign P8) ──────────────

function fakeBackend(saves: SaveMeta[]): SaveBackend {
  return {
    save: vi.fn(),
    load: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue(saves),
  };
}

describe('MainMenu — CONTINUE live save summary (redesign P8)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setLocale('en');
  });

  afterEach(() => {
    setLocale('en');
  });

  it('CONTINUE stays hidden until a backend is set', () => {
    const menu = new MainMenu(container);
    menu.show();
    const continueBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes(t('menu.continue')));
    expect(continueBtn?.style.display).toBe('none');
    menu.dispose();
  });

  it('CONTINUE stays hidden when the backend has no saves', async () => {
    const menu = new MainMenu(container);
    menu.setBackend(fakeBackend([]));
    await new Promise(r => setTimeout(r, 0));
    menu.show();
    const continueBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes(t('menu.continue')));
    expect(continueBtn?.style.display).toBe('none');
    menu.dispose();
  });

  it('CONTINUE shows the campaign level name and the real campaignSummary for the most recent save', async () => {
    const menu = new MainMenu(container);
    menu.setBackend(fakeBackend([
      { slotId: 'slot_1', name: 'Slot 1', timestamp: 1000, version: 7, campaignSummary: '$40,000 — Day 3', levelId: 'dusty_hollow' },
      { slotId: 'auto', name: 'Auto', timestamp: 5000, version: 7, campaignSummary: '$184,300 — Day 11', levelId: 'dusty_hollow' },
    ]));
    await new Promise(r => setTimeout(r, 0));
    menu.show();

    const text = container.textContent ?? '';
    expect(text).toContain(t('level.dusty_hollow.name'));
    expect(text).toContain('$184,300 — Day 11'); // the newer (timestamp 5000) save, not the older one
    expect(text).not.toContain('$40,000 — Day 3');
    menu.dispose();
  });

  it('CONTINUE falls back to the sandbox label when the most recent save has no levelId', async () => {
    const menu = new MainMenu(container);
    menu.setBackend(fakeBackend([
      { slotId: 'slot_1', name: 'Slot 1', timestamp: 1000, version: 7, campaignSummary: '$9,000 — Day 2', levelId: null },
    ]));
    await new Promise(r => setTimeout(r, 0));
    menu.show();

    const text = container.textContent ?? '';
    expect(text).toContain(t('menu.sandbox'));
    menu.dispose();
  });

  it('clicking CONTINUE routes to onContinue with the most recent save\'s slotId', async () => {
    const menu = new MainMenu(container);
    const cb = vi.fn();
    menu.setOnContinue(cb);
    menu.setBackend(fakeBackend([
      { slotId: 'slot_1', name: 'Slot 1', timestamp: 1000, version: 7, campaignSummary: '$9,000 — Day 2', levelId: 'dusty_hollow' },
      { slotId: 'slot_2', name: 'Slot 2', timestamp: 9000, version: 7, campaignSummary: '$20,000 — Day 5', levelId: 'dusty_hollow' },
    ]));
    await new Promise(r => setTimeout(r, 0));
    menu.show();

    const continueBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes(t('menu.continue')))!;
    continueBtn.click();
    expect(cb).toHaveBeenCalledWith('slot_2');
    menu.dispose();
  });

  it('LOAD button hints the real save count once resolved', async () => {
    const menu = new MainMenu(container);
    menu.setBackend(fakeBackend([
      { slotId: 'slot_1', name: 'Slot 1', timestamp: 1000, version: 7, campaignSummary: '', levelId: null },
      { slotId: 'slot_2', name: 'Slot 2', timestamp: 2000, version: 7, campaignSummary: '', levelId: null },
    ]));
    await new Promise(r => setTimeout(r, 0));
    menu.show();

    const loadBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes(t('menu.load')))!;
    expect(loadBtn.textContent).toContain('2');
    menu.dispose();
  });
});

// ── Bug 3: hardcoded English subtitle bypasses t() (issue #457) ───────────────

describe('MainMenu — subtitle goes through i18n (issue #457)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setLocale('en');
  });

  afterEach(() => {
    setLocale('en');
  });

  it('subtitle text matches t(\'menu.subtitle\') rather than a hardcoded literal', () => {
    const menu = new MainMenu(container);
    menu.show();
    // The known bug: subtitle.textContent = 'dig  ·  blast  ·  profit' is set
    // directly in the constructor, never going through t(). Once fixed, the
    // rendered text must equal t('menu.subtitle') for the active locale.
    const text = container.textContent ?? '';
    expect(text).toContain(t('menu.subtitle'));
    menu.dispose();
  });

  it('subtitle switches to the French translation when locale is fr', () => {
    setLocale('fr');
    const menu = new MainMenu(container);
    menu.show();
    const text = container.textContent ?? '';
    expect(text).toContain(t('menu.subtitle'));
    // The hardcoded English literal must not leak into the French render.
    expect(text).not.toContain('dig');
    expect(text).not.toContain('profit');
    menu.dispose();
    setLocale('en');
  });
});

// ── Bug 1: MainMenu re-renders after a language switch triggered from Settings (issue #457) ─

describe('MainMenu — refreshLocale() wired through UIManager\'s language handler (issue #457)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;
  let menu: MainMenu;

  beforeEach(() => {
    setLocale('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);
    menu = new MainMenu(container);
    // Same flow as src/main.ts: opening Settings from the main menu shows
    // UIManager's settings panel, and the language handler must also refresh
    // MainMenu — UIManager does not own MainMenu, so it cannot refresh it on
    // its own.
    menu.setOnSettings(() => uiManager.showPanel('settings'));
    uiManager.setLanguageChangeHandler(() => { menu.refreshLocale(); });
    menu.show();
  });

  afterEach(() => {
    menu.dispose();
    uiManager.dispose();
    container.remove();
    setLocale('en');
  });

  function openSettingsFromMainMenu(): void {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const settingsBtn = buttons.find((b) => b.textContent === t('menu.settings'));
    if (!settingsBtn) throw new Error('main menu Settings button not found');
    settingsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function clickFrenchButton(): void {
    const settingsPanel = container.querySelector('#bs-settings-panel');
    if (!settingsPanel) throw new Error('#bs-settings-panel not found');
    const frBtn = Array.from(settingsPanel.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent === t('ui.settings.french'));
    if (!frBtn) throw new Error('French language button not found');
    frBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it('main menu tagline switches to French after Settings → FR, opened via the main menu Settings button', () => {
    // The wordmark itself ("BLASTSIM 2026") is a brand lockup, not translated —
    // the tagline underneath it is the persistent, locale-bound text.
    const before = container.textContent ?? '';
    expect(before).toContain(t('menu.subtitle')); // English baseline

    openSettingsFromMainMenu();
    clickFrenchButton();

    expect(getLocale()).toBe('fr');
    const after = container.textContent ?? '';
    expect(after).toContain(t('menu.subtitle'));
    expect(after).not.toContain('dig');
  });

  it('main menu button labels (New Campaign, Continue, Load, Settings) switch to French', () => {
    const before = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).map((b) => b.textContent);

    openSettingsFromMainMenu();
    clickFrenchButton();

    const newCampaignBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent === t('menu.new_campaign'));
    expect(newCampaignBtn, 'New Campaign button must show the French label').toBeDefined();
    expect(before).not.toEqual(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).map((b) => b.textContent),
    );
  });
});

// ── menu.level_locked must not bake the English word "on" into a French render (issue #457) ─

describe('MainMenu — level_locked requirement text does not leak English (issue #457)', () => {
  let container: HTMLDivElement;

  function makeLockedCampaign(): CampaignState {
    return {
      levels: {
        dusty_hollow: { unlocked: true, completed: true, bestSessionProfit: 200000 },
        grumpstone_ridge: { unlocked: false, completed: false, bestSessionProfit: 0 },
        treranium_depths: { unlocked: false, completed: false, bestSessionProfit: 0 },
      },
      currentLevelId: 'dusty_hollow',
      totalProfit: 200000,
    };
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    setLocale('en');
  });

  it('locked-level requirement text in French does not contain the standalone English word "on"', () => {
    setLocale('fr');
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeLockedCampaign());

    const text = container.textContent ?? '';
    // MainMenu.ts currently builds the requirement string as
    // `$X on <level name>` in plain JS before ever reaching t(), so the
    // English word "on" survives regardless of locale. \b keeps this from
    // false-positiving on French words that merely contain the substring.
    expect(text).not.toMatch(/\bon\b/);

    menu.dispose();
  });

  it('locked-level requirement text in French still names the unlock threshold and the previous level', () => {
    setLocale('fr');
    const menu = new MainMenu(container);
    menu.show();
    menu.showWorldMap(makeLockedCampaign());

    const text = container.textContent ?? '';
    expect(text).toContain('250'); // Grumpstone Ridge's unlockThreshold is 250,000
    expect(text).toContain(t('level.dusty_hollow.name'));

    menu.dispose();
  });
});
