// BlastSimulator2026 — Top bar (redesign P1)
// Replaces HUD.ts. One coherent bar: balance+trend, day/clock, weather,
// speed+pause, alert pips, scores, log/saves/site-map — folding in the
// floating Saves and Return-to-Map buttons main.ts used to create ad-hoc
// (spec §5 defect: they collided with the paused/event chip).

import { iconEl } from '../icons.js';
import { el } from '../dom.js';
import { t } from '../../core/i18n/I18n.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { TICKS_PER_DAY } from '../../core/config/balance.js';
import type { NotificationCenter, AlertPip } from '../notify/NotificationCenter.js';
import type { PanelName } from '../UIManager.js';

const WEATHER_ICON: Record<WeatherState, string> = {
  sunny: 'sun',
  cloudy: 'cloud',
  light_rain: 'rain',
  heavy_rain: 'rain',
  storm: 'storm',
  heat_wave: 'heat',
  cold_snap: 'cold',
};

const SPEED_STEPS = [1, 2, 4, 8] as const;
/** Window (ticks) the balance trend averages over — long enough to smooth a single payroll tick. */
const TREND_WINDOW_TICKS = 24;

const ALERT_ROUTE: Partial<Record<AlertPip['kind'], PanelName>> = {
  contract: 'contracts',
  crew: 'employees',
  fleet: 'vehicles',
};

/**
 * Balance display: whole dollars, thousands separators, minus sign in front
 * of the currency symbol. Cash is a float and prints its rounding error
 * otherwise ("$-1,234.567").
 */
export function formatBalance(cash: number): string {
  const rounded = Math.round(cash);
  const magnitude = Math.abs(rounded).toLocaleString('en-US');
  return rounded < 0 ? `-$${magnitude}` : `$${magnitude}`;
}

/** Net income/expense per tick over the trailing window, from raw transactions. */
export function netPerTick(state: GameState, windowTicks = TREND_WINDOW_TICKS): number {
  const since = state.tickCount - windowTicks;
  let net = 0;
  for (const tx of state.finances.transactions) {
    if (tx.tick < since) continue;
    net += tx.type === 'income' ? tx.amount : -tx.amount;
  }
  const spanTicks = Math.min(windowTicks, Math.max(1, state.tickCount));
  return net / spanTicks;
}

export class TopBar {
  private readonly root: HTMLElement;
  private readonly balanceWrap: HTMLButtonElement;
  private readonly balanceValue: HTMLElement;
  private readonly trendValue: HTMLElement;
  private readonly trendIcon: HTMLElement;
  private readonly dayValue: HTMLElement;
  private readonly clockValue: HTMLElement;
  private readonly weatherIcon: HTMLElement;
  private readonly weatherBtn: HTMLButtonElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly pauseChip: HTMLElement;
  private readonly alertPipsEl: HTMLElement;
  private readonly scoresEl: HTMLElement;
  private readonly logBtn: HTMLButtonElement;
  private readonly logBadge: HTMLElement;
  private readonly locale = new LocaleTextRegistry();

  private onSpeedChange?: (speed: number) => void;
  private onTogglePause?: () => void;
  private onNavigate?: (panel: PanelName) => void;
  private onOpenLog?: () => void;
  private onOpenSaves?: () => void;
  private onSiteMap?: () => void;

