// BlastSimulator2026 — Level End Screen: victory + defeat variants (redesign P8)
// Full-screen state (module layout per ui-implementation-plan.md), shown over
// the HUD the moment state.levelEndReason becomes non-null. Victory renders
// star rating + recap; the 4 defeat reasons (bankruptcy/arrest/
// ecological_shutdown/worker_revolt) share a layout — icon identity, satirical
// body, 4 real stats, a tip box explaining the real trigger mechanic.
//
// Self-polling like BlastReportModal, not callback-driven like MainMenu:
// update(state) is the only entry point, gated on the null→terminal-reason
// transition rather than a tick stamp (LevelCompleteSummary carries none of
// its own).

import { t } from '../../core/i18n/I18n.js';
import { el, button, card, statGrid } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { calculateStarRating } from '../../core/campaign/SuccessTracker.js';
import { getLevel, getAllLevels } from '../../core/campaign/Level.js';
import { TICKS_PER_DAY } from '../../core/config/balance.js';
import type { GameState } from '../../core/state/GameState.js';

type DefeatReason = Exclude<NonNullable<GameState['levelEndReason']>, 'completed'>;

/**
 * Every defeat cause shares the same critical-red identity (design: uniform
 * badge color across causes) — only the glyph inside the badge changes.
 */
const DEFEAT_ICON: Record<DefeatReason, IconName> = {
  bankruptcy: 'finance',
  arrest: 'gavel',
  ecological_shutdown: 'water',
  worker_revolt: 'union',
};

export class LevelEndScreen {
  private readonly overlay: HTMLElement;

  // ── Victory ──
  private readonly victoryRoot: HTMLElement;
  private readonly starRow: HTMLElement;
  private readonly headlineEl: HTMLElement;
  private readonly recapEl: HTMLElement;
  private readonly statGridEl: HTMLElement;
  private readonly starRatingTitle: HTMLElement;
  private readonly starRatingRows: HTMLElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly continueBtn: HTMLButtonElement;

  // ── Defeat ──
  private readonly defeatRoot: HTMLElement;
  private readonly defeatIconWrap: HTMLElement;
  private readonly defeatTitleEl: HTMLElement;
  private readonly defeatBodyEl: HTMLElement;
  private readonly defeatStatGridEl: HTMLElement;
  private readonly defeatTipTextEl: HTMLElement;
  private readonly defeatBackBtn: HTMLButtonElement;
  private readonly defeatRetryBtn: HTMLButtonElement;

  private onReplay?: (levelId: string) => void;
  private onContinue?: (nextLevelId: string) => void;
  private onBackToPortfolio?: () => void;

  /** True once rendered for the current terminal-reason transition — reset the instant levelEndReason clears. */
  private rendered = false;
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.overlay = el('div', { attrs: {
      style: 'position:fixed;inset:0;z-index:var(--bsx-z-menu);display:none;'
        + 'align-items:center;justify-content:center;'
        + 'background:radial-gradient(90% 80% at 50% 30%, rgba(255,176,46,.16), rgba(11,14,18,1) 68%)',
    } });
    this.overlay.id = 'bs-level-end-screen';

    const column = el('div', { attrs: { style: 'width:720px;max-width:92vw;display:flex;flex-direction:column;gap:22px' } });

    // ── Victory content ──
    const banner = el('div', { attrs: { style: 'display:flex;flex-direction:column;align-items:center;gap:11px' } });
    this.starRow = el('div', { attrs: { style: 'display:flex;gap:7px' } });
    this.headlineEl = el('span', { attrs: { style: 'font:900 40px/1 var(--bsx-font-ui);letter-spacing:-.02em;color:var(--bsx-amber)' } });
    this.recapEl = el('span', { attrs: {
      style: 'font:400 14px/1.6 var(--bsx-font-ui);color:var(--bsx-text-secondary);text-align:center;max-width:520px',
    } });
    banner.append(this.starRow, this.headlineEl, this.recapEl);

    this.statGridEl = el('div');

