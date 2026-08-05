// BlastSimulator2026 — Main Menu screen (redesign P8)
// Wordmark, CONTINUE with a live save summary, five secondary buttons, an
// EN/FR toggle, version, and a flavor ticker. The World Map ("the Portfolio")
// used to render inline here — it's now its own sibling screen, WorldMap.ts.

import { t, setLocale, getLocale } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import { el } from './dom.js';
import { iconEl, type IconName } from './icons.js';
import { getLevel } from '../core/campaign/Level.js';
import type { SaveBackend, SaveMeta } from '../core/state/SaveBackend.js';
import { TUTORIAL_STEPS } from './tutorialSteps.js';

export type OnNewCampaign = () => void;
export type OnContinue = (slotId: string) => void;
export type OnLoad = () => void;
export type OnSettings = () => void;
export type OnTutorial = () => void;
export type OnSandbox = () => void;
export type OnLanguageChange = (lang: string) => void;

/** Tracks package.json — bump alongside it. No build-time wiring; this is display-only. */
const APP_VERSION = '0.1.0';

export class MainMenu {
  private readonly overlay: HTMLElement;
  private readonly continueBtn: HTMLElement;
  private readonly continueSummaryEl: HTMLElement;
  private readonly loadHintEl: HTMLElement;
  private readonly enPill: HTMLElement;
  private readonly frPill: HTMLElement;
  private readonly tickerEl: HTMLElement;

  private onNewCampaign?: OnNewCampaign;
  private onContinue?: OnContinue;
  private onLoad?: OnLoad;
  private onSettings?: OnSettings;
  private onTutorial?: OnTutorial;
  private onSandbox?: OnSandbox;
  private onLanguageChange?: OnLanguageChange;

  private backend: SaveBackend | null = null;
  private mostRecentSave: SaveMeta | null = null;
  private saveCount = 0;
  private tickerTimer: ReturnType<typeof setInterval> | null = null;
  private tickerIndex = 0;

  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.overlay = el('div', { attrs: {
      style: 'position:fixed;inset:0;z-index:var(--bsx-z-menu);display:flex;flex-direction:column;'
        + 'background:radial-gradient(120% 110% at 72% 46%, rgba(255,176,46,.09), rgba(0,0,0,0) 62%),'
        + 'linear-gradient(90deg, rgba(6,8,11,.96) 0%, rgba(6,8,11,.86) 42%, rgba(6,8,11,.3) 100%),'
        + 'repeating-linear-gradient(135deg,#181d24 0 13px,#131820 13px 26px)',
    } });
    this.overlay.id = 'bs-main-menu';

    const body = el('div', { attrs: { style: 'flex:1;display:flex;align-items:center;padding-left:76px' } });

    // ── Menu box: wordmark + button column + locale/version row ──
    const menuBox = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:26px;width:520px' } });

