// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BlastPlanUI } from '../../../src/ui/BlastPlanUI.js';
import { createGame } from '../../../src/core/state/GameState.js';

function makeState() {
  const s = createGame({ seed: 1, mineType: 'desert' });
  return s;
}

describe('BlastPlanUI (10.2)', () => {
  it('renders no-holes message when no drill holes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ui = new BlastPlanUI(container);
    const state = makeState();
    state.drillHoles = [];
    ui.update(state);
    expect(container.querySelector('#bs-blast-panel')?.textContent).toContain('No');
    ui.dispose();
  });

  it('renders hole rows for each drill hole', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ui = new BlastPlanUI(container);
    const state = makeState();
    state.drillHoles = [
      { id: 'H1', x: 10, z: 10, depth: 6, radiusM: 0.075 },
      { id: 'H2', x: 15, z: 15, depth: 6, radiusM: 0.075 },
    ];
    state.chargesByHole = {};
    state.sequenceDelays = {};
    ui.update(state);
    const rows = container.querySelectorAll('.bs-hole-row');
    expect(rows.length).toBe(2);
    ui.dispose();
  });

  it('shows charge info when charge is set', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ui = new BlastPlanUI(container);
    const state = makeState();
    state.drillHoles = [{ id: 'H1', x: 10, z: 10, depth: 6, radiusM: 0.075 }];
    state.chargesByHole = { H1: { holeId: 'H1', explosiveId: 'boomite', amountKg: 5, stemmingM: 2 } };
    state.sequenceDelays = { H1: 100 };
    ui.update(state);
    const info = container.querySelector('.bs-charge-info');
    expect(info?.textContent).toContain('boomite');
    expect(info?.textContent).toContain('5');
    ui.dispose();
  });

  it('shows charge form when edit button clicked', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ui = new BlastPlanUI(container);
    const state = makeState();
    state.drillHoles = [{ id: 'H1', x: 10, z: 10, depth: 6, radiusM: 0.075 }];
    state.chargesByHole = {};
    state.sequenceDelays = {};
    ui.update(state);
    const editBtn = container.querySelector('.bs-hole-row .bs-btn') as HTMLElement;
    editBtn.click();
    const form = container.querySelector('.bs-hole-id-label');
    expect(form?.textContent).toBe('H1');
    ui.dispose();
  });

  it('calls gameConsole with charge command on apply', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ui = new BlastPlanUI(container);
    const consoleFn = vi.fn().mockReturnValue('');
    ui.setGameConsole(consoleFn);
    const state = makeState();
    state.drillHoles = [{ id: 'H1', x: 10, z: 10, depth: 6, radiusM: 0.075 }];
    state.chargesByHole = {};
    state.sequenceDelays = {};
    ui.update(state);
    (container.querySelector('.bs-hole-row .bs-btn') as HTMLElement).click();
    (container.querySelector('.bs-btn.bs-btn-primary') as HTMLElement).click();
    expect(consoleFn).toHaveBeenCalledWith(expect.stringContaining('charge hole:H1'));
    ui.dispose();
  });

  it('show/hide/visible work', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ui = new BlastPlanUI(container);
    ui.show();
    expect(ui.visible).toBe(true);
    ui.hide();
    expect(ui.visible).toBe(false);
    ui.dispose();
  });
});