    this.starRatingTitle = el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-micro)' } });
    this.locale.bindText(this.starRatingTitle, 'ui.level_end.star_rating.title');
    this.starRatingRows = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:8px' } });
    const starRatingCard = card([this.starRatingTitle, this.starRatingRows]);

    this.replayBtn = button('ghost', t('ui.level_end.replay'), { onClick: () => {
      if (this.lastState?.campaign.activeLevelId) this.onReplay?.(this.lastState.campaign.activeLevelId);
    } });
    this.replayBtn.style.flex = '1';
    this.locale.bindText(this.replayBtn, 'ui.level_end.replay');

    this.continueBtn = button('primary', '', { onClick: () => {
      const state = this.lastState;
      if (!state) return;
      const nextId = this.nextLevelId(state);
      if (nextId) this.onContinue?.(nextId);
      else this.onBackToPortfolio?.();
    } });
    this.continueBtn.style.flex = '1.4';

    const victoryFooter = el('div', { attrs: { style: 'display:flex;gap:9px' }, children: [this.replayBtn, this.continueBtn] });

    this.victoryRoot = el('div', {
      attrs: { style: 'display:flex;flex-direction:column;gap:22px' },
      children: [banner, this.statGridEl, starRatingCard, victoryFooter],
    });

    // ── Defeat content ──
    const defeatBanner = el('div', { attrs: { style: 'display:flex;flex-direction:column;align-items:center;gap:13px' } });
    this.defeatIconWrap = el('div', { attrs: {
      style: 'width:64px;height:64px;border-radius:12px;display:flex;align-items:center;justify-content:center;'
        + 'background:rgba(255,91,76,.14);color:var(--bsx-critical);border:1px solid rgba(255,91,76,.34)',
    } });
    this.defeatTitleEl = el('span', { attrs: { style: 'font:900 40px/1.05 var(--bsx-font-ui);letter-spacing:-.02em;color:var(--bsx-critical);text-align:center' } });
    this.defeatBodyEl = el('span', { attrs: {
      style: 'font:400 14px/1.6 var(--bsx-font-ui);color:var(--bsx-text-secondary);text-align:center;max-width:540px',
    } });
    defeatBanner.append(this.defeatIconWrap, this.defeatTitleEl, this.defeatBodyEl);

    this.defeatStatGridEl = el('div');

    this.defeatTipTextEl = el('span', { attrs: { style: 'font:400 12px/1.55 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' } });
    const tipIcon = el('div', { attrs: { style: 'color:var(--bsx-amber);padding-top:1px;flex:0 0 auto' }, children: [iconEl('warn', 15)] });
    const tipBox = el('div', {
      attrs: { style: 'display:flex;gap:10px;padding:14px 16px;border-radius:7px;background:rgba(255,176,46,.07);border:1px solid rgba(255,176,46,.26)' },
      children: [tipIcon, this.defeatTipTextEl],
    });

    this.defeatBackBtn = button('ghost', t('ui.level_end.back_to_portfolio'), { onClick: () => this.onBackToPortfolio?.() });
    this.defeatBackBtn.style.flex = '1';
    this.locale.bindText(this.defeatBackBtn, 'ui.level_end.back_to_portfolio');

    this.defeatRetryBtn = button('primary', '', { onClick: () => {
      if (this.lastState?.campaign.activeLevelId) this.onReplay?.(this.lastState.campaign.activeLevelId);
    } });
    this.defeatRetryBtn.style.flex = '1.4';

    const defeatFooter = el('div', { attrs: { style: 'display:flex;gap:9px' }, children: [this.defeatBackBtn, this.defeatRetryBtn] });

    this.defeatRoot = el('div', {
      attrs: { style: 'display:none;flex-direction:column;gap:20px' },
      children: [defeatBanner, this.defeatStatGridEl, tipBox, defeatFooter],
    });

    column.append(this.victoryRoot, this.defeatRoot);
    this.overlay.appendChild(column);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  setOnReplay(cb: (levelId: string) => void): void { this.onReplay = cb; }
  setOnContinue(cb: (nextLevelId: string) => void): void { this.onContinue = cb; }
  setOnBackToPortfolio(cb: () => void): void { this.onBackToPortfolio = cb; }

  refreshLocale(): void {
    this.locale.refresh();
    if (this.lastState) this.renderForState(this.lastState);
  }

  show(): void { this.overlay.style.display = 'flex'; }
  hide(): void { this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  update(state: GameState): void {
    if (state.levelEndReason === null) {
      this.rendered = false;
      if (this.visible) this.hide();
      return;
    }
    this.lastState = state;
    if (this.rendered) return;
    this.rendered = true;
    this.renderForState(state);
    this.show();
  }

  private renderForState(state: GameState): void {
    const reason = state.levelEndReason;
    if (reason === 'completed') {
      this.defeatRoot.style.display = 'none';
      this.clearDefeatContent();
      this.victoryRoot.style.display = 'flex';
      this.renderVictoryContent(state);
    } else if (reason !== null) {
      this.victoryRoot.style.display = 'none';
      this.clearVictoryContent();
      this.defeatRoot.style.display = 'flex';
      this.renderDefeatContent(state, reason);
    }
  }

  /**
   * A long-lived instance re-renders across many levels (lose, retry, win, next level…).
   * Both roots stay mounted so only `display` toggles between them — clear the inactive
   * root's text on every switch, or a prior render lingers in the DOM (invisible but still
   * picked up by `.textContent`-based reads) under its `display:none` sibling.
   */
  private clearVictoryContent(): void {
    this.starRow.replaceChildren();
    this.headlineEl.textContent = '';
    this.recapEl.textContent = '';
    this.statGridEl.replaceChildren();
    this.starRatingRows.replaceChildren();
    this.continueBtn.textContent = '';
  }

  private clearDefeatContent(): void {
    this.defeatIconWrap.replaceChildren();
    this.defeatTitleEl.textContent = '';
    this.defeatBodyEl.textContent = '';
    this.defeatTipTextEl.textContent = '';
    this.defeatStatGridEl.replaceChildren();
    this.defeatRetryBtn.textContent = '';
  }

  private nextLevelId(state: GameState): string | null {
    const activeId = state.campaign.activeLevelId;
    if (!activeId) return null;
    const all = getAllLevels();
    const idx = all.findIndex(l => l.id === activeId);
    if (idx < 0 || idx + 1 >= all.length) return null;
    return all[idx + 1]!.id;
  }

  private renderVictoryContent(state: GameState): void {
    const activeId = state.campaign.activeLevelId;
    const level = activeId ? getLevel(activeId) : undefined;
    const stats = state.levelStats;
    const target = level?.unlockThreshold ?? 0;
    const rating = calculateStarRating(stats, target);

    this.starRow.replaceChildren(...Array.from({ length: 3 }, (_, i) => {
      const earned = i < rating.stars;
      const star = iconEl('star', 34);
      star.style.color = earned ? 'var(--bsx-amber)' : 'rgba(255,255,255,.16)';
      return star;
    }));

    this.headlineEl.textContent = t('ui.level_end.victory.headline');
    this.recapEl.textContent = t('ui.level_end.victory.recap', {
      level: level ? t(level.nameKey) : '',
      profit: `$${formatMoney(stats.totalWealth)}`,
      target: `$${formatMoney(target)}`,
    });

    const days = Math.floor(state.tickCount / TICKS_PER_DAY) + 1;
    this.statGridEl.replaceChildren(statGrid([
      { key: t('ui.level_end.stat.profit'), value: `$${formatMoney(stats.totalWealth)}`, color: 'var(--bsx-positive)' },
      { key: t('ui.level_end.stat.days'), value: `${days}` },
      { key: t('ui.level_end.stat.blasts'), value: `${stats.blastsPerformed}` },
      { key: t('ui.level_end.stat.volume'), value: `${Math.round(stats.totalVolumeBlasted).toLocaleString('en-US')} m³` },
      { key: t('ui.level_end.stat.max_depth'), value: `${Math.round(stats.maxDepthReached)} m` },
      { key: t('ui.level_end.stat.unique_ores'), value: `${stats.uniqueOresExtracted.size}`, color: 'var(--bsx-amber)' },
      stats.casualties > 0
        ? { key: t('ui.level_end.stat.casualties'), value: `${stats.casualties}`, color: 'var(--bsx-critical-text)' }
        : { key: t('ui.level_end.stat.casualties'), value: `${stats.casualties}` },
      { key: t('ui.level_end.stat.best_safety'), value: `${Math.round(stats.bestSafety)}` },
    ], 4));

    this.starRatingRows.replaceChildren(
      this.starRatingRow(rating.details.profitPass, t('ui.level_end.star_rating.profit_label'),
        `$${formatMoney(stats.totalWealth)}`,
        t(rating.details.profitPass ? 'ui.level_end.star_rating.profit_pass' : 'ui.level_end.star_rating.profit_fail', {
          profit: `$${formatMoney(stats.totalWealth)}`, target: `$${formatMoney(target)}`,
        })),
      this.starRatingRow(rating.details.safetyPass, t('ui.level_end.star_rating.safety_label'),
        `${stats.casualties}`,
        t(rating.details.safetyPass ? 'ui.level_end.star_rating.safety_pass' : 'ui.level_end.star_rating.safety_fail', {
          count: `${stats.casualties}`,
        })),
      this.starRatingRow(rating.details.ecologyPass, t('ui.level_end.star_rating.ecology_label'),
        `${Math.round(stats.bestEcology)}`,
        t(rating.details.ecologyPass ? 'ui.level_end.star_rating.ecology_pass' : 'ui.level_end.star_rating.ecology_fail', {
          score: `${Math.round(stats.bestEcology)}`,
        })),
    );

    this.replayBtn.style.display = rating.stars < 3 ? '' : 'none';

    const nextId = this.nextLevelId(state);
    const nextLevel = nextId ? getLevel(nextId) : undefined;
    this.continueBtn.textContent = '';
    this.continueBtn.appendChild(el('span', {
      text: nextLevel ? t('ui.level_end.continue', { level: t(nextLevel.nameKey) }) : t('ui.level_end.back_to_portfolio'),
    }));
  }

  private starRatingRow(pass: boolean, label: string, value: string, note: string): HTMLElement {
    const row = el('div', { attrs: { style: 'display:flex;align-items:flex-start;gap:10px' } });
    const iconWrap = el('div', {
      attrs: { style: `color:${pass ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)'};padding-top:1px;flex:0 0 auto` },
      children: [iconEl(pass ? 'check' : 'x', 14)],
    });
    const labelEl = el('span', {
      text: label,
      attrs: { style: 'flex:0 0 88px;font:600 12px/1.4 var(--bsx-font-ui);color:var(--bsx-text-primary)' },
    });
    const noteEl = el('span', {
      text: note,
      attrs: { style: 'flex:1;font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
    });
    const valueEl = el('span', {
      text: value,
      attrs: { style: 'flex:0 0 auto;font:600 12px/1 var(--bsx-font-mono);color:var(--bsx-text-primary)' },
    });
    row.append(iconWrap, labelEl, noteEl, valueEl);
    return row;
  }

  private renderDefeatContent(state: GameState, reason: DefeatReason): void {
    this.defeatIconWrap.replaceChildren(iconEl(DEFEAT_ICON[reason], 32));
    this.defeatTitleEl.textContent = t(`ui.level_end.defeat.${reason}.title`);

    const days = Math.floor(state.tickCount / TICKS_PER_DAY) + 1;
    this.defeatBodyEl.textContent = t(`ui.level_end.defeat.${reason}.body`, { days: `${days}` });
    this.defeatTipTextEl.textContent = t(`ui.level_end.defeat.${reason}.tip`);

    this.defeatStatGridEl.replaceChildren(statGrid(this.defeatStats(reason, state), 4));

    const activeId = state.campaign.activeLevelId;
    const level = activeId ? getLevel(activeId) : undefined;
    this.defeatRetryBtn.textContent = '';
    this.defeatRetryBtn.appendChild(el('span', {
      text: t('ui.level_end.retry', { level: level ? t(level.nameKey) : '' }),
    }));
  }

  private defeatStats(reason: DefeatReason, state: GameState): { key: string; value: string; color?: string }[] {
    const salariesPaid = state.finances.transactions
      .filter(tx => tx.type === 'expense' && tx.category === 'salaries')
      .reduce((sum, tx) => sum + tx.amount, 0);
    const days = Math.floor(state.tickCount / TICKS_PER_DAY) + 1;

    switch (reason) {
      case 'bankruptcy':
        return [
          { key: t('ui.level_end.stat.final_balance'), value: `$${formatMoney(state.cash)}`, color: 'var(--bsx-critical-text)' },
          { key: t('ui.level_end.stat.days'), value: `${days}` },
          { key: t('ui.level_end.stat.blasts'), value: `${state.levelStats.blastsPerformed}` },
          { key: t('ui.level_end.stat.salaries_paid'), value: `$${formatMoney(salariesPaid)}` },
        ];
      case 'arrest':
        return [
          { key: t('ui.level_end.stat.exposure_at_arrest'), value: `${Math.round(state.mafia.exposureRisk * 100)}%`, color: 'var(--bsx-ore)' },
          { key: t('ui.level_end.stat.arrangements_made'), value: `${state.corruption.attempts.length}` },
          { key: t('ui.level_end.stat.profit'), value: `$${formatMoney(state.levelStats.totalWealth)}`, color: 'var(--bsx-positive)' },
          { key: t('ui.level_end.stat.corruption_level'), value: `${state.corruption.level}` },
        ];
      case 'ecological_shutdown': {
        const finesPaid = state.finances.transactions
          .filter(tx => tx.type === 'expense' && tx.category === 'fines')
          .reduce((sum, tx) => sum + tx.amount, 0);
        return [
          { key: t('ui.level_end.stat.final_ecology'), value: `${Math.round(state.scores.ecology)}`, color: 'var(--bsx-critical-text)' },
          { key: t('ui.level_end.stat.fines_paid'), value: `$${formatMoney(finesPaid)}`, color: 'var(--bsx-critical-text)' },
          { key: t('ui.level_end.stat.best_ecology'), value: `${Math.round(state.levelStats.bestEcology)}` },
          { key: t('ui.level_end.stat.volume'), value: `${Math.round(state.levelStats.totalVolumeBlasted).toLocaleString('en-US')} m³` },
        ];
      }
      case 'worker_revolt':
        return [
          { key: t('ui.level_end.stat.final_wellbeing'), value: `${Math.round(state.scores.wellBeing)}`, color: 'var(--bsx-critical-text)' },
          { key: t('ui.level_end.stat.salaries_paid'), value: `$${formatMoney(salariesPaid)}` },
          { key: t('ui.level_end.stat.shift_mode'), value: t(`ui.policy.${state.sitePolicy.shiftMode}`) },
          { key: t('ui.level_end.stat.days'), value: `${days}` },
        ];
    }
  }

  dispose(): void { this.overlay.remove(); }
}
