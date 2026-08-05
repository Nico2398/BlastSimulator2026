// BlastSimulator2026 — World Map ("The Portfolio") screen (redesign P8)
// Full-screen campaign level-select, reskinned to the Screens design comp.
// Extracted out of MainMenu.showWorldMap()'s old inline implementation —
// same callback shape (setOnBack/setOnStartLevel), now its own sibling
// screen instead of a second view sharing MainMenu's overlay.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { CampaignState } from '../../core/campaign/Campaign.js';
import { getAllLevels, type LevelDef } from '../../core/campaign/Level.js';
import { formatMoney } from '../../core/economy/formatMoney.js';

/** Card art + short category label per biome — the 3 real campaign biomes only (tutorial_pit is excluded from this screen). */
const BIOME_STYLE: Record<string, { gradient: string; categoryKey: string }> = {
  desert_badlands: { gradient: 'linear-gradient(160deg,#c08a3e,#7d5423)', categoryKey: 'ui.portfolio.biome.desert' },
  alpine_granite: { gradient: 'linear-gradient(160deg,#5f6d7a,#2f3a45)', categoryKey: 'ui.portfolio.biome.mountain' },
  tropical_karst: { gradient: 'linear-gradient(160deg,#3f7a52,#1d3c2a)', categoryKey: 'ui.portfolio.biome.tropical' },
};
const DEFAULT_BIOME_STYLE = { gradient: 'linear-gradient(160deg,#5f6d7a,#2f3a45)', categoryKey: 'ui.portfolio.biome.mountain' };

export class WorldMap {
  private readonly overlay: HTMLElement;
  private readonly cardGrid: HTMLElement;
  private readonly starProgressEl: HTMLElement;
  private readonly starProgressBarFill: HTMLElement;

  private onBack?: () => void;
  private onStartLevel?: (levelId: string) => void;
  private lastCampaign: CampaignState | null = null;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.overlay = el('div', { attrs: {
      style: 'position:fixed;inset:0;z-index:var(--bsx-z-menu);display:none;flex-direction:column;'
        + 'background:radial-gradient(120% 100% at 50% 20%, #1a1f27, #0b0e12)',
    } });
    this.overlay.id = 'bs-world-map';

    // ── Header ──
    const header = el('div', { attrs: { style: 'display:flex;align-items:center;gap:16px;padding:22px 40px' } });

    const backBtn = el('button', {
      attrs: { style: 'display:flex;align-items:center;gap:8px;height:34px;padding:0 13px;border:1px solid rgba(255,255,255,.12);'
        + 'border-radius:5px;background:transparent;color:var(--bsx-text-secondary);font:600 10px/1 var(--bsx-font-ui);'
        + 'letter-spacing:.12em;cursor:pointer;pointer-events:all' },
      children: [iconEl('chev', 12)],
    });
    const backLabel = el('span', {});
    this.locale.bindText(backLabel, 'ui.portfolio.back');
    backBtn.appendChild(backLabel);
    backBtn.addEventListener('click', () => this.onBack?.());

