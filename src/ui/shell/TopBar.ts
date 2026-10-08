// BlastSimulator2026 — Top bar (redesign P1)
// Replaces HUD.ts. One coherent bar: balance+trend, day/clock, weather,
// speed+pause, alert pips, scores, log/saves/site-map — folding in the
// floating Saves and Return-to-Map buttons main.ts used to create ad-hoc
// (spec §5 defect: they collided with the paused/event chip).

import { iconEl } from '../icons.js';
import { el, sectionHeader, progressBar } from '../dom.js';
import { t } from '../../core/i18n/I18n.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import { forecast, rainIntensity, type WeatherState } from '../../core/weather/WeatherCycle.js';
import { computeWeatherAdvisory, type WeatherAdvisory } from '../../core/weather/WeatherAdvisory.js';
import { formatDollars } from '../../core/economy/formatMoney.js';
import { TICKS_PER_DAY } from '../../core/config/balance.js';
import { getLevelObjective } from '../../core/campaign/LevelObjective.js';
import { getOperatingSummary } from '../../core/economy/OperatingFinance.js';
import type { NotificationCenter, AlertPip } from '../notify/NotificationCenter.js';
import type { PanelName } from '../UIManager.js';
import { mountModifierChips } from './ModifierChips.js';
import { shellLayoutRegistry, type Viewport, type Rect } from './LayoutRegistry.js';
import { TOPBAR_HEIGHT_PX } from '../tokens.js';

const FORECAST_DAYS = 14;
/** Forecast reliability tiers — color-coded, never opacity-encoded (a11y). */
const OUTLOOK_TIERS: { maxDay: number; color: string }[] = [
  { maxDay: 5, color: 'var(--bsx-positive)' },
  { maxDay: 10, color: 'var(--bsx-amber)' },
  { maxDay: 14, color: 'var(--bsx-text-disabled)' },
];

function tierColorForDay(dayIndex1Based: number): string {
  return OUTLOOK_TIERS.find(tier => dayIndex1Based <= tier.maxDay)?.color ?? 'var(--bsx-text-disabled)';
}

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

const ALERT_ROUTE: Partial<Record<AlertPip['kind'], PanelName>> = {
  contract: 'contracts',
  crew: 'employees',
  fleet: 'vehicles',
  orders: 'ops',
  // The Fleet panel carries the traffic advisory banner (#1208).
  traffic: 'vehicles',
};

/**
 * Balance display: whole dollars, thousands separators, minus sign in front
 * of the currency symbol. Cash is a float and prints its rounding error
 * otherwise ("$-1,234.567").
 */
export function formatBalance(cash: number): string {
  return formatDollars(cash);
}

/** Full-width strip pinned to the top edge, TOPBAR_HEIGHT_PX tall (tokens.ts's TOPBAR_HEIGHT_PX / --bsx-topbar-height, #955/#956). */
function topBarBounds(viewport: Viewport): Rect {
  return { x: 0, y: 0, width: viewport.width, height: TOPBAR_HEIGHT_PX };
}

const OBJECTIVE_BAR_COLOR = 'var(--bsx-amber)';
const OBJECTIVE_BAR_DONE_COLOR = 'var(--bsx-positive)';