    const wordmark = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:9px' } });
    const wordmarkRow = el('div', { attrs: { style: 'display:flex;align-items:flex-end;gap:11px' } });
    const wordmarkMain = el('span', { attrs: { style: 'font:900 52px/.86 var(--bsx-font-ui);letter-spacing:-.03em;color:#f2f4f7' } });
    wordmarkMain.append('BLAST', el('span', { text: 'SIM', attrs: { style: 'color:var(--bsx-amber)' } }));
    const wordmarkYear = el('span', { text: '2026', attrs: { style: 'font:800 30px/1 var(--bsx-font-mono);color:rgba(255,255,255,.22);letter-spacing:-.02em' } });
    wordmarkRow.append(wordmarkMain, wordmarkYear);
    const taglineRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:11px' } });
    const taglineBar = el('span', { attrs: { style: 'height:2px;width:34px;background:var(--bsx-amber)' } });
    const taglineText = el('span', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.42em;text-transform:uppercase;color:var(--bsx-text-muted)' } });
    this.locale.bindText(taglineText, 'menu.subtitle');
    taglineRow.append(taglineBar, taglineText);
    wordmark.append(wordmarkRow, taglineRow);

    // ── Buttons ──
    const buttonCol = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:7px;width:340px' } });

    const continueLabel = el('span', { attrs: { style: 'font:800 13px/1 var(--bsx-font-ui);letter-spacing:.16em;text-transform:uppercase' } });
    this.locale.bindText(continueLabel, 'menu.continue');
    this.continueSummaryEl = el('span', { attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);opacity:.72' } });
    this.continueBtn = el('button', {
      className: 'bsx-menu-btn-continue',
      attrs: { style: 'display:none' },
      children: [
        iconEl('play', 18),
        el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px' }, children: [continueLabel, this.continueSummaryEl] }),
      ],
    });
    this.continueBtn.addEventListener('click', () => {
      if (this.mostRecentSave) this.onContinue?.(this.mostRecentSave.slotId);
    });

    const newCampaignBtn = this.makeMenuButton('blast', 'menu.new_campaign', () => this.onNewCampaign?.());
    // Stable id (same convention as bs-menu-sandbox below) — scenario defs
    // click this to reach the world map; `.bsx-menu-btn` alone is shared by
    // every menu button and would resolve to whichever renders first in DOM
    // order (#471 CI: main-menu-visual/loading-screen-visual both timed out
    // on the pre-redesign `.bs-btn-primary` selector this replaces).
    newCampaignBtn.el.id = 'bs-menu-new-campaign';
    const sandboxBtn = this.makeMenuButton('wrench', 'menu.sandbox', () => this.onSandbox?.());
    sandboxBtn.el.id = 'bs-menu-sandbox';
    const tutorialBtn = this.makeMenuButton('training', 'menu.tutorial', () => this.onTutorial?.());
    this.locale.bindText(tutorialBtn.hintEl, 'ui.menu.hint_steps', { n: TUTORIAL_STEPS.length });
    const loadBtn = this.makeMenuButton('save', 'menu.load', () => this.onLoad?.());
    this.loadHintEl = loadBtn.hintEl;
    const settingsBtn = this.makeMenuButton('settings', 'menu.settings', () => this.onSettings?.());

    buttonCol.append(this.continueBtn, newCampaignBtn.el, sandboxBtn.el, tutorialBtn.el, loadBtn.el, settingsBtn.el);

    // ── Locale/version row ──
    const localeRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:12px' } });
    const langGroup = el('div', { attrs: { style: 'display:flex;gap:2px;padding:2px;border-radius:4px;background:rgba(255,255,255,.05)' } });
    this.enPill = el('button', { className: 'bsx-menu-lang-pill', text: 'EN' });
    this.enPill.addEventListener('click', () => this.switchLanguage('en'));
    this.frPill = el('button', { className: 'bsx-menu-lang-pill', text: 'FR' });
    this.frPill.addEventListener('click', () => this.switchLanguage('fr'));
    langGroup.append(this.enPill, this.frPill);
    const versionEl = el('span', { attrs: { style: 'font:400 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } });
    this.locale.bindText(versionEl, 'ui.menu.version', { version: APP_VERSION });
    localeRow.append(langGroup, versionEl);

    menuBox.append(wordmark, buttonCol, localeRow);
    body.append(menuBox);

    // ── Bottom ticker ──
    const ticker = el('div', { attrs: {
      style: 'height:34px;padding:0 76px;display:flex;align-items:center;gap:9px;white-space:nowrap;'
        + 'background:rgba(6,8,11,.72);border-top:1px solid rgba(255,255,255,.06)',
    } });
    const tickerDot = el('span', { attrs: { style: 'width:5px;height:5px;border-radius:50%;background:var(--bsx-amber);flex:0 0 auto' } });
    this.tickerEl = el('span', { attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);letter-spacing:.06em;color:var(--bsx-text-muted)' } });
    ticker.append(tickerDot, this.tickerEl);

    this.overlay.append(body, ticker);
    container.appendChild(this.overlay);
  }

  setBackend(backend: SaveBackend): void {
    this.backend = backend;
    void this.refreshContinueSummary();
  }

  setOnNewCampaign(fn: OnNewCampaign): void { this.onNewCampaign = fn; }
  setOnContinue(fn: OnContinue): void { this.onContinue = fn; }
  setOnLoad(fn: OnLoad): void { this.onLoad = fn; }
  setOnSettings(fn: OnSettings): void { this.onSettings = fn; }
  setOnTutorial(fn: OnTutorial): void { this.onTutorial = fn; }
  setOnSandbox(fn: OnSandbox): void { this.onSandbox = fn; }
  setOnLanguageChange(fn: OnLanguageChange): void { this.onLanguageChange = fn; }

  show(): void {
    this.overlay.style.display = 'flex';
    this.startTicker();
  }
  hide(): void {
    this.overlay.style.display = 'none';
    this.stopTicker();
  }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Re-render locale-dependent text (wordmark tagline, buttons, ticker) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    this.updateLangPills();
    this.updateContinueButton();
    this.updateLoadHint();
    this.updateTickerText();
  }

  dispose(): void {
    this.stopTicker();
    this.overlay.remove();
  }

  private makeMenuButton(icon: IconName, labelKey: string, onClick: () => void): { el: HTMLButtonElement; hintEl: HTMLElement } {
    const label = el('span', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.16em;text-transform:uppercase' } });
    this.locale.bindText(label, labelKey);
    const hint = el('span', { attrs: { style: 'margin-left:auto;font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-disabled)' } });
    const btn = el('button', { className: 'bsx-menu-btn', children: [iconEl(icon, 16), label, hint] });
    btn.addEventListener('click', onClick);
    return { el: btn, hintEl: hint };
  }

  private switchLanguage(lang: 'en' | 'fr'): void {
    setLocale(lang);
    this.refreshLocale();
    this.onLanguageChange?.(lang);
  }

  private updateLangPills(): void {
    const active = getLocale();
    this.enPill.classList.toggle('active', active === 'en');
    this.frPill.classList.toggle('active', active === 'fr');
  }

  private async refreshContinueSummary(): Promise<void> {
    if (!this.backend) return;
    const metas = await this.backend.list();
    this.saveCount = metas.length;
    this.mostRecentSave = metas.reduce<SaveMeta | null>(
      (best, m) => (!best || m.timestamp > best.timestamp) ? m : best,
      null,
    );
    this.updateContinueButton();
    this.updateLoadHint();
  }

  private updateContinueButton(): void {
    const meta = this.mostRecentSave;
    if (!meta) { this.continueBtn.style.display = 'none'; return; }
    this.continueBtn.style.display = 'flex';
    const level = meta.levelId ? getLevel(meta.levelId) : null;
    const label = level ? t(level.nameKey) : t('menu.sandbox');
    this.continueSummaryEl.textContent = `${label} · ${meta.campaignSummary}`;
  }

  private updateLoadHint(): void {
    this.loadHintEl.textContent = this.saveCount > 0 ? t('ui.menu.hint_saves', { n: this.saveCount }) : '';
  }

  private startTicker(): void {
    this.stopTicker();
    this.tickerIndex = 0;
    this.updateTickerText();
    this.tickerTimer = setInterval(() => {
      this.tickerIndex++;
      this.updateTickerText();
    }, 6000);
  }

  private stopTicker(): void {
    if (this.tickerTimer !== null) { clearInterval(this.tickerTimer); this.tickerTimer = null; }
  }

  private updateTickerText(): void {
    const keys = ['ui.menu.ticker_1', 'ui.menu.ticker_2', 'ui.menu.ticker_3'];
    this.tickerEl.textContent = t(keys[this.tickerIndex % keys.length]!);
  }
}
