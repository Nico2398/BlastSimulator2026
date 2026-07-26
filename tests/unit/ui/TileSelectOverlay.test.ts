// @vitest-environment jsdom
// BlastSimulator2026 — Tile picker, with the tutorial's required-area constraint
//
// The grid tool would otherwise happily lay a blast pattern anywhere on the map
// while the tutorial believed it was teaching a specific placement.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TileSelectOverlay } from '../../../src/ui/TileSelectOverlay.js';
import type { TileSelectResult } from '../../../src/ui/TileSelectOverlay.js';
import { setPickerRegion } from '../../../src/ui/tutorialPickerRegion.js';

const CANVAS_W = 640;
const CANVAS_H = 480;
const WORLD = 24;
const AREA = { x1: 8, z1: 8, x2: 16, z2: 16 };

function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const overlay = new TileSelectOverlay(container);
  const canvas = container.querySelector('.bs-tile-select-canvas') as HTMLCanvasElement;
  // jsdom lays nothing out; give the canvas its natural box so tile maths works.
  canvas.getBoundingClientRect = () => ({
    width: CANVAS_W, height: CANVAS_H, top: 0, left: 0,
    right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect;
  return { container, overlay, canvas };
}

/** Centre of a tile in canvas pixels. */
function pointFor(x: number, z: number) {
  return {
    clientX: (x + 0.5) * (CANVAS_W / WORLD),
    clientY: (z + 0.5) * (CANVAS_H / WORLD),
  };
}

function pick(canvas: HTMLCanvasElement, x: number, z: number): void {
  const at = pointFor(x, z);
  canvas.dispatchEvent(new MouseEvent('mousedown', { ...at, button: 0, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent('mouseup', { ...at, button: 0, bubbles: true }));
}

function drag(canvas: HTMLCanvasElement, x1: number, z1: number, x2: number, z2: number): void {
  canvas.dispatchEvent(new MouseEvent('mousedown', { ...pointFor(x1, z1), button: 0, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent('mouseup', { ...pointFor(x2, z2), button: 0, bubbles: true }));
}

function confirmBtn(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('#bs-tile-select-confirm') as HTMLButtonElement;
}

function infoText(container: HTMLElement): string {
  return container.querySelector('.bs-tile-select-info')?.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
  setPickerRegion(null);
});

describe('TileSelectOverlay — unconstrained', () => {
  it('starts with Confirm disabled and enables it on a pick', () => {
    const { container, overlay, canvas } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    expect(confirmBtn(container).disabled).toBe(true);
    pick(canvas, 3, 3);
    expect(confirmBtn(container).disabled).toBe(false);
    expect(infoText(container)).toContain('(3, 3)');
  });

  it('confirms the picked tile', () => {
    const { container, overlay, canvas } = setup();
    const onConfirm = vi.fn<(r: TileSelectResult) => void>();
    overlay.open({ mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm });

    pick(canvas, 5, 7);
    confirmBtn(container).click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ x: 5, z: 7 });
  });

  it('confirms a dragged area', () => {
    const { container, overlay, canvas } = setup();
    const onConfirm = vi.fn<(r: TileSelectResult) => void>();
    overlay.open({ mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm });

    drag(canvas, 2, 2, 6, 5);
    confirmBtn(container).click();

    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ x: 2, z: 2, x2: 6, z2: 5 });
  });
});

describe('TileSelectOverlay — required area', () => {
  it('takes the area the tutorial published when the caller gives none', () => {
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    pick(canvas, 2, 2);
    expect(confirmBtn(container).disabled).toBe(true);
  });

  it('enables Confirm for a pick inside the area', () => {
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    pick(canvas, 12, 12);
    expect(confirmBtn(container).disabled).toBe(false);
  });

  it('says why Confirm is dead instead of leaving the player prodding it', () => {
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    pick(canvas, 2, 2);
    expect(infoText(container)).toContain('Outside');
  });

  it('rejects a drag that starts inside the area and runs out of it', () => {
    // The grid-tool case: begin in the pit, finish in a corner of the map the
    // step knows nothing about.
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    overlay.open({
      mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    drag(canvas, 10, 10, 22, 22);
    expect(confirmBtn(container).disabled).toBe(true);
  });

  it('accepts a drag wholly inside the area', () => {
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    const onConfirm = vi.fn<(r: TileSelectResult) => void>();
    overlay.open({ mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm });

    drag(canvas, 9, 9, 15, 15);
    confirmBtn(container).click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not confirm an out-of-area selection even if the button is forced', () => {
    // Belt and braces: the disabled button is the affordance, not the guarantee.
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    const onConfirm = vi.fn<(r: TileSelectResult) => void>();
    overlay.open({ mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm });

    drag(canvas, 0, 0, 3, 3);
    const btn = confirmBtn(container);
    btn.disabled = false;
    btn.click();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('tells the player to stay inside the area in the hint line', () => {
    setPickerRegion(AREA);
    const { container, overlay } = setup();
    overlay.open({
      mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    expect(container.querySelector('.bs-tile-select-hint')?.textContent)
      .toContain('highlighted area');
  });

  it('an explicit region on the config beats whatever the tutorial published', () => {
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x',
      requiredRegion: { x1: 0, z1: 0, x2: 4, z2: 4 },
      onConfirm: () => {},
    });

    pick(canvas, 2, 2);
    expect(confirmBtn(container).disabled).toBe(false);
  });

  it('an explicit null on the config lifts the tutorial constraint', () => {
    setPickerRegion(AREA);
    const { container, overlay, canvas } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x',
      requiredRegion: null,
      onConfirm: () => {},
    });

    pick(canvas, 2, 2);
    expect(confirmBtn(container).disabled).toBe(false);
  });

  it('lifting the region between openings restores free placement', () => {
    const { container, overlay, canvas } = setup();
    setPickerRegion(AREA);
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });
    pick(canvas, 2, 2);
    expect(confirmBtn(container).disabled).toBe(true);

    overlay.close();
    setPickerRegion(null);
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });
    pick(canvas, 2, 2);
    expect(confirmBtn(container).disabled).toBe(false);
  });
});