  private lastWeather: WeatherState = 'sunny';
  private currentSpeed = 1;
  private isPaused = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'bs-hud-top';
    this.root.className = 'bsx-root';
    this.root.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'height:52px',
      'z-index:var(--bsx-z-topbar)', 'display:flex', 'align-items:stretch',
      'background:var(--bsx-chrome)', 'border-bottom:1px solid var(--bsx-hairline-strong)',
      'pointer-events:all',
    ].join(';');

    // ── Balance ── click opens the Finances panel (P5).
    this.balanceWrap = document.createElement('button');
    this.balanceWrap.dataset['action'] = 'open-finances';
    this.balanceWrap.style.cssText = 'display:flex;flex:0 0 auto;align-items:center;gap:10px;padding:0 16px;border:0;border-right:1px solid var(--bsx-hairline);background:transparent;cursor:pointer;font:inherit;text-align:left';
    this.balanceWrap.addEventListener('click', () => this.onNavigate?.('finances'));
    this.balanceWrap.addEventListener('mouseenter', () => { this.balanceWrap.style.background = 'rgba(255,255,255,.05)'; });
    this.balanceWrap.addEventListener('mouseleave', () => { this.balanceWrap.style.background = 'transparent'; });
    this.balanceWrap.appendChild(iconEl('finance', 17));
    const balCol = el('div');
    balCol.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    this.balanceValue = el('div', { className: 'bs-balance bsx-mono' });
    this.balanceValue.style.cssText = 'font-size:19px;font-weight:600;letter-spacing:-.01em';
    const trendRow = el('div');
    trendRow.style.cssText = 'display:flex;align-items:center;gap:4px';
    this.trendIcon = iconEl('down', 9);
    this.trendValue = el('span', { className: 'bsx-mono' });
    this.trendValue.style.fontSize = '10px';
    trendRow.append(this.trendIcon, this.trendValue);
    balCol.append(this.balanceValue, trendRow);
    this.balanceWrap.appendChild(balCol);

    // ── Day / clock ──
    const dayWrap = el('div');
    dayWrap.style.cssText = 'display:flex;flex:0 0 auto;align-items:center;gap:12px;padding:0 16px;border-right:1px solid var(--bsx-hairline)';
    const dayCol = el('div');
    dayCol.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    this.dayValue = el('div');
    this.dayValue.style.cssText = 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)';
    this.clockValue = el('div', { className: 'bsx-mono' });
    this.clockValue.style.cssText = 'font-size:14px;font-weight:500';
    dayCol.append(this.dayValue, this.clockValue);

    this.weatherBtn = document.createElement('button');
    this.weatherBtn.className = 'bs-weather';
    this.weatherBtn.style.cssText = 'display:flex;align-items:center;height:32px;padding:0 9px;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:var(--bsx-well);color:var(--bsx-info-text);cursor:pointer';
    this.weatherIcon = iconEl('sun', 15);
    this.weatherBtn.appendChild(this.weatherIcon);
    dayWrap.append(dayCol, this.weatherBtn);

    // ── Speed + pause ──
    const speedWrap = el('div');
    speedWrap.style.cssText = 'display:flex;flex:0 0 auto;align-items:center;padding:0 14px;gap:8px;border-right:1px solid var(--bsx-hairline)';
    const speedGroup = el('div', { className: 'bs-speed-btn' });
    speedGroup.style.cssText = 'display:flex;height:32px;border:1px solid var(--bsx-hairline-strong);border-radius:4px;overflow:hidden;background:var(--bsx-well)';
    const pauseBtn = document.createElement('button');
    pauseBtn.style.cssText = 'width:32px;border:0;border-right:1px solid var(--bsx-hairline);background:transparent;color:var(--bsx-text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center';
    pauseBtn.appendChild(iconEl('pause', 12));
    this.locale.bindTitle(pauseBtn, 'shell.topbar.pause_tip');
    pauseBtn.addEventListener('click', () => this.onTogglePause?.());
    speedGroup.appendChild(pauseBtn);
    for (const speed of SPEED_STEPS) {
      const btn = document.createElement('button');
      btn.dataset['speed'] = String(speed);
      btn.textContent = `${speed}×`;
      btn.style.cssText = 'width:32px;border:0;border-right:1px solid var(--bsx-hairline);background:transparent;color:var(--bsx-text-muted);font:600 11px/1 var(--bsx-font-mono);cursor:pointer;display:flex;align-items:center;justify-content:center';
      btn.addEventListener('click', () => this.onSpeedChange?.(speed));
      speedGroup.appendChild(btn);
      this.speedButtons.push(btn);
    }
    this.pauseChip = el('span');
    this.pauseChip.style.cssText = 'display:none;align-items:center;gap:5px;height:22px;padding:0 7px;border-radius:3px;background:rgba(255,176,46,.16);color:var(--bsx-amber-hover);font:700 10px/1 var(--bsx-font-ui);letter-spacing:.1em;white-space:nowrap';
    this.locale.bindText(this.pauseChip, 'shell.topbar.paused');
    speedWrap.append(speedGroup, this.pauseChip);

    // ── Alerts ──
    const alertWrap = el('div');
    alertWrap.style.cssText = 'display:flex;align-items:center;gap:5px;padding:0 10px;flex:1 1 0;min-width:80px';
    this.alertPipsEl = el('div');
    this.alertPipsEl.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap';
    alertWrap.appendChild(this.alertPipsEl);

    // ── Scores ──
    this.scoresEl = el('div', { attrs: { id: 'bs-hud-scores' } });
    this.scoresEl.style.cssText = 'display:flex;align-items:center;gap:2px;padding:0 10px;flex:0 0 auto;border-left:1px solid var(--bsx-hairline)';

    // ── Right cluster: log, saves, site map ──
    const rightWrap = el('div');
    rightWrap.style.cssText = 'display:flex;flex:0 0 auto;align-items:center;gap:6px;padding:0 12px;border-left:1px solid var(--bsx-hairline)';
    this.logBtn = document.createElement('button');
    this.logBtn.style.cssText = 'position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:var(--bsx-well);color:var(--bsx-text-secondary);cursor:pointer';
    this.locale.bindTitle(this.logBtn, 'shell.topbar.log_tip');
    this.logBtn.appendChild(iconEl('bell', 15));
    this.logBadge = el('span');
    this.logBadge.style.cssText = 'position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--bsx-critical);color:#2b0704;font:700 10px/16px var(--bsx-font-mono);text-align:center;display:none';
    this.logBtn.appendChild(this.logBadge);
    this.logBtn.addEventListener('click', () => this.onOpenLog?.());

    const savesBtn = document.createElement('button');
    savesBtn.id = 'bs-saveload-btn';
    savesBtn.style.cssText = 'width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:var(--bsx-well);color:var(--bsx-text-secondary);cursor:pointer';
    this.locale.bindTitle(savesBtn, 'shell.topbar.saves_tip');
    savesBtn.appendChild(iconEl('save', 15));
    savesBtn.addEventListener('click', () => this.onOpenSaves?.());

    const mapBtn = document.createElement('button');
    mapBtn.className = 'bs-return-map';
    mapBtn.style.cssText = 'display:flex;align-items:center;gap:7px;height:34px;padding:0 11px;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:var(--bsx-well);color:var(--bsx-text-secondary);font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;cursor:pointer';
    mapBtn.appendChild(iconEl('map', 14));
    const mapLabel = el('span');
    this.locale.bindText(mapLabel, 'shell.topbar.site_map');
    mapBtn.appendChild(mapLabel);
    mapBtn.addEventListener('click', () => this.onSiteMap?.());

    rightWrap.append(this.logBtn, savesBtn, mapBtn);

    this.root.append(this.balanceWrap, dayWrap, speedWrap, alertWrap, this.scoresEl, rightWrap);
    container.appendChild(this.root);
  }

  setSpeedChangeHandler(cb: (speed: number) => void): void { this.onSpeedChange = cb; }
  setTogglePauseHandler(cb: () => void): void { this.onTogglePause = cb; }
  setNavigateHandler(cb: (panel: PanelName) => void): void { this.onNavigate = cb; }
  setOpenLogHandler(cb: () => void): void { this.onOpenLog = cb; }
  setOpenSavesHandler(cb: () => void): void { this.onOpenSaves = cb; }
  setSiteMapHandler(cb: () => void): void { this.onSiteMap = cb; }

  update(state: GameState, weather: WeatherState | undefined, center: NotificationCenter): void {
    // Balance + trend
    this.balanceValue.textContent = formatBalance(state.cash);
    this.balanceValue.style.color = state.cash < 0 ? 'var(--bsx-critical-text)' : 'var(--bsx-amber)';
    const net = netPerTick(state);
    const positive = net >= 0;
    this.trendValue.textContent = `${positive ? '+' : '-'}$${Math.round(Math.abs(net)).toLocaleString('en-US')}/h`;
    this.trendValue.style.color = positive ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';
    this.trendIcon.setAttribute('name', positive ? 'up' : 'down');
    this.trendIcon.style.color = positive ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';

    // Day / clock
    const day = Math.floor(state.tickCount / TICKS_PER_DAY) + 1;
    const hour = state.tickCount % TICKS_PER_DAY;
    this.dayValue.textContent = t('shell.topbar.day', { day });
    this.clockValue.textContent = `${String(hour).padStart(2, '0')}:00`;

    // Weather
    if (weather) {
      this.lastWeather = weather;
      this.weatherIcon.setAttribute('name', WEATHER_ICON[weather] ?? 'sun');
      this.weatherBtn.title = t(`hud.weather.${weather}`);
    }

    // Speed / pause
    if (state.timeScale !== this.currentSpeed || state.isPaused !== this.isPaused) {
      this.currentSpeed = state.timeScale;
      this.isPaused = state.isPaused;
      for (const btn of this.speedButtons) {
        const active = Number(btn.dataset['speed']) === this.currentSpeed && !this.isPaused;
        btn.style.background = active ? 'var(--bsx-amber)' : 'transparent';
        btn.style.color = active ? 'var(--bsx-text-on-amber)' : 'var(--bsx-text-muted)';
      }
      this.pauseChip.style.display = this.isPaused ? 'flex' : 'none';
    }

    // Alert pips
    const pips = center.update(state);
    this.alertPipsEl.replaceChildren();
    for (const pip of pips) {
      const btn = document.createElement('button');
      if (pip.kind === 'event') btn.classList.add('bs-event-badge');
      const tone = pip.tone === 'critical'
        ? { bg: 'rgba(255,91,76,.14)', border: 'rgba(255,91,76,.45)', fg: 'var(--bsx-critical-text)' }
        : { bg: 'rgba(255,176,46,.12)', border: 'rgba(255,176,46,.36)', fg: 'var(--bsx-amber-hover)' };
      btn.style.cssText = `display:flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:1px solid ${tone.border};border-radius:4px;background:${tone.bg};color:${tone.fg};cursor:pointer;font:700 10px/1 var(--bsx-font-mono);white-space:nowrap`;
      if (pip.tone === 'critical') btn.style.animation = 'bs-pulse 2.4s ease-in-out infinite';
      btn.title = pip.tip;
      btn.appendChild(iconEl(pip.icon, 12));
      btn.appendChild(el('span', { text: pip.label }));
      const route = ALERT_ROUTE[pip.kind];
      if (route) btn.addEventListener('click', () => this.onNavigate?.(route));
      this.alertPipsEl.appendChild(btn);
    }

    // Scores
    this.updateScores(state);

    // Log unread badge
    const unread = center.unreadCount;
    this.logBadge.textContent = unread > 99 ? '99+' : String(unread);
    this.logBadge.style.display = unread > 0 ? 'flex' : 'none';
  }

  private lastScoreSig = '';
  private updateScores(state: GameState): void {
    const scores = [
      { key: 'wellBeing', abbr: t('shell.topbar.score_well') },
      { key: 'safety', abbr: t('shell.topbar.score_safe') },
      { key: 'ecology', abbr: t('shell.topbar.score_eco') },
      { key: 'nuisance', abbr: t('shell.topbar.score_nuis') },
    ] as const;
    const values = scores.map(s => Math.round((state.scores as unknown as Record<string, number>)[s.key] ?? 50));
    const sig = values.join(',');
    if (sig === this.lastScoreSig) return;
    this.lastScoreSig = sig;
    this.scoresEl.replaceChildren();
    scores.forEach((s, i) => {
      const value = values[i]!;
      const color = value < 30 ? 'var(--bsx-critical-text)' : value < 55 ? 'var(--bsx-amber)' : 'var(--bsx-positive)';
      const col = el('div');
      col.style.cssText = 'display:flex;flex:0 0 auto;flex-direction:column;gap:5px;width:58px;padding:6px 5px';
      const row = el('div');
      row.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between';
      row.appendChild(el('span', { text: s.abbr, attrs: { style: 'font:700 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-micro)' } }));
      row.appendChild(el('span', { className: 'bsx-mono', text: String(value), attrs: { style: `font-size:10px;color:${color}` } }));
      const track = el('div');
      track.style.cssText = 'height:4px;border-radius:3px;background:#242c36;overflow:hidden';
      const fill = el('div');
      fill.style.cssText = `height:100%;border-radius:3px;background:${color};width:${value}%`;
      track.appendChild(fill);
      col.append(row, track);
      this.scoresEl.appendChild(col);
    });
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.weatherBtn.title = t(`hud.weather.${this.lastWeather}`);
    this.lastScoreSig = '';
  }

  dispose(): void { this.root.remove(); }
}
