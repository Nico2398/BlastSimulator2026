// @vitest-environment jsdom
// Fleet vehicle row Locate button uses the shared locate button (#1422); Locate also selects (#1767)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FleetPanel } from '../../../../src/ui/panels/FleetPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';

afterEach(() => {
  delete (window as unknown as { __cameraFocus?: unknown }).__cameraFocus;
});

function makePanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new FleetPanel(container);
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.vehicles.vehicles = [{ id: 1, type: 'debris_hauler', tier: 1, x: 7, z: 9, hp: 100, cargo: [], occupantIds: [] }];
  state.vehicles.nextId = 2;
  panel.update(state);
  return panel;
}

const locateBtn = (panel: FleetPanel) =>
  panel.root.querySelector('[data-vehicle-id="1"] [data-action="locate"]') as HTMLButtonElement;

describe('FleetPanel — Locate button (#1422, #1767)', () => {
  it('renders a data-action=locate button on a vehicle row that focuses the camera on the vehicle', () => {
    const focus = vi.fn();
    window.__cameraFocus = focus;
    const panel = makePanel();
    const btn = locateBtn(panel);
    expect(btn).not.toBeNull();
    expect(btn.title).not.toBe('');
    btn.click();
    expect(focus).toHaveBeenCalledWith(7, 9, 15);
  });

  it('Locate also selects the vehicle, exactly once (no double select from the row click)', () => {
    window.__cameraFocus = vi.fn();
    const panel = makePanel();
    const onSelect = vi.fn();
    panel.setSelectVehicleHandler(onSelect);
    locateBtn(panel).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('Locate selects even when the camera focus hook is absent', () => {
    const panel = makePanel();
    const onSelect = vi.fn();
    panel.setSelectVehicleHandler(onSelect);
    locateBtn(panel).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('a row click that is not on Locate selects once and does not move the camera', () => {
    const focus = vi.fn();
    window.__cameraFocus = focus;
    const panel = makePanel();
    const onSelect = vi.fn();
    panel.setSelectVehicleHandler(onSelect);
    (panel.root.querySelector('[data-vehicle-id="1"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(focus).not.toHaveBeenCalled();
  });
});
