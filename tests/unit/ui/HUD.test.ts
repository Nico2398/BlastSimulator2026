// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { HUD } from '../../../src/ui/HUD.js';
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
});
