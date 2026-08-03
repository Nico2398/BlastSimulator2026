// @vitest-environment jsdom
// BlastSimulator2026 — Tile picker, with the tutorial's required-area constraint
//
// The grid tool would otherwise happily lay a blast pattern anywhere on the map
// while the tutorial believed it was teaching a specific placement.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TileSelectOverlay } from '../../../src/ui/TileSelectOverlay.js';
import type { TileSelectResult } from '../../../src/ui/TileSelectOverlay.js';
import { setPickerRegion } from '../../../src/ui/tutorialPickerRegion.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

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

describe('TileSelectOverlay — canvas grows to keep tiles ≥4px on large levels (#458 T6.1/D13)', () => {
  it('keeps the base 640×480 canvas for a level that already clears the 4px floor', () => {
    const { overlay, canvas } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });
    expect(canvas.width).toBe(CANVAS_W);
    expect(canvas.height).toBe(CANVAS_H);
  });

  it('grows the canvas so a 160-tile level still gets ≥4px tiles on both axes', () => {
    const { overlay, canvas } = setup();
    const worldSize = 160; // treranium_depths (#458 D13)
    overlay.open({
      mode: 'point', worldSizeX: worldSize, worldSizeZ: worldSize, title: 'x', onConfirm: () => {},
    });
    // 480 / 160 = 3px — below the floor, so height must grow; 640 / 160 = 4px
    // exactly, so width stays at the base.
    expect(canvas.width).toBe(CANVAS_W);
    expect(canvas.height).toBe(worldSize * 4);
    expect(canvas.width / worldSize).toBeGreaterThanOrEqual(4);
    expect(canvas.height / worldSize).toBeGreaterThanOrEqual(4);
  });

  it('picking still lands on the intended tile after the canvas grows', () => {
    const { container, overlay, canvas } = setup();
    const worldSize = 160;
    const onConfirm = vi.fn<(r: TileSelectResult) => void>();
    overlay.open({ mode: 'point', worldSizeX: worldSize, worldSizeZ: worldSize, title: 'x', onConfirm });
    // The grown canvas's on-screen box now matches its new resolution.
    canvas.getBoundingClientRect = () => ({
      width: canvas.width, height: canvas.height, top: 0, left: 0,
      right: canvas.width, bottom: canvas.height, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;

    const tileW = canvas.width / worldSize;
    const tileH = canvas.height / worldSize;
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: (100 + 0.5) * tileW, clientY: (140 + 0.5) * tileH, button: 0, bubbles: true,
    }));
    canvas.dispatchEvent(new MouseEvent('mouseup', {
      clientX: (100 + 0.5) * tileW, clientY: (140 + 0.5) * tileH, button: 0, bubbles: true,
    }));
    confirmBtn(container).click();

    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ x: 100, z: 140 });
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

