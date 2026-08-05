// BlastSimulator2026 — Main Menu and World Map Screen (redesign P8)
// Main menu reskinned to the Screens design comp: wordmark, CONTINUE with a
// live save summary, five secondary buttons, an EN/FR toggle, version, and a
// flavor ticker. World map ("the Portfolio") is unchanged in this pass — it
// still renders inline via showWorldMap(), same as before the reskin; its own
// rebuild is a separate, later piece of P8.

import { t, setLocale, getLocale } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import { el } from './dom.js';
import { iconEl, type IconName } from './icons.js';
import type { CampaignState } from '../core/campaign/Campaign.js';
import { getAllLevels, getLevel } from '../core/campaign/Level.js';
import type { SaveBackend, SaveMeta } from '../core/state/SaveBackend.js';
import { TUTORIAL_STEPS } from './tutorialSteps.js';

export type OnNewCampaign = () => void;
export type OnStartLevel = (levelId: string) => void;
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
  private readonly menuBox: HTMLElement;
  private readonly worldMapBox: HTMLElement;
  private readonly continueBtn: HTMLElement;
  private readonly continueSummaryEl: HTMLElement;
  private readonly loadHintEl: HTMLElement;
  private readonly enPill: HTMLElement;
  private readonly frPill: HTMLElement;
  private readonly tickerEl: HTMLElement;

  private onNewCampaign?: OnNewCampaign;
  private onStartLevel?: OnStartLevel;
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

  /** Campaign last passed to showWorldMap, so a locale switch can redraw it. */
  private lastCampaign: CampaignState | null = null;
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
    this.menuBox = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:26px;width:520px' } });

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

    this.menuBox.append(wordmark, buttonCol, localeRow);

    // ── World map box (hidden initially) ──
    this.worldMapBox = document.createElement('div');
    this.worldMapBox.style.cssText = [
      'display:none;flex-direction:column;gap:8px;min-width:340px;max-width:520px',
      'background:rgba(8,6,3,0.85);border:1px solid rgba(200,160,60,0.25)',
      'border-radius:12px;padding:20px 24px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.6)',
      'max-height:80vh;overflow-y:auto',
    ].join(';');

    body.append(this.menuBox, this.worldMapBox);

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
  setOnStartLevel(fn: OnStartLevel): void { this.onStartLevel = fn; }
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

  /** Re-render locale-dependent text (title, subtitle, menu/world-map buttons) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    this.updateLangPills();
    this.updateContinueButton();
    this.updateLoadHint();
    this.updateTickerText();
    // The world map is built once per open, so redraw it when it is on screen.
    if (this.worldMapBox.style.display !== 'none') this.showWorldMap(this.lastCampaign);
  }

  /** Show the world map with campaign progress. */
  showWorldMap(campaign: CampaignState | null): void {
    this.lastCampaign = campaign;
    this.menuBox.style.display = 'none';
    this.worldMapBox.style.display = 'flex';
    this.worldMapBox.innerHTML = '';

    const mapTitle = document.createElement('div');
    mapTitle.style.cssText = [
      'font-weight:700;font-size:12px;letter-spacing:0.06em;text-transform:uppercase',
      'color:#ffc840;margin-bottom:4px;border-bottom:1px solid rgba(200,160,60,0.25)',
      'padding-bottom:8px',
    ].join(';');
    mapTitle.textContent = t('menu.world_map');

    this.worldMapBox.appendChild(mapTitle);

    const levels = getAllLevels().filter(l => l.difficultyTier > 0);
    for (const lvl of levels) {
      const prog = campaign?.levels[lvl.id];
      const unlocked = prog?.unlocked ?? (lvl.difficultyTier === 1);
      const completed = prog?.completed ?? false;
      const profit = prog?.bestSessionProfit ?? 0;

      const card = document.createElement('div');
      card.style.cssText = [
        'padding:12px 14px;border-radius:8px;',
        'border:1px solid ',
        unlocked ? 'rgba(200,160,60,0.2);background:rgba(255,255,255,0.03)' : 'rgba(80,60,30,0.2);background:transparent;opacity:0.55',
      ].join('');

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';

      const name = document.createElement('div');
      name.style.cssText = 'font-size:14px;color:#d0b060;font-weight:700';
      name.textContent = t(lvl.nameKey);

      const stars = document.createElement('div');
      stars.style.cssText = 'font-size:14px';
      stars.textContent = completed
        ? this.starsForProfit(profit, lvl.unlockThreshold)
        : (unlocked ? '☆☆☆' : '🔒');

      nameRow.append(name, stars);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:11px;color:#6a5030;margin:2px 0 4px';
      desc.textContent = t(lvl.descKey);

      const difficulty = document.createElement('div');
      difficulty.style.cssText = 'font-size:11px;color:#8a7040';
      difficulty.textContent = '⛏'.repeat(lvl.difficultyTier);

      card.append(nameRow, desc, difficulty);

      if (!unlocked) {
        const req = document.createElement('div');
        req.style.cssText = 'font-size:10px;color:#503820;margin-top:6px';
        const prevLevel = levels[levels.indexOf(lvl) - 1];
        // The threshold and the previous level are separate params: baking the
        // whole phrase into one leaked the English word "on" into every locale.
        req.textContent = prevLevel
          ? t('menu.level_locked', {
              threshold: `$${lvl.unlockThreshold.toLocaleString('en-US')}`,
              level: t(prevLevel.nameKey),
            })
          : '';
        card.appendChild(req);
      } else {
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px';

        const startBtn = document.createElement('button');
        startBtn.className = 'bs-btn bs-btn-primary';
        startBtn.style.cssText = 'flex:1;font-size:12px;padding:6px 10px';
        startBtn.textContent = completed ? t('menu.level_resume') : t('menu.level_start');
        startBtn.addEventListener('click', () => {
          this.hide();
          this.onStartLevel?.(lvl.id);
        });

        btnRow.appendChild(startBtn);
        card.appendChild(btnRow);
      }

      this.worldMapBox.appendChild(card);
    }

    const backBtn = this.makeMenuBtn('ui.back', '', () => {
      this.worldMapBox.style.display = 'none';
      this.menuBox.style.display = 'flex';
    }, '← ');
    backBtn.style.marginTop = '4px';
    this.worldMapBox.appendChild(backBtn);
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

  /**
   * @param persistent Register the caption with the locale registry. Only for
   *   buttons that live as long as the menu — world-map buttons are rebuilt by
   *   showWorldMap() on every refresh, so registering them would pile up
   *   bindings pointing at discarded nodes.
   */
  private makeMenuBtn(
    key: string,
    variant: 'primary' | 'gold' | '',
    onClick: () => void,
    prefix = '',
    persistent = false,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `bs-btn${variant === 'primary' ? ' bs-btn-primary' : ''}`;
    btn.style.cssText = 'width:100%;padding:10px 16px;font-size:13px;font-weight:600;text-align:left;pointer-events:all';
    if (persistent) this.locale.bindText(btn, key, undefined, prefix);
    else btn.textContent = prefix + t(key);
    if (variant === 'gold') {
      btn.style.color = '#ffe090';
      btn.style.borderColor = 'rgba(255,225,144,0.4)';
      btn.style.background = 'rgba(255,225,144,0.08)';
    }
    btn.addEventListener('click', onClick);
    return btn;
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

  private starsForProfit(profit: number, threshold: number): string {
    if (profit >= threshold * 2) return '★★★';
    if (profit >= threshold) return '★★☆';
    if (profit >= threshold * 0.5) return '★☆☆';
    return '☆☆☆';
  }
}