export class TopBar {
  private readonly root: HTMLElement;
  private readonly balanceWrap: HTMLButtonElement;
  private readonly balanceValue: HTMLElement;
  private readonly objectiveWrap: HTMLButtonElement;
  private readonly objectiveText: HTMLElement;
  private readonly objectiveFill: HTMLElement;
  private lastObjectiveSig: string | null = null;
  private readonly trendValue: HTMLElement;
  private readonly trendRow: HTMLElement;
  private readonly trendIcon: HTMLElement;
  private readonly dayValue: HTMLElement;
  private readonly clockValue: HTMLElement;
  private readonly weatherIcon: HTMLElement;
  private readonly weatherBtn: HTMLButtonElement;
  private readonly weatherPopoverEl: HTMLElement;
  private weatherWrapEl!: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly pauseChip: HTMLElement;
  private readonly alertPipsEl: HTMLElement;
  /** Active event modifiers with time left (#1414). */
  private readonly modifierChips: ReturnType<typeof mountModifierChips>;
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
  private lastState: GameState | undefined;
  private weatherPopoverOpen = false;
  private currentSpeed = 1;
  private isPaused = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'bs-hud-top';
    this.root.className = 'bsx-root';
    this.root.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'height:var(--bsx-topbar-height)',
      'z-index:var(--bsx-z-topbar)', 'display:flex', 'align-items:stretch',
      'background:var(--bsx-chrome)', 'border-bottom:1px solid var(--bsx-hairline-strong)',
      'pointer-events:all',
    ].join(';');

    // ── Balance ── click opens the Finances panel (P5).
    this.balanceWrap = document.createElement('button');
    this.balanceWrap.dataset['action'] = 'open-finances';
    // Structurally identical to a toolbar panel-open button (ToolRail.ts) so
    // tutorial rails allow it unconditionally as navigation, not a
    // per-panel-named exception (#1041).
    this.balanceWrap.dataset['panel'] = 'finances';
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
    this.trendRow = trendRow;
    balCol.append(this.balanceValue, trendRow);
    this.balanceWrap.appendChild(balCol);

    // ── Level objective chip ── operating profit toward the level target; click opens Finances.
    this.objectiveWrap = document.createElement('button');
    this.objectiveWrap.dataset['action'] = 'open-objective';
    this.objectiveWrap.dataset['panel'] = 'finances';
    this.objectiveWrap.style.cssText = 'display:none;flex:0 0 auto;flex-direction:column;justify-content:center;gap:4px;padding:0 16px;border:0;border-right:1px solid var(--bsx-hairline);background:transparent;cursor:pointer;font:inherit;text-align:left';
    this.objectiveWrap.addEventListener('click', () => this.onNavigate?.('finances'));
    this.objectiveText = el('span', { className: 'bsx-mono' });
    this.objectiveText.style.cssText = 'font-size:11px;white-space:nowrap';
    const bar = progressBar(0, OBJECTIVE_BAR_COLOR);
    this.objectiveFill = bar.firstElementChild as HTMLElement;
    this.objectiveWrap.append(this.objectiveText, bar);

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

    const weatherWrap = el('div');
    weatherWrap.style.cssText = 'position:relative;display:flex';
    this.weatherBtn = document.createElement('button');
    this.weatherBtn.className = 'bs-weather';
    this.weatherBtn.style.cssText = 'display:flex;align-items:center;gap:6px;height:32px;padding:0 9px;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:var(--bsx-well);color:var(--bsx-info-text);cursor:pointer';
    this.weatherIcon = iconEl('sun', 15);
    this.weatherBtn.append(this.weatherIcon, iconEl('chev', 10));
    this.weatherBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleWeatherPopover(); });
    this.weatherPopoverEl = el('div');
    // display kept out of this cssText string: a shorthand `border` combined
    // with a var() breaks jsdom's CSS parser for the whole string (not a real
    // browser issue) — set separately below so tests can rely on it.
    this.weatherPopoverEl.style.cssText = 'position:absolute;left:0;top:42px;width:340px;z-index:var(--bsx-z-popover);border-radius:7px;background:#141920;border:1px solid var(--bsx-hairline-strong);box-shadow:0 18px 44px rgba(0,0,0,.6);overflow:hidden';
    this.weatherPopoverEl.style.display = 'none';
    weatherWrap.append(this.weatherBtn, this.weatherPopoverEl);
    dayWrap.append(dayCol, weatherWrap);

    this.weatherWrapEl = weatherWrap;
    document.addEventListener('click', this.onDocumentClick);

    // ── Speed + pause ──
    const speedWrap = el('div');
    speedWrap.style.cssText = 'display:flex;flex:0 0 auto;align-items:center;padding:0 14px;gap:8px;border-right:1px solid var(--bsx-hairline)';
    const speedGroup = el('div', { className: 'bs-speed-btn' });
    speedGroup.style.cssText = 'display:flex;height:32px;border:1px solid var(--bsx-hairline-strong);border-radius:4px;overflow:hidden;background:var(--bsx-well)';
    const pauseBtn = document.createElement('button');
    pauseBtn.dataset['action'] = 'pause-toggle';
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
    // Inspect counter the tutorial reads (#1334): UI-only, never touches GameState.
    this.scoresEl.dataset['inspectCount'] = '0';
    const countInspect = (): void => {
      this.scoresEl.dataset['inspectCount'] = String(Number(this.scoresEl.dataset['inspectCount']) + 1);
    };
    this.scoresEl.addEventListener('pointerenter', countInspect);
    this.scoresEl.addEventListener('click', countInspect);

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

    this.root.append(this.balanceWrap, this.objectiveWrap, dayWrap, speedWrap, alertWrap, this.scoresEl, rightWrap);
    container.appendChild(this.root);

    shellLayoutRegistry.register({ id: 'topbar', layer: 'hud', bounds: topBarBounds });
    this.modifierChips = mountModifierChips(container);
  }

  setSpeedChangeHandler(cb: (speed: number) => void): void { this.onSpeedChange = cb; }
  setTogglePauseHandler(cb: () => void): void { this.onTogglePause = cb; }
  setNavigateHandler(cb: (panel: PanelName) => void): void { this.onNavigate = cb; }
  setOpenLogHandler(cb: () => void): void { this.onOpenLog = cb; }
  setOpenSavesHandler(cb: () => void): void { this.onOpenSaves = cb; }
  setSiteMapHandler(cb: () => void): void { this.onSiteMap = cb; }

  update(state: GameState, center: NotificationCenter): void {
    const weather = state.weather.current;
    this.lastState = state;
    // Balance + trend
    this.balanceValue.textContent = formatBalance(state.cash);
    this.balanceValue.style.color = state.cash < 0 ? 'var(--bsx-critical-text)' : 'var(--bsx-amber)';
    const { cost, net } = getOperatingSummary(state);
    this.trendRow.title = t('ui.finances.operating_cost_tip', { cost: formatDollars(Math.round(cost.total)) });
    const positive = net >= 0;
    this.trendValue.textContent = `${positive ? '+' : '-'}$${Math.round(Math.abs(net)).toLocaleString('en-US')}/h`;
    this.trendValue.style.color = positive ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';
    this.trendIcon.setAttribute('name', positive ? 'up' : 'down');
    this.trendIcon.style.color = positive ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';

    this.updateObjective(state);

    // Day / clock
    const day = Math.floor(state.tickCount / TICKS_PER_DAY) + 1;
    const hour = state.tickCount % TICKS_PER_DAY;
    this.dayValue.textContent = t('shell.topbar.day', { day });
    this.clockValue.textContent = `${String(hour).padStart(2, '0')}:00`;

    // Weather
    this.lastWeather = weather;
    this.weatherIcon.setAttribute('name', WEATHER_ICON[weather] ?? 'sun');
    this.weatherBtn.title = t(`hud.weather.${weather}`);
    if (this.weatherPopoverOpen) this.renderWeatherPopover();

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

    this.modifierChips.update(state.events.activeModifiers, state.tickCount);

    // Alert pips
    const pips = center.update(state);
    this.alertPipsEl.replaceChildren();
    for (const pip of pips) {
      const btn = document.createElement('button');
      if (pip.kind === 'event') btn.classList.add('bs-event-badge');
      const tone = pip.tone === 'critical'
        ? { bg: 'rgba(255,91,76,.14)', border: 'rgba(255,91,76,.45)', fg: 'var(--bsx-critical-text)' }
        : pip.tone === 'neutral'
        ? { bg: 'rgba(160,170,185,.10)', border: 'rgba(160,170,185,.30)', fg: 'var(--bsx-info)' }
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

  // ── Weather popover ──

  private readonly onDocumentClick = (e: MouseEvent): void => {
    if (!this.weatherPopoverOpen) return;
    if (this.weatherWrapEl.contains(e.target as Node)) return;
    this.closeWeatherPopover();
  };

  private toggleWeatherPopover(): void {
    if (this.weatherPopoverOpen) this.closeWeatherPopover();
    else this.openWeatherPopover();
  }

  private openWeatherPopover(): void {
    this.weatherPopoverOpen = true;
    this.weatherPopoverEl.style.display = 'block';
    this.renderWeatherPopover();
  }

  private closeWeatherPopover(): void {
    this.weatherPopoverOpen = false;
    this.weatherPopoverEl.style.display = 'none';
  }

  /**
   * forecast() and computeWeatherAdvisory() are cheap (a few hundred
   * arithmetic steps) — recomputing on every render while the popover is
   * open, rather than caching, keeps this in step with update() without a
   * second invalidation path to get wrong.
   */
  private renderWeatherPopover(): void {
    const state = this.lastState;
    if (!state) {
      this.weatherPopoverEl.replaceChildren(el('div', {
        text: t('ui.weather.no_data'),
        attrs: { style: 'padding:16px;font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
      }));
      return;
    }

    const cycle = state.weather;
    const days = forecast(cycle, FORECAST_DAYS);
    const advisory = computeWeatherAdvisory(state, cycle.current, days);
    const today = Math.floor(state.tickCount / TICKS_PER_DAY) + 1;

    const header = el('div', { attrs: { style: 'display:flex;align-items:center;gap:9px;padding:12px 13px;border-bottom:1px solid var(--bsx-hairline)' } });
    header.append(
      el('div', { attrs: { style: 'color:var(--bsx-info)' }, children: [iconEl(WEATHER_ICON[cycle.current] ?? 'sun', 17)] }),
      el('div', {
        attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' },
        children: [
          el('span', { text: t(`hud.weather.${cycle.current}`), attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.1em' } }),
          el('span', { text: t(`ui.weather.effect.${cycle.current}`), attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }),
        ],
      }),
    );

    const body = el('div', { attrs: { style: 'padding:12px 13px;display:flex;flex-direction:column;gap:9px' } });
    body.appendChild(sectionHeader(t('ui.weather.outlook')));

    const strip = el('div', { attrs: { style: 'display:flex;gap:2px' } });
    days.forEach((dayWeather, i) => {
      const dayNum = today + i + 1;
      const color = tierColorForDay(i + 1);
      const wetPct = Math.round(rainIntensity(dayWeather) * 100);
      const cell = el('div', {
        attrs: {
          style: `flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:7px 1px;border:1px solid ${color};border-radius:4px;background:color-mix(in srgb, ${color} 12%, transparent)`,
          title: `${t('shell.topbar.day', { day: dayNum })}: ${t(`hud.weather.${dayWeather}`)}`,
        },
      });
      cell.append(
        el('span', { text: String(dayNum), className: 'bsx-mono', attrs: { style: `font-size:10px;color:${color}` } }),
        el('div', { attrs: { style: 'color:var(--bsx-text-secondary)' }, children: [iconEl(WEATHER_ICON[dayWeather] ?? 'sun', 16)] }),
        el('div', {
          attrs: { style: 'width:14px;height:3px;border-radius:2px;overflow:hidden;background:rgba(255,255,255,.09)' },
          children: [el('div', { attrs: { style: `height:100%;background:var(--bsx-info);width:${wetPct}%` } })],
        }),
      );
      strip.appendChild(cell);
    });
    body.appendChild(strip);

    const bandsRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:14px' } });
    const bands: [string, string][] = [
      [t('ui.weather.band_reliable'), 'var(--bsx-positive)'],
      [t('ui.weather.band_indicative'), 'var(--bsx-amber)'],
      [t('ui.weather.band_guesswork'), 'var(--bsx-text-disabled)'],
    ];
    for (const [label, color] of bands) {
      bandsRow.appendChild(el('div', {
        attrs: { style: 'display:flex;align-items:baseline;gap:5px' },
        children: [
          el('span', { text: label, attrs: { style: `font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:${color}` } }),
        ],
      }));
    }
    bandsRow.appendChild(el('span', {
      attrs: { style: 'margin-left:auto;display:flex;align-items:center;gap:5px' },
      children: [
        el('span', { attrs: { style: 'width:14px;height:3px;border-radius:2px;background:var(--bsx-info)' } }),
        el('span', { text: t('ui.weather.flood_risk'), attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);letter-spacing:.08em;color:var(--bsx-text-micro)' } }),
      ],
    }));
    body.appendChild(bandsRow);

    body.appendChild(el('div', {
      attrs: { style: 'display:flex;gap:9px;padding:10px 11px;border-radius:5px;background:rgba(85,168,255,.07);border:1px solid rgba(85,168,255,.24)' },
      children: [
        el('div', { attrs: { style: 'color:var(--bsx-info);padding-top:1px' }, children: [iconEl('water', 14)] }),
        el('span', { text: this.advisoryText(advisory), attrs: { style: 'font:400 11px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' } }),
      ],
    }));

    this.weatherPopoverEl.replaceChildren(header, body);
  }

  private advisoryText(advisory: WeatherAdvisory): string {
    switch (advisory.kind) {
      case 'clear':
        return t('ui.weather.advisory_clear');
      case 'wet':
        return advisory.daysUntilChange !== null
          ? t('ui.weather.advisory_wet_clearing', { uncovered: advisory.uncoveredHoles, days: advisory.daysUntilChange })
          : t('ui.weather.advisory_wet_indefinite', { uncovered: advisory.uncoveredHoles });
      case 'rain_incoming':
        return t('ui.weather.advisory_rain_incoming', { days: advisory.daysUntilChange ?? 0, duration: advisory.consecutiveWetDays });
    }
  }

  private updateObjective(state: GameState): void {
    const objective = getLevelObjective(state.campaign.activeLevelId, state.finances);
    const pct = objective ? Math.round(objective.fraction * 100) : 0;
    const sig = objective ? `${Math.round(objective.profit)}|${objective.target}|${pct}` : '';
    if (sig === this.lastObjectiveSig) return;
    this.lastObjectiveSig = sig;
    if (!objective) { this.objectiveWrap.style.display = 'none'; return; }
    const profit = Math.round(objective.profit);
    this.objectiveWrap.style.display = 'flex';
    this.objectiveWrap.title = t('ui.finances.operating_profit_tip', { target: formatDollars(objective.target) });
    this.objectiveText.textContent = t('shell.topbar.objective', { profit: formatDollars(profit), target: formatDollars(objective.target) });
    this.objectiveFill.style.width = `${pct}%`;
    this.objectiveFill.style.background = objective.fraction >= 1 ? OBJECTIVE_BAR_DONE_COLOR : OBJECTIVE_BAR_COLOR;
  }

  private lastScoreSig = '';
  private lastScoreState: GameState | undefined;
  private updateScores(state: GameState): void {
    this.lastScoreState = state;
    const scores = [
      { key: 'wellBeing', abbr: t('shell.topbar.score_well'), tipKey: 'shell.topbar.score_well_tip' },
      { key: 'safety', abbr: t('shell.topbar.score_safe'), tipKey: 'shell.topbar.score_safe_tip' },
      { key: 'ecology', abbr: t('shell.topbar.score_eco'), tipKey: 'shell.topbar.score_eco_tip' },
      // nuisance = neighbour relations: high = good, like the other three.
      { key: 'nuisance', abbr: t('shell.topbar.score_nuis'), tipKey: 'shell.topbar.score_nuis_tip' },
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
      col.title = t(s.tipKey);
      col.style.cssText = 'display:flex;flex:0 0 auto;flex-direction:column;gap:5px;width:58px;padding:6px 5px';
      const row = el('div');
      row.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between';
      row.appendChild(el('span', { text: s.abbr, attrs: { style: 'font:700 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-micro)' } }));
      row.appendChild(el('span', { className: 'bsx-mono', text: String(value), attrs: { style: `font-size:10px;color:${color}` } }));
      const track = el('div');
      track.style.cssText = 'height:4px;border-radius:3px;overflow:hidden;background:#242c36';
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
    this.lastObjectiveSig = '';
    if (this.lastScoreState) this.updateScores(this.lastScoreState);
    if (this.weatherPopoverOpen) this.renderWeatherPopover();
  }

  /** Hidden pre-game (redesign P8) — this is HUD chrome, nothing to show before a level exists. */
  show(): void { this.root.style.display = 'flex'; }
  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }

  dispose(): void {
    document.removeEventListener('click', this.onDocumentClick);
    this.root.remove();
    shellLayoutRegistry.unregister('topbar');
    this.modifierChips.dispose();
  }
}
