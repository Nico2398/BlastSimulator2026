// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { HUD, formatBalance } from '../../../src/ui/HUD.js';
import { createGame } from '../../../src/core/state/GameState.js';

function makeState() {
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.cash = 75000;
  s.tickCount = 50;
  s.timeScale = 2;
  return s;
}

describe('HUD (10.1)', () => {
  it('renders balance from GameState', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    hud.update(makeState());
    expect(container.querySelector('.bs-balance')?.textContent).toContain('75');
    hud.dispose();
  });

  it('renders time string', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    hud.update(makeState());
    const timeText = container.querySelector('.bs-time')?.textContent ?? '';
    // Day 3 (50/24 = 2.08 → day 3), hour 2 (50 % 24 = 2)
    expect(timeText).toContain('3');
    hud.dispose();
  });

  it('speed button shows current timeScale', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    hud.update(makeState());
    expect(container.querySelector('.bs-speed-btn')?.textContent).toBe('2×');
    hud.dispose();
  });

  it('speed button cycles speed on click', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    const state = makeState();
    state.timeScale = 1;
    hud.update(state);
    const callback = vi.fn();
    hud.setSpeedChangeHandler(callback);
    (container.querySelector('.bs-speed-btn') as HTMLElement).click();
    expect(callback).toHaveBeenCalledWith(2);
    hud.dispose();
  });

  it('score bars reflect GameState scores', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    const state = makeState();
    state.scores.safety = 80;
    hud.update(state);
    const fills = container.querySelectorAll('.bs-score-bar-fill');
    // At least one fill should have 80% width
    const widths = Array.from(fills).map(el => (el as HTMLElement).style.width);
    expect(widths).toContain('80%');
    hud.dispose();
  });

  it('event badge hidden when no pending event', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    const state = makeState();
    state.events.pendingEvent = null;
    hud.update(state);
    const badge = container.querySelector('.bs-event-badge') as HTMLElement;
    expect(badge.style.display).toBe('none');
    hud.dispose();
  });

  it('event badge visible when pending event exists', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    const state = makeState();
    state.events.pendingEvent = { eventId: 'test_event', firedAtTick: 1 };
    hud.update(state);
    const badge = container.querySelector('.bs-event-badge') as HTMLElement;
    expect(badge.style.display).not.toBe('none');
    hud.dispose();
  });

  it('weather icon updates', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new HUD(container);
    hud.update(makeState(), 'storm');
    const icon = container.querySelector('.bs-weather')?.textContent ?? '';
    expect(icon).toBe('⛈️');
    hud.dispose();
  });

  describe('balance formatting', () => {
    it('prints whole dollars with thousands separators', () => {
      expect(formatBalance(75000)).toBe('$75,000');
    });

    it('drops the float rounding tail instead of printing cents', () => {
      // Cash is a float; toLocaleString would render this as "$-37,799.853".
      expect(formatBalance(-37799.853)).toBe('-$37,800');
    });

    it('puts the minus sign in front of the currency symbol', () => {
      expect(formatBalance(-1234)).toBe('-$1,234');
    });

    it('renders zero without a sign', () => {
      expect(formatBalance(0)).toBe('$0');
    });

    it('colours a negative balance red in the HUD', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const hud = new HUD(container);
      const state = makeState();
      state.cash = -500.4;
      hud.update(state);
      const el = container.querySelector('.bs-balance') as HTMLElement;
      expect(el.textContent).toBe('-$500');
      expect(el.style.color).not.toBe('');
      const negative = el.style.color;
      state.cash = 500;
      hud.update(state);
      expect(el.style.color).not.toBe(negative);
      hud.dispose();
    });
  });
});
