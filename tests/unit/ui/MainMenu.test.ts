// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainMenu } from '../../../src/ui/MainMenu.js';
import { UIManager } from '../../../src/ui/UIManager.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';
import type { CampaignState } from '../../../src/core/campaign/Campaign.js';

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
    // Find the New Campaign button (first primary button)
    const btn = container.querySelector('.bs-btn-primary') as HTMLButtonElement | null;
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

  it('makeReturnToMapButton creates a button with click handler', () => {
    const cb = vi.fn();
    const menu = new MainMenu(container);
    const btn = menu.makeReturnToMapButton(document.body, cb);
    btn.click();
    expect(cb).toHaveBeenCalledOnce();
    menu.dispose();
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

  it('tutorial button has gold accent inline style', () => {
    const menu = new MainMenu(container);
    menu.show();
    const buttons = Array.from(container.querySelectorAll('button'));
    const tutorialBtn = buttons.find(b => b.textContent?.includes('Tutorial'))!;
    expect(tutorialBtn.style.color).toBe('rgb(255, 224, 144)');
    expect(tutorialBtn.style.borderColor).toContain('rgba');
    expect(tutorialBtn.style.borderColor).toContain('255, 225, 144');
    expect(tutorialBtn.style.background).toContain('rgba');
    expect(tutorialBtn.style.background).toContain('255, 225, 144');
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

  it('tutorial button is ordered between New Campaign and Continue', () => {
    const menu = new MainMenu(container);
    menu.show();
    const buttons = Array.from(container.querySelectorAll('button'));
    const idxCampaign = buttons.findIndex(b => b.textContent?.includes('New Campaign'));
    const idxTutorial = buttons.findIndex(b => b.textContent?.includes('Tutorial'));
    const idxContinue = buttons.findIndex(b => b.textContent?.includes('Continue'));
    expect(idxCampaign).toBeLessThan(idxTutorial);
    expect(idxTutorial).toBeLessThan(idxContinue);
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

  it('main menu title switches to French after Settings → FR, opened via the main menu Settings button', () => {
    const titleEl = container.querySelector('#bs-main-menu h1');
    expect(titleEl?.textContent).toBe(t('menu.title')); // English baseline

    openSettingsFromMainMenu();
    clickFrenchButton();

    expect(getLocale()).toBe('fr');
    expect(titleEl?.textContent).toBe(t('menu.title'));
    expect(titleEl?.textContent).not.toBe('BlastSimulator2026');
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
