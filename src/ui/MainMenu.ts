// BlastSimulator2026 — Main Menu and World Map Screen (12.8)
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
      'position:fixed;inset:0;background:rgba(5,10,15,0.95);z-index:9999',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px',
    ].join(';');

    // ── Title ──
    const title = document.createElement('h1');
    title.style.cssText = 'color:#f0c060;font-size:36px;margin:0;font-family:monospace;text-shadow:0 0 20px #c07020;text-align:center';
    title.textContent = t('menu.title');

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'color:#806040;font-size:12px;margin-bottom:8px';
    subtitle.textContent = '💣  dig. blast. profit.  💣';

    // ── Menu box ──
    this.menuBox = document.createElement('div');
    this.menuBox.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:220px';

    const newBtn = this.makeMenuBtn(t('menu.new_campaign'), 'bs-btn-primary', () => this.onNewCampaign?.());
    const continueBtn = this.makeMenuBtn(t('menu.continue'), '', () => this.showWorldMap(null));
    const loadBtn = this.makeMenuBtn(t('menu.load'), '', () => this.onLoad?.());
    const settingsBtn = this.makeMenuBtn(t('menu.settings'), '', () => this.onSettings?.());

    this.menuBox.append(newBtn, continueBtn, loadBtn, settingsBtn);

    // ── World map box (hidden initially) ──
    this.worldMapBox = document.createElement('div');
    this.worldMapBox.style.cssText = 'display:none;flex-direction:column;gap:8px;min-width:320px;max-width:500px';

    this.overlay.append(title, subtitle, this.menuBox, this.worldMapBox);
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
    mapTitle.className = 'bs-panel-title';
    mapTitle.style.cssText = 'font-size:16px;text-align:center';
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
        'padding:10px 14px;border-radius:6px;',
        unlocked ? 'background:#2a1a0a;cursor:pointer' : 'background:#1a1208;cursor:not-allowed;opacity:0.6',
      ].join('');

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between';

      const name = document.createElement('div');
      name.style.cssText = 'font-size:13px;color:#d0b060;font-weight:bold';
      name.textContent = t(lvl.nameKey);

      const stars = document.createElement('div');
      stars.style.cssText = 'font-size:14px';
      stars.textContent = completed
        ? this.starsForProfit(profit, lvl.unlockThreshold)
        : (unlocked ? '☆☆☆' : '🔒');

      nameRow.append(name, stars);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:10px;color:#806040;margin:3px 0';
      desc.textContent = t(lvl.descKey);

      const difficulty = document.createElement('div');
      difficulty.style.cssText = 'font-size:10px;color:#a08050';
      difficulty.textContent = '⛏'.repeat(lvl.difficultyTier);

      card.append(nameRow, desc, difficulty);

      if (!unlocked) {
        const req = document.createElement('div');
        req.style.cssText = 'font-size:10px;color:#604030;margin-top:4px';
        const prevLevel = levels[levels.indexOf(lvl) - 1];
        req.textContent = prevLevel
          ? t('menu.level_locked', { req: `$${prevLevel ? lvl.unlockThreshold.toLocaleString() : '???'} on ${t(prevLevel.nameKey)}` })
          : '';
        card.appendChild(req);
      } else {
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:6px;margin-top:6px';

        const startBtn = document.createElement('button');
        startBtn.className = 'bs-btn bs-btn-primary';
        startBtn.style.cssText = 'flex:1;font-size:10px;padding:3px';
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

    const backBtn = this.makeMenuBtn('← Back', '', () => {
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
    btn.style.cssText = 'position:fixed;top:8px;right:140px;z-index:300;font-size:10px;padding:3px 8px';
    btn.textContent = t('menu.return_to_map');
    btn.addEventListener('click', onReturn);
    container.appendChild(btn);
    return btn;
  }

  dispose(): void { this.overlay.remove(); }

  private makeMenuBtn(label: string, extraClass: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `bs-btn${extraClass ? ' ' + extraClass : ''}`;
    btn.style.cssText = 'width:100%;padding:8px;font-size:13px';
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
