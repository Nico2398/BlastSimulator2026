// BlastSimulator2026 — Main Menu and World Map Screen (12.9)
// Main menu with New/Continue/Load/Settings; world map shows 3 levels
// with lock/unlock status and completion stars.

import { t } from '../core/i18n/I18n.js';
import type { CampaignState } from '../core/campaign/Campaign.js';
import { getAllLevels } from '../core/campaign/Level.js';
import type { SaveBackend } from '../core/state/SaveBackend.js';

export type OnNewCampaign = () => void;
export type OnResumeLevel = (levelId: string) => void;
export type OnStartLevel = (levelId: string) => void;
export type OnLoad = () => void;
export type OnSettings = () => void;

export class MainMenu {
  private readonly overlay: HTMLElement;
  private readonly menuBox: HTMLElement;
  private readonly worldMapBox: HTMLElement;
  private onNewCampaign?: OnNewCampaign;
  private onStartLevel?: OnStartLevel;
  private onLoad?: OnLoad;
  private onSettings?: OnSettings;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'bs-main-menu';
    this.overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9999',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px',
      'background:#060402',
    ].join(';');

    // ── Title ──
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'text-align:center;position:relative';

    const title = document.createElement('h1');
    title.style.cssText = [
      'color:#f0b840;font-size:42px;margin:0;font-family:monospace',
      'text-shadow:0 0 30px rgba(200,100,0,0.6),0 2px 4px rgba(0,0,0,0.8)',
      'letter-spacing:0.04em',
    ].join(';');
    title.textContent = t('menu.title');

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'color:#6a5030;font-size:13px;margin-top:6px;letter-spacing:0.12em;text-transform:uppercase';
    subtitle.textContent = 'dig  ·  blast  ·  profit';

    titleWrap.append(title, subtitle);

    // ── Menu box ──
    this.menuBox = document.createElement('div');
    this.menuBox.style.cssText = [
      'display:flex;flex-direction:column;gap:8px;min-width:240px',
      'background:rgba(8,6,3,0.85);border:1px solid rgba(200,160,60,0.25)',
      'border-radius:12px;padding:20px 24px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.6)',
    ].join(';');

    const newBtn = this.makeMenuBtn(t('menu.new_campaign'), 'primary', () => this.onNewCampaign?.());
    const continueBtn = this.makeMenuBtn(t('menu.continue'), '', () => this.showWorldMap(null));
    const loadBtn = this.makeMenuBtn(t('menu.load'), '', () => this.onLoad?.());
    const settingsBtn = this.makeMenuBtn(t('menu.settings'), '', () => this.onSettings?.());

    this.menuBox.append(newBtn, continueBtn, loadBtn, settingsBtn);

    // ── World map box (hidden initially) ──
    this.worldMapBox = document.createElement('div');
    this.worldMapBox.style.cssText = [
      'display:none;flex-direction:column;gap:8px;min-width:340px;max-width:520px',
      'background:rgba(8,6,3,0.85);border:1px solid rgba(200,160,60,0.25)',
      'border-radius:12px;padding:20px 24px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.6)',
      'max-height:80vh;overflow-y:auto',
    ].join(';');

    this.overlay.append(titleWrap, this.menuBox, this.worldMapBox);
    container.appendChild(this.overlay);
  }

  setBackend(_b: SaveBackend): void { /* reserved for future save-slot preview */ }
  setOnNewCampaign(fn: OnNewCampaign): void { this.onNewCampaign = fn; }
  setOnStartLevel(fn: OnStartLevel): void { this.onStartLevel = fn; }
  setOnLoad(fn: OnLoad): void { this.onLoad = fn; }
  setOnSettings(fn: OnSettings): void { this.onSettings = fn; }

  show(): void { this.overlay.style.display = 'flex'; }
  hide(): void { this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Show the world map with campaign progress. */
  showWorldMap(campaign: CampaignState | null): void {
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

    const levels = getAllLevels();
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
        req.textContent = prevLevel
          ? t('menu.level_locked', { req: `$${lvl.unlockThreshold.toLocaleString()} on ${t(prevLevel.nameKey)}` })
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

    const backBtn = this.makeMenuBtn('← ' + t('ui.back'), '', () => {
      this.worldMapBox.style.display = 'none';
      this.menuBox.style.display = 'flex';
    });
    backBtn.style.marginTop = '4px';
    this.worldMapBox.appendChild(backBtn);
  }

  /** Show "Return to Map" button in-game. */
  makeReturnToMapButton(container: HTMLElement, onReturn: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'bs-btn';
    btn.style.cssText = 'position:fixed;top:8px;right:140px;z-index:300;font-size:10px;padding:3px 8px;pointer-events:all';
    btn.textContent = t('menu.return_to_map');
    btn.addEventListener('click', onReturn);
    container.appendChild(btn);
    return btn;
  }

  dispose(): void { this.overlay.remove(); }

  private makeMenuBtn(label: string, variant: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `bs-btn${variant === 'primary' ? ' bs-btn-primary' : ''}`;
    btn.style.cssText = 'width:100%;padding:10px 16px;font-size:13px;font-weight:600;text-align:left;pointer-events:all';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private starsForProfit(profit: number, threshold: number): string {
    if (profit >= threshold * 2) return '★★★';
    if (profit >= threshold) return '★★☆';
    if (profit >= threshold * 0.5) return '★☆☆';
    return '☆☆☆';
  }
}
