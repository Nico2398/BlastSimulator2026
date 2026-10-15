// @vitest-environment jsdom
// BlastSimulator2026 — one real mouse click on a tool rail button is handled once (#1750).
//
// A real click fires pointerdown/mousedown/pointerup/mouseup/click with
// MouseEvent.detail = 1; a double-click fires a second click with detail 2.
// The rail must treat the repeat click of one gesture (detail > 1) as noise so
// the panel the first click opened is not toggled shut again. detail 0
// (keyboard Enter/Space or a synthetic .click()) always toggles.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager, type PanelName } from '../../../../src/ui/UIManager.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { setupEvents } from '../../../../src/core/events/index.js';

setupEvents();

const PANEL_IDS: Record<string, string> = {
  blast: 'bs-blast-panel',
  survey: 'bs-survey-panel',
  contracts: 'bs-contract-panel',
  ops: 'bs-operations-panel',
  build: 'bs-build-panel',
  vehicles: 'bs-vehicle-panel',
  employees: 'bs-employee-panel',
  shady: 'bs-shady-panel',
  settings: 'bs-settings-panel',
};
const ENTRIES = Object.keys(PANEL_IDS);

function rail(panel: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`#bs-toolbar button[data-panel="${panel}"]`)!;
}
function panelEl(panel: string): HTMLElement {
  return document.getElementById(PANEL_IDS[panel]!)!;
}
function isOpen(panel: string): boolean {
  const el = panelEl(panel);
  return !!el && el.style.display !== 'none';
}

function fire(btn: HTMLElement, type: string, detail = 0): void {
  const Ctor = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  btn.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, detail, button: 0 }));
}
/** The events a real left click produces, in browser order; click carries detail = click count. */
function realClick(btn: HTMLElement, detail = 1): void {
  fire(btn, 'pointerdown', detail);
  fire(btn, 'mousedown', detail);
  fire(btn, 'pointerup', detail);
  fire(btn, 'mouseup', detail);
  fire(btn, 'click', detail);
}
/** Second half of a double-click: the browser sends the full sequence again with detail 2. */
function doubleClick(btn: HTMLElement): void {
  realClick(btn, 1);
  realClick(btn, 2);
}

describe('ToolRail — one real click is handled once (#1750)', () => {
  let container: HTMLElement;
  let ui: UIManager;
  let toggle: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom has no 2d canvas; the MiniMap draws on every update().
    const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    container = document.createElement('div');
    document.body.appendChild(container);
    ui = new UIManager(container);
    toggle = vi.spyOn(ui, 'togglePanel');
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.corruption.level = 1; // reveals the shady entry
    ui.update(state);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    ui.dispose();
    container.remove();
  });

  it('every rail entry is present, including the revealed shady one', () => {
    for (const p of ENTRIES) expect(rail(p), p).not.toBeNull();
    expect(rail('shady').style.display).toBe('flex');
  });

  for (const p of ENTRIES) {
    it(`a full real click on ${p} toggles once and leaves the panel open and pressed`, () => {
      realClick(rail(p));
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(toggle).toHaveBeenCalledWith(p as PanelName);
      expect(isOpen(p)).toBe(true);
      expect(rail(p).getAttribute('aria-pressed')).toBe('true');
    });

    it(`a double-click on ${p} leaves the panel open (the repeat click is ignored)`, () => {
      doubleClick(rail(p));
      expect(isOpen(p)).toBe(true);
      expect(rail(p).getAttribute('aria-pressed')).toBe('true');
      expect(toggle).toHaveBeenCalledTimes(1);
    });
  }

  it('a triple click (detail 3) is also ignored after the opening click', () => {
    realClick(rail('blast'), 1);
    realClick(rail('blast'), 2);
    realClick(rail('blast'), 3);
    expect(isOpen('blast')).toBe(true);
  });

  it('a second, separate detail-1 click closes the panel', () => {
    realClick(rail('build'), 1);
    expect(isOpen('build')).toBe(true);
    realClick(rail('build'), 1);
    expect(isOpen('build')).toBe(false);
    expect(rail('build').getAttribute('aria-pressed')).toBe('false');
  });

  it('detail 0 clicks (keyboard / synthetic) toggle open then closed', () => {
    rail('survey').click();
    expect(isOpen('survey')).toBe(true);
    rail('survey').click();
    expect(isOpen('survey')).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('two detail-0 clicks in a row are two toggles, never collapsed', () => {
    rail('ops').click();
    rail('ops').click();
    rail('ops').click();
    expect(isOpen('ops')).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(3);
  });

  it('Escape closes a panel opened by a real click', () => {
    realClick(rail('contracts'));
    expect(isOpen('contracts')).toBe(true);
    ui.handleEscape();
    expect(isOpen('contracts')).toBe(false);
  });

  it('the panel close control closes a panel opened by a real click', () => {
    realClick(rail('vehicles'));
    const close = panelEl('vehicles').querySelector<HTMLElement>('[data-panel-close]')!;
    expect(close).not.toBeNull();
    close.click();
    expect(isOpen('vehicles')).toBe(false);
  });

  it('switching panels by real clicks keeps only the last one open', () => {
    realClick(rail('blast'));
    realClick(rail('employees'));
    expect(isOpen('blast')).toBe(false);
    expect(isOpen('employees')).toBe(true);
  });

  for (const paused of [true, false]) {
    it(`a double-click leaves the panel open while the game is ${paused ? 'paused' : 'running'}`, () => {
      const state = createGame({ seed: 1, mineType: 'desert' });
      state.isPaused = paused;
      ui.update(state);
      doubleClick(rail('settings'));
      expect(isOpen('settings')).toBe(true);
      ui.update(state);
      expect(isOpen('settings')).toBe(true);
    });
  }

  it('the button is not the focused element after a real mouse click', () => {
    const btn = rail('blast');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    realClick(btn);
    expect(document.activeElement).not.toBe(btn);
  });

  it('the button keeps focus after a keyboard (detail 0) click', () => {
    const btn = rail('blast');
    btn.focus();
    btn.click();
    expect(document.activeElement).toBe(btn);
  });
});
