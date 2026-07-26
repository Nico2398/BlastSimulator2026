// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial rails, stateful half

import { describe, it, expect, beforeEach } from 'vitest';
import { TutorialRails } from '../../../src/ui/tutorialRails.js';
import { ALLOWED_CLASS, HIGHLIGHT_CLASS, DEFAULT_TICK_BUDGET } from '../../../src/ui/tutorialGuide.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function withBox(el: HTMLElement): HTMLElement {
  el.getBoundingClientRect = () => ({
    width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  return el;
}

/** Stand in for the toolbar button the hire steps point at first. */
function toolbarCrew(): HTMLElement {
  const bar = document.createElement('div');
  bar.id = 'bs-toolbar';
  const btn = document.createElement('button');
  btn.dataset['panel'] = 'employees';
  bar.appendChild(btn);
  document.body.appendChild(bar);
  return withBox(btn);
}

/** Stand in for the Hire button inside the Crew panel. */
function hireSurveyor(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'bs-employee-panel';
  const btn = document.createElement('button');
  btn.dataset['role'] = 'surveyor';
  panel.appendChild(btn);
  document.body.appendChild(panel);
  return withBox(btn);
}

function state(): GameState {
  return createGame({ seed: 42, mineType: 'desert' });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('TutorialRails', () => {
  it('points at the panel opener while the panel is closed', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());

    const view = rails.refresh();
    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(view.stageIndex).toBe(0);
    expect(view.stageTotal).toBe(2);
    expect(view.hint).toContain('(1/2)');
  });

  it('moves to the button inside the panel once it is open', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    const hire = hireSurveyor();
    const view = rails.refresh();

    expect(hire.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    expect(view.stageIndex).toBe(1);
    expect(view.hint).toContain('(2/2)');
  });

  it('omits the counter for a single-stage step', () => {
    const bar = document.createElement('div');
    bar.id = 'bs-hud-top';
    const btn = document.createElement('button');
    btn.className = 'bs-speed-btn';
    bar.appendChild(btn);
    document.body.appendChild(bar);
    withBox(btn);

    const rails = new TutorialRails();
    rails.beginStep({ id: 'time-speed' }, state());
    expect(rails.refresh().hint).not.toContain('/');
  });

  it('clears the rails for a step with nothing to point at', () => {
    const stray = withBox(document.createElement('button'));
    stray.classList.add(ALLOWED_CLASS);
    document.body.appendChild(stray);

    const rails = new TutorialRails();
    rails.beginStep({ id: 'congratulations' }, state());
    const view = rails.refresh();

    expect(view.hint).toBe('');
    expect(stray.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  it('starts a step with the clock running', () => {
    const s = state();
    s.isPaused = true;
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);
    expect(s.isPaused).toBe(false);
  });

  it('holds the clock once the step spends its allowance', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);

    s.tickCount = DEFAULT_TICK_BUDGET;
    expect(rails.updateClock(s)).toBe(true);
    expect(s.isPaused).toBe(true);
    expect(rails.clockHeld).toBe(true);
  });

  it('counts the allowance from the tick the step began', () => {
    const s = state();
    s.tickCount = 500;
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);

    s.tickCount = 505;
    expect(rails.updateClock(s)).toBe(false);
    expect(s.isPaused).toBe(false);
  });

  it('honours a step that asks for a longer allowance', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor', tickBudget: 40 }, s);

    s.tickCount = 30;
    expect(rails.updateClock(s)).toBe(false);
  });

  it('lets the clock go again when the step moves on', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);
    s.tickCount = DEFAULT_TICK_BUDGET;
    rails.updateClock(s);
    expect(s.isPaused).toBe(true);

    rails.beginStep({ id: 'survey' }, s);
    expect(s.isPaused).toBe(false);
    expect(rails.clockHeld).toBe(false);
  });

  it('does not touch a game that is not there', () => {
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, null);
    expect(() => rails.updateClock(null)).not.toThrow();
    expect(rails.updateClock(null)).toBe(false);
  });

  it('clear() drops the marks and the stage list', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    rails.clear();

    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    expect(rails.progress.total).toBe(0);
    expect(rails.clockHeld).toBe(false);
  });
});
