// @vitest-environment jsdom
// BlastSimulator2026 — PanelBase open-request counter (#1628)
//
// UIManager.showPanel hides every panel then shows the target synchronously, so a
// panel that is already open never presents a hidden frame to tutorial polling.
// PanelBase.show() therefore counts every call on root.dataset.openCount.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';
import { PANEL_OPEN_COUNT_KEY } from '../../../src/ui/panels/PanelBase.js';
import { readPanelOpenCount } from '../../../src/ui/tutorialStepHelpers.js';

describe('PanelBase open count (#1628)', () => {
  let container: HTMLElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);
  });

  afterEach(() => {
    uiManager.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  const finances = (): HTMLElement => container.querySelector('#bs-finances-panel') as HTMLElement;

  it('the dataset key is openCount', () => {
    expect(PANEL_OPEN_COUNT_KEY).toBe('openCount');
  });

  it('showPanel(finances) sets the count to 1 on first open', () => {
    uiManager.showPanel('finances');
    expect(finances().dataset[PANEL_OPEN_COUNT_KEY]).toBe('1');
  });

  it('showPanel(finances) twice in a row reports count 2 and stays visible', () => {
    uiManager.showPanel('finances');
    uiManager.showPanel('finances');
    expect(readPanelOpenCount('#bs-finances-panel')).toBe(2);
    expect(finances().style.display).not.toBe('none');
  });

  it('showPanel while the panel is already open bumps the count', () => {
    uiManager.showPanel('finances');
    const before = readPanelOpenCount('#bs-finances-panel');
    uiManager.showPanel('finances');
    expect(readPanelOpenCount('#bs-finances-panel')).toBe(before + 1);
  });

  it('hide leaves the count unchanged', () => {
    uiManager.showPanel('finances');
    uiManager.showPanel('finances');
    uiManager.closeActivePanel();
    expect(finances().style.display).toBe('none');
    expect(readPanelOpenCount('#bs-finances-panel')).toBe(2);
  });

  it('opening another panel hides finances without touching its count', () => {
    uiManager.showPanel('finances');
    uiManager.showPanel('employees');
    expect(readPanelOpenCount('#bs-finances-panel')).toBe(1);
  });

  it('counts are per panel', () => {
    uiManager.showPanel('finances');
    uiManager.showPanel('employees');
    expect(readPanelOpenCount('#bs-employee-panel')).toBe(1);
    expect(readPanelOpenCount('#bs-finances-panel')).toBe(1);
  });
});
