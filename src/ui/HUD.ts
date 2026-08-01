// BlastSimulator2026 — HUD (10.1)
// Top bar: balance, day/time, speed control, weather icon.
// Right panel: four score bars.
// Event notification badge when a pending event exists.

import { t } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import type { GameState } from '../core/state/GameState.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';

const WEATHER_ICONS: Partial<Record<WeatherState, string>> = {
  sunny: '☀️',
  cloudy: '⛅',
  light_rain: '🌦️',
  heavy_rain: '🌧️',
  storm: '⛈️',
  heat_wave: '🌡️',
  cold_snap: '❄️',
};

// Speed labels use i18n key hud.speed_x with interpolation
const SPEED_CYCLE = [1, 2, 4, 8];

/** Balance colour: gold in the black, red in the red. */
const BALANCE_COLOR_POSITIVE = '#ffd54f';
const BALANCE_COLOR_NEGATIVE = '#ff6b52';

/**
 * Format a cash amount for the top bar: whole dollars, thousands separators,
 * and the minus sign in front of the currency symbol (`-$1,234`, not
 * `$-1,234.567` — cash is a float and prints its rounding error otherwise).
 */
export function formatBalance(cash: number): string {
  const rounded = Math.round(cash);
  const magnitude = Math.abs(rounded).toLocaleString('en-US');
  return rounded < 0 ? `-$${magnitude}` : `$${magnitude}`;
}

export class HUD {
  private readonly topBar: HTMLElement;
  private readonly scoresPanel: HTMLElement;

  // Top bar elements
  private readonly balanceEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly weatherEl: HTMLElement;
  private readonly eventBadge: HTMLElement;

  // Score bar fills
  private readonly scoreFills: Record<string, HTMLElement> = {};

  private onSpeedChange?: (speed: number) => void;
  private currentSpeed = 1;
  private isPaused = false;
  /** Last weather rendered, so refreshLocale() can re-translate its tooltip. */
  private lastWeather: WeatherState = 'sunny';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    // ── Top bar ──
    this.topBar = document.createElement('div');
    this.topBar.id = 'bs-hud-top';
    this.topBar.classList.add('bs-ui');

    this.balanceEl = document.createElement('span');
    this.balanceEl.className = 'bs-balance';

    this.timeEl = document.createElement('span');
    this.timeEl.className = 'bs-time';

    this.weatherEl = document.createElement('span');
    this.weatherEl.className = 'bs-weather';
    this.locale.bindTitle(this.weatherEl, 'hud.weather.sunny');

    this.speedBtn = document.createElement('button');
    this.speedBtn.className = 'bs-speed-btn';
    this.speedBtn.textContent = t('hud.speed_x', { speed: '1' });
    this.locale.bindTitle(this.speedBtn, 'hud.speed');
    this.speedBtn.addEventListener('click', () => this.cycleSpeed());

    this.eventBadge = document.createElement('span');
    this.eventBadge.className = 'bs-event-badge';
    this.locale.bindText(this.eventBadge, 'hud.event_pending');
    this.eventBadge.style.display = 'none';

    this.topBar.append(this.balanceEl, this.timeEl, this.eventBadge, this.weatherEl, this.speedBtn);
    container.appendChild(this.topBar);

    // ── Scores panel ──
    this.scoresPanel = document.createElement('div');
    this.scoresPanel.id = 'bs-hud-scores';
    this.scoresPanel.classList.add('bs-ui', 'bs-panel');

    const scoreKeys: Array<[string, string]> = [
      ['wellBeing', 'bs-score-wellbeing'],
      ['safety', 'bs-score-safety'],
      ['ecology', 'bs-score-ecology'],
      ['nuisance', 'bs-score-nuisance'],
    ];

    for (const [key, cls] of scoreKeys) {
      const row = document.createElement('div');
      row.className = `bs-score-row ${cls}`;

      const label = document.createElement('div');
      label.className = 'bs-score-label';
      this.locale.bindText(label, `hud.scores.${key}`);

      const barBg = document.createElement('div');
      barBg.className = 'bs-score-bar-bg';
      const fill = document.createElement('div');
      fill.className = 'bs-score-bar-fill';
      fill.style.width = '50%';
      barBg.appendChild(fill);

      this.scoreFills[key] = fill;
      row.append(label, barBg);
      this.scoresPanel.appendChild(row);
    }

    container.appendChild(this.scoresPanel);
  }

  /** Update all HUD elements from current game state. */
  update(state: GameState, weather?: WeatherState): void {
    // Balance
    this.balanceEl.textContent = formatBalance(state.cash);
    this.balanceEl.style.color = state.cash < 0 ? BALANCE_COLOR_NEGATIVE : BALANCE_COLOR_POSITIVE;

    // Time — each tick is 1 in-game hour; 24 ticks = 1 day
    const day = Math.floor(state.tickCount / 24) + 1;
    const hour = state.tickCount % 24;
    this.timeEl.textContent = t('hud.time', { day, hour: String(hour).padStart(2, '0') });

    // Speed — only sync from state if the game overrides it (e.g. on load).
    // Paused is tracked separately from timeScale: `time pause` does not touch
    // timeScale, so the button previously kept showing "1x" with no visual
    // change while the sim sat fully stopped (#408).
    if (state.timeScale !== this.currentSpeed || state.isPaused !== this.isPaused) {
      this.currentSpeed = state.timeScale;
      this.isPaused = state.isPaused;
      this.speedBtn.textContent = this.isPaused
        ? t('hud.paused')
        : t('hud.speed_x', { speed: String(state.timeScale) });
      this.speedBtn.classList.toggle('bs-speed-paused', this.isPaused);
    }

    // Weather icon
    if (weather) {
      this.lastWeather = weather;
      this.weatherEl.textContent = WEATHER_ICONS[weather] ?? '☀️';
      this.weatherEl.title = t(`hud.weather.${weather}`);
    }

    // Event badge
    const hasPending = !!state.events.pendingEvent;
    this.eventBadge.style.display = hasPending ? '' : 'none';

    // Score bars
    const scores = state.scores as unknown as Record<string, number>;
    for (const key of Object.keys(this.scoreFills)) {
      const fill = this.scoreFills[key]!;
      const value = scores[key] ?? 50;
      fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    }
  }

  /** Register callback invoked when the player clicks the speed button. */
  setSpeedChangeHandler(cb: (speed: number) => void): void {
    this.onSpeedChange = cb;
  }

  /** Re-render locale-dependent text (labels, tooltips, badge) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // Written by update()/cycleSpeed() rather than the registry: both the key
    // and its interpolation depend on live state.
    this.weatherEl.title = t(`hud.weather.${this.lastWeather}`);
    this.speedBtn.textContent = this.isPaused
      ? t('hud.paused')
      : t('hud.speed_x', { speed: String(this.currentSpeed) });
  }

  dispose(): void {
    this.topBar.remove();
    this.scoresPanel.remove();
  }

  private cycleSpeed(): void {
    const idx = SPEED_CYCLE.indexOf(this.currentSpeed);
    const next = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length] ?? 1;
    this.currentSpeed = next;
    this.speedBtn.textContent = t('hud.speed_x', { speed: String(next) });
    this.onSpeedChange?.(next);
  }
}
