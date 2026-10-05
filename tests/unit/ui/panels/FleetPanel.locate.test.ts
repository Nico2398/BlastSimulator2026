// @vitest-environment jsdom
// Fleet vehicle card Locate button uses the shared locate button (#1422)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FleetPanel } from '../../../../src/ui/panels/FleetPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';

afterEach(() => {
  delete (window as unknown as { __cameraFocus?: unknown }).__cameraFocus;
});

describe('FleetPanel — Locate button (#1422)', () => {
  it('renders a data-action=locate button on a vehicle card that focuses the camera on the vehicle', () => {
    const focus = vi.fn();
    window.__cameraFocus = focus;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new FleetPanel(container);
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.vehicles.vehicles = [{ id: 1, type: 'debris_hauler', tier: 1, x: 7, z: 9, hp: 100, payload: null, occupantIds: [] }];
    state.vehicles.nextId = 2;
    panel.update(state);

    const btn = panel.root.querySelector('[data-vehicle-id="1"] [data-action="locate"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.title).not.toBe('');
    btn.click();
    expect(focus).toHaveBeenCalledWith(7, 9, 15);
  });
});