describe('TileSelectOverlay — exact target', () => {
  const EXACT = { x1: 8, z1: 8, x2: 16, z2: 16, exact: true };

  function openArea(overlay: TileSelectOverlay, onConfirm = () => {}) {
    overlay.open({ mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm });
  }

  it('enables Confirm only for the exact rectangle', () => {
    setPickerRegion(EXACT);
    const { container, overlay, canvas } = setup();
    openArea(overlay);

    drag(canvas, 8, 8, 16, 16);
    expect(confirmBtn(container).disabled).toBe(false);
  });

  it('refuses a selection that is inside but smaller', () => {
    // Under the old "stay inside the area" rule this was accepted.
    setPickerRegion(EXACT);
    const { container, overlay, canvas } = setup();
    openArea(overlay);

    drag(canvas, 9, 9, 15, 15);
    expect(confirmBtn(container).disabled).toBe(true);
  });

  it('refuses a selection short by one tile', () => {
    setPickerRegion(EXACT);
    const { container, overlay, canvas } = setup();
    openArea(overlay);

    drag(canvas, 8, 8, 15, 16);
    expect(confirmBtn(container).disabled).toBe(true);
  });

  it('names the rectangle it wants instead of a bare rejection', () => {
    setPickerRegion(EXACT);
    const { container, overlay, canvas } = setup();
    openArea(overlay);

    drag(canvas, 9, 9, 15, 15);
    const info = infoText(container);
    expect(info).toContain('8');
    expect(info).toContain('16');
  });

  it('clamps an overshooting drag onto the target, so it can be hit', () => {
    // Dragging from outside one corner to outside the opposite corner is the
    // natural gesture; without clamping it would select the whole map and be
    // refused, making an exact target a mouse-accuracy test.
    setPickerRegion(EXACT);
    const { container, overlay, canvas } = setup();
    const onConfirm = vi.fn<(r: TileSelectResult) => void>();
    openArea(overlay, onConfirm as unknown as () => void);

    drag(canvas, 2, 2, 22, 22);

    expect(confirmBtn(container).disabled).toBe(false);
    confirmBtn(container).click();
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ x: 8, z: 8, x2: 16, z2: 16 });
  });

  it('does not clamp when the region is not exact', () => {
    // A plain area leaves the player free to choose within it, so silently
    // moving their selection would be changing their intent.
    setPickerRegion({ x1: 8, z1: 8, x2: 16, z2: 16 });
    const { container, overlay, canvas } = setup();
    openArea(overlay);

    drag(canvas, 2, 2, 22, 22);
    expect(confirmBtn(container).disabled).toBe(true);
  });

  it('tells the player up front that the square must be covered exactly', () => {
    setPickerRegion(EXACT);
    const { container, overlay } = setup();
    openArea(overlay);

    expect(container.querySelector('.bs-tile-select-hint')?.textContent)
      .toContain('exactly');
  });

  it('still refuses a forced Confirm on a wrong selection', () => {
    setPickerRegion(EXACT);
    const { container, overlay, canvas } = setup();
    const onConfirm = vi.fn<(r: TileSelectResult) => void>();
    openArea(overlay, onConfirm as unknown as () => void);

    drag(canvas, 9, 9, 15, 15);
    const btn = confirmBtn(container);
    btn.disabled = false;
    btn.click();

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ── Bug 3: hardcoded English literals bypass t() (issue #457) ─────────────────
//
// 'No selection' (×2), 'Confirm', 'Cancel', both 'Selected: (...)' templates,
// and both drag-hint fallback strings are set as plain JS literals rather than
// through t(), so they never translate no matter which locale is active. Key
// names below (ui.tile_select.no_selection / confirm / cancel / selected_point
// / selected_area / drag_hint / pick_hint) are this test's expectation for
// what the implementer adds to en.json/fr.json — adjust here if a different
// naming is chosen, but the literal-leak assertions must stay.

describe('TileSelectOverlay — hardcoded English literals go through t() (issue #457)', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('shows the localized "no selection" text, not the hardcoded English literal, in French', () => {
    setLocale('fr');
    const { container, overlay } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    const info = infoText(container);
    expect(info).toBe(t('ui.tile_select.no_selection'));
    expect(info).not.toBe('No selection');
  });

  it('re-shows the localized "no selection" text after close()/open() with nothing picked, in French', () => {
    setLocale('fr');
    const { container, overlay, canvas } = setup();
    overlay.open({ mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {} });
    pick(canvas, 3, 3);
    overlay.close();

    overlay.open({ mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {} });

    const info = infoText(container);
    expect(info).toBe(t('ui.tile_select.no_selection'));
    expect(info).not.toBe('No selection');
  });

  it('Confirm button text is localized, not the hardcoded English literal, in French', () => {
    setLocale('fr');
    const { container, overlay } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    const text = confirmBtn(container).textContent;
    expect(text).toBe(t('ui.tile_select.confirm'));
    expect(text).not.toBe('Confirm');
  });

  it('Cancel button text is localized, not the hardcoded English literal, in French', () => {
    setLocale('fr');
    const { container, overlay } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    const cancelBtnEl = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b !== confirmBtn(container) && b.className.includes('bs-btn'));
    expect(cancelBtnEl?.textContent).toBe(t('ui.tile_select.cancel'));
    expect(cancelBtnEl?.textContent).not.toBe('Cancel');
  });

  it('the point-mode "Selected:" info string is localized and interpolates the tile, in French', () => {
    setLocale('fr');
    const { container, overlay, canvas } = setup();
    overlay.open({ mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {} });

    pick(canvas, 5, 7);

    const info = infoText(container);
    expect(info).toBe(t('ui.tile_select.selected_point', { x: 5, z: 7 }));
    expect(info).not.toBe('Selected: (5, 7)');
    expect(info).toContain('5');
    expect(info).toContain('7');
  });

  it('the area-mode "Selected:" info string is localized and interpolates the rectangle, in French', () => {
    setLocale('fr');
    const { container, overlay, canvas } = setup();
    overlay.open({ mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {} });

    drag(canvas, 2, 2, 6, 5);

    const info = infoText(container);
    expect(info).toBe(t('ui.tile_select.selected_area', { x1: 2, z1: 2, x2: 6, z2: 5, w: 5, h: 4 }));
    expect(info).not.toContain('Selected: (2, 2)'); // the hardcoded English literal's prefix
    expect(info).toContain('2');
    expect(info).toContain('6');
  });

  it('the point-mode "Selected:" info in English still resolves through t(), not a bypassing literal', () => {
    setLocale('en');
    const { container, overlay, canvas } = setup();
    overlay.open({ mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {} });

    pick(canvas, 5, 7);

    expect(infoText(container)).toBe(t('ui.tile_select.selected_point', { x: 5, z: 7 }));
  });

  it('the area-mode drag hint is localized, not the hardcoded English fallback, in French', () => {
    setLocale('fr');
    const { container, overlay } = setup();
    overlay.open({
      mode: 'area', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    const hint = container.querySelector('.bs-tile-select-hint')?.textContent;
    expect(hint).toBe(t('ui.tile_select.drag_hint'));
    expect(hint).not.toBe('Click and drag to select a rectangular area');
  });

  it('the point-mode pick hint is localized, not the hardcoded English fallback, in French', () => {
    setLocale('fr');
    const { container, overlay } = setup();
    overlay.open({
      mode: 'point', worldSizeX: WORLD, worldSizeZ: WORLD, title: 'x', onConfirm: () => {},
    });

    const hint = container.querySelector('.bs-tile-select-hint')?.textContent;
    expect(hint).toBe(t('ui.tile_select.pick_hint'));
    expect(hint).not.toBe('Click a tile to select it');
  });
});
