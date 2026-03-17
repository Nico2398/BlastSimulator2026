// BlastSimulator2026 — HUD (10.1)
// Top bar: balance, day/time, speed control, weather icon.
// Right panel: four score bars.
// Event notification badge when a pending event exists.

import { t } from '../core/i18n/I18n.js';
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

const SPEED_LABELS: Record<number, string> = { 1: '1×', 2: '2×', 4: '4×', 8: '8×' };
const SPEED_CYCLE = [1, 2, 4, 8];

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
    this.weatherEl.title = t('hud.weather.sunny');

    this.speedBtn = document.createElement('button');
    this.speedBtn.className = 'bs-speed-btn';
    this.speedBtn.textContent = '1×';
    this.speedBtn.title = t('hud.speed');
    this.speedBtn.addEventListener('click', () => this.cycleSpeed());

    this.eventBadge = document.createElement('span');
    this.eventBadge.className = 'bs-event-badge';
    this.eventBadge.textContent = t('hud.event_pending');
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
      label.textContent = t(`hud.scores.${key}`);

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
    this.balanceEl.textContent = `$${state.cash.toLocaleString()}`;

    // Time — each tick is 1 in-game hour; 24 ticks = 1 day
    const day = Math.floor(state.tickCount / 24) + 1;
    const hour = state.tickCount % 24;
    this.timeEl.textContent = t('hud.time', { day, hour: String(hour).padStart(2, '0') });

    // Speed
    this.currentSpeed = state.timeScale;
    this.speedBtn.textContent = SPEED_LABELS[state.timeScale] ?? `${state.timeScale}×`;

    // Weather icon
    if (weather) {
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

  dispose(): void {
    this.topBar.remove();
    this.scoresPanel.remove();
  }

  private cycleSpeed(): void {
    const idx = SPEED_CYCLE.indexOf(this.currentSpeed);
    const next = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length] ?? 1;
    this.currentSpeed = next;
    this.onSpeedChange?.(next);
  }
}