    const titleBlock = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:4px' } });
    const titleEl = el('span', { attrs: { style: 'font:800 16px/1 var(--bsx-font-ui);letter-spacing:.16em;color:var(--bsx-text-primary)' } });
    this.locale.bindText(titleEl, 'ui.portfolio.title');
    const taglineEl = el('span', { attrs: { style: 'font:400 11px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    this.locale.bindText(taglineEl, 'ui.portfolio.tagline');
    titleBlock.append(titleEl, taglineEl);

    const progressBlock = el('div', { attrs: { style: 'display:flex;align-items:center;gap:10px;margin-left:auto' } });
    const progressLabel = el('span', { attrs: { style: 'font:600 9px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)' } });
    this.locale.bindText(progressLabel, 'ui.portfolio.campaign_label');
    const progressTrack = el('div', { attrs: { style: 'width:150px;height:5px;border-radius:3px;background:#242c36;overflow:hidden' } });
    this.starProgressBarFill = el('div', { attrs: { style: 'height:100%;width:0%;background:var(--bsx-amber)' } });
    progressTrack.appendChild(this.starProgressBarFill);
    this.starProgressEl = el('span', { attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-amber)' } });
    progressBlock.append(progressLabel, progressTrack, this.starProgressEl);

    header.append(backBtn, titleBlock, progressBlock);

    // ── Card grid ──
    this.cardGrid = el('div', { attrs: {
      style: 'flex:1;overflow-y:auto;padding:0 40px 32px;display:grid;grid-template-columns:repeat(3,1fr);gap:26px;align-content:start',
    } });

    this.overlay.append(header, this.cardGrid);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  setOnBack(cb: () => void): void { this.onBack = cb; }
  setOnStartLevel(cb: (levelId: string) => void): void { this.onStartLevel = cb; }

  show(campaign: CampaignState | null): void {
    this.lastCampaign = campaign;
    this.render(campaign);
    this.overlay.style.display = 'flex';
  }
  hide(): void { this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  refreshLocale(): void {
    this.locale.refresh();
    if (this.visible) this.render(this.lastCampaign);
  }

  dispose(): void { this.overlay.remove(); }

  private render(campaign: CampaignState | null): void {
    const levels = getAllLevels().filter(l => l.difficultyTier > 0);

    let earnedStars = 0;
    this.cardGrid.replaceChildren(...levels.map((lvl, idx) => {
      const prog = campaign?.levels[lvl.id];
      const unlocked = prog?.unlocked ?? (lvl.difficultyTier === 1);
      const completed = prog?.completed ?? false;
      const profit = prog?.bestSessionProfit ?? 0;
      const stars = completed ? this.starsForProfit(profit, lvl.unlockThreshold) : 0;
      earnedStars += stars;
      const prevLevel = idx > 0 ? levels[idx - 1] : undefined;
      return this.levelCard(lvl, unlocked, completed, profit, prevLevel);
    }));

    const totalStars = levels.length * 3;
    this.starProgressEl.textContent = t('ui.portfolio.star_progress', { earned: earnedStars, total: totalStars });
    this.starProgressBarFill.style.width = `${totalStars > 0 ? (earnedStars / totalStars) * 100 : 0}%`;
  }

  private levelCard(lvl: LevelDef, unlocked: boolean, completed: boolean, profit: number, prevLevel: LevelDef | undefined): HTMLElement {
    const style = BIOME_STYLE[lvl.biome] ?? DEFAULT_BIOME_STYLE;
    const stars = completed ? this.starsForProfit(profit, lvl.unlockThreshold) : 0;

    const card = el('div', { attrs: {
      style: `border-radius:9px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.45);display:flex;flex-direction:column;`
        + `background:var(--bsx-card);opacity:${unlocked ? '1' : '.62'}`,
    } });

    // Biome header art
    const biomeHeader = el('div', { attrs: { style: `height:104px;position:relative;background:${style.gradient}` } });
    biomeHeader.appendChild(el('div', { attrs: {
      style: 'position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(0,0,0,.16) 0 11px,rgba(0,0,0,0) 11px 22px)',
    } }));
    const categoryChip = el('span', {
      attrs: { style: 'position:absolute;left:14px;top:12px;padding:4px 7px;border-radius:3px;background:rgba(8,10,14,.7);'
        + 'font:700 8px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-secondary)' },
    });
    this.locale.bindText(categoryChip, style.categoryKey);
    const diffChip = el('div', {
      attrs: { style: 'position:absolute;right:14px;top:12px;display:flex;gap:4px;padding:4px 7px;border-radius:3px;'
        + 'background:rgba(8,10,14,.7);color:var(--bsx-amber)' },
      children: Array.from({ length: lvl.difficultyTier }, () => iconEl('pick', 12)),
    });
    const starRow = el('div', {
      attrs: { style: 'position:absolute;left:14px;bottom:12px;display:flex;gap:4px' },
      children: Array.from({ length: 3 }, (_, i) => {
        const star = iconEl('star', 16);
        star.style.color = i < stars ? 'var(--bsx-amber)' : 'rgba(255,255,255,.14)';
        return star;
      }),
    });
    biomeHeader.append(categoryChip, diffChip, starRow);

    // Content body
    const nameEl = el('span', { text: t(lvl.nameKey), attrs: { style: 'font:800 17px/1.1 var(--bsx-font-ui);letter-spacing:-.01em;color:var(--bsx-text-primary)' } });
    const descEl = el('span', { text: t(lvl.descKey), attrs: { style: 'font:400 11px/1.5 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    const nameBlock = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px' }, children: [nameEl, descEl] });

    const criteriaBlock = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' }, children: [
      this.criteriaRow('check', profit > 0 ? 'var(--bsx-positive)' : 'var(--bsx-text-micro)', 'ui.portfolio.criteria.best_profit',
        profit > 0 ? `$${formatMoney(profit)}` : '—'),
      this.criteriaRow('clock', 'var(--bsx-text-micro)', 'ui.portfolio.criteria.target', `$${formatMoney(lvl.unlockThreshold)}`),
    ] });

    const body = el('div', { attrs: { style: 'padding:16px;display:flex;flex-direction:column;gap:11px;flex:1' } });
    body.append(nameBlock, criteriaBlock);

    if (!unlocked) {
      const lockBlock = el('div', { attrs: {
        style: 'margin-top:auto;display:flex;align-items:center;gap:8px;padding:10px 11px;border-radius:5px;'
          + 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)',
      } });
      const lockIcon = el('div', { attrs: { style: 'color:var(--bsx-text-micro)' }, children: [iconEl('lock', 13, 0.6)] });
      const lockText = el('span', {
        text: prevLevel ? t('menu.level_locked', { threshold: `$${formatMoney(lvl.unlockThreshold)}`, level: t(prevLevel.nameKey) }) : '',
        attrs: { style: 'font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
      });
      lockBlock.append(lockIcon, lockText);
      body.appendChild(lockBlock);
    } else {
      const startBtn = el('button', {
        text: completed ? t('menu.level_resume') : t('menu.level_start'),
        attrs: { style: `margin-top:auto;height:40px;border:0;border-radius:5px;cursor:pointer;pointer-events:all;`
          + `font:800 11px/1 var(--bsx-font-ui);letter-spacing:.18em;`
          + `background:${completed ? 'rgba(255,176,46,.16)' : 'var(--bsx-amber)'};color:${completed ? 'var(--bsx-amber)' : 'var(--bsx-text-on-amber)'}` },
      });
      startBtn.addEventListener('click', () => this.onStartLevel?.(lvl.id));
      body.appendChild(startBtn);
    }

    card.append(biomeHeader, body);
    return card;
  }

  private criteriaRow(icon: string, color: string, labelKey: string, value: string): HTMLElement {
    const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:7px' } });
    const iconWrap = el('span', { attrs: { style: `color:${color}` }, children: [iconEl(icon, 11)] });
    const label = el('span', {});
    this.locale.bindText(label, labelKey);
    label.style.cssText += 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)';
    const valueEl = el('span', { text: value, attrs: { style: `margin-left:auto;font:500 10px/1 var(--bsx-font-mono);color:${color}` } });
    row.append(iconWrap, label, valueEl);
    return row;
  }

  private starsForProfit(profit: number, threshold: number): number {
    if (profit >= threshold * 2) return 3;
    if (profit >= threshold) return 2;
    if (profit >= threshold * 0.5) return 1;
    return 0;
  }
}
