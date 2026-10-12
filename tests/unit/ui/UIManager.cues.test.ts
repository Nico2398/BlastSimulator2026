// @vitest-environment jsdom
// BlastSimulator2026 — UIManager interface cues: panels sliding in and out are voiced at the one chokepoint
// (showPanel / hideAllPanels), whichever route opened them (rail, shortcut, Escape, panel buttons).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';

let container: HTMLElement;
let ui: UIManager;
let panelShown: ReturnType<typeof vi.fn<[boolean], void>>;
let notification: ReturnType<typeof vi.fn>;
let modalShown: ReturnType<typeof vi.fn>;
let volumeAdjusted: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom has no canvas backend; the minimap only needs a context to draw, which these tests never do.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  container = document.createElement('div');
  document.body.appendChild(container);
  ui = new UIManager(container);
  panelShown = vi.fn<[boolean], void>();
  notification = vi.fn();
  modalShown = vi.fn();
  volumeAdjusted = vi.fn();
  ui.setUiCues({ panelShown, notification, modalShown, volumeAdjusted });
});

afterEach(() => {
  ui.dispose();
  container.remove();
  vi.restoreAllMocks();
});

describe('UIManager panel cues', () => {
  it('plays one open cue when a panel opens', () => {
    ui.showPanel('contracts');
    expect(panelShown.mock.calls).toEqual([[true]]);
  });

  it('plays one close cue when the open panel closes, by any route', () => {
    ui.showPanel('contracts');
    panelShown.mockClear();
    ui.closeActivePanel();
    expect(panelShown.mock.calls).toEqual([[false]]);

    ui.showPanel('finances');
    panelShown.mockClear();
    ui.handleEscape();
    expect(panelShown.mock.calls).toEqual([[false]]);
  });

  it('switching from one panel to another is a single open, not a close and an open', () => {
    ui.showPanel('contracts');
    panelShown.mockClear();
    ui.showPanel('finances');
    expect(panelShown.mock.calls).toEqual([[true]]);
  });

  it('closing with nothing open plays nothing', () => {
    ui.closeActivePanel();
    ui.handleEscape();
    expect(panelShown).not.toHaveBeenCalled();
  });

  it('toggling opens, then closes', () => {
    ui.togglePanel('ops');
    ui.togglePanel('ops');
    expect(panelShown.mock.calls).toEqual([[true], [false]]);
  });

  it('toggling to a different panel is one open', () => {
    ui.togglePanel('ops');
    panelShown.mockClear();
    ui.togglePanel('build');
    expect(panelShown.mock.calls).toEqual([[true]]);
  });

  it('re-showing the open panel is not a change of panel and plays nothing', () => {
    ui.showPanel('ops');
    panelShown.mockClear();
    ui.showPanel('ops');
    expect(panelShown).not.toHaveBeenCalled();
  });

  it('a panel that closes itself (its X button) plays the close cue', () => {
    ui.showPanel('ops');
    panelShown.mockClear();
    (container.querySelector('#bs-operations-panel [data-panel-close]') as HTMLElement).click();
    expect(panelShown.mock.calls).toEqual([[false]]);
  });

  it('is silent with no cues set or after they are removed', () => {
    ui.setUiCues(null);
    expect(() => { ui.showPanel('ops'); ui.closeActivePanel(); }).not.toThrow();
    expect(panelShown).not.toHaveBeenCalled();
  });
});

describe('UIManager cue forwarding', () => {
  it('voices notifications through the cues', () => {
    ui.notify({ severity: 'critical', title: 'T', body: '' });
    expect(notification).toHaveBeenCalledWith('critical');
  });

  it('voices the confirm modal through the cues', () => {
    ui.showConfirm({ icon: 'warn', title: 'T', body: 'B', confirmLabel: 'Yes', onConfirm: () => {} });
    expect(modalShown).toHaveBeenCalledTimes(1);
  });

  it('forwards the cues to the settings sliders', () => {
    ui.showPanel('settings');
    const slider = container.querySelector('#bs-settings-panel input[type="range"]') as HTMLInputElement;
    slider.dispatchEvent(new Event('input'));
    expect(volumeAdjusted).toHaveBeenCalledWith('master');
  });
});
