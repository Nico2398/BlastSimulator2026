/**
 * BlastSimulator2026 — Tile picker coordinate mapping
 *
 * Shared by the `playability` and `scenario`/`visual` channels so both address
 * the tile picker the same way. Pixel coordinates baked into a definition are
 * a standing trap: the picker canvas moves whenever the HUD is relaid out, and
 * a click that lands one tile over — or on no tile at all — fails as "the step
 * did not complete" with nothing pointing at the cause. Tile space survives
 * that; the mapping is recomputed from the live canvas on every call.
 *
 * @module shared/tile-picker
 */

import type { Page } from 'puppeteer';

/** Live geometry of the open tile picker, in CSS pixels plus world extent. */
export interface PickerGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  sizeX: number;
  sizeZ: number;
  /** World coordinate of the picker's top-left tile — non-zero once the site has grown west/north (#473). */
  minX: number;
  minZ: number;
}

export interface PickerPoint {
  px: number;
  py: number;
}

const POLL_INTERVAL_MS = 150;

/** Read the open picker's geometry, or null when no picker is visible. */
export function readPickerGeometry(page: Page): Promise<PickerGeometry | null> {
  return page.evaluate((): PickerGeometry | null => {
    const overlay = Array.from(document.querySelectorAll('.bs-tile-select-overlay'))
      .find(o => getComputedStyle(o as HTMLElement).display !== 'none');
    if (!overlay) return null;
    const canvas = overlay.querySelector('.bs-tile-select-canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    // The picker lays worldSize tiles across the canvas, so map through the real
    // world dimensions rather than a terrain bounding box that blasting changes.
    const state = (window as unknown as {
      __gameState: () => Record<string, unknown> | null;
    }).__gameState();
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      sizeX: (state?.worldSizeX as number | null) ?? 24,
      sizeZ: (state?.worldSizeZ as number | null) ?? 24,
      minX: (state?.worldMinX as number | null) ?? 0,
      minZ: (state?.worldMinZ as number | null) ?? 0,
    };
  });
}

/**
 * Poll until a tile picker is open, then return its geometry.
 *
 * Waiting on the Confirm button instead would be wrong: Confirm starts disabled
 * in point mode and only enables once a tile has been picked.
 *
 * @throws when no picker appears before the timeout.
 */
export async function awaitPickerGeometry(page: Page, timeoutMs: number): Promise<PickerGeometry> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const geo = await readPickerGeometry(page);
    if (geo) return geo;
    if (Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('no tile picker is open');
}

/** Centre of tile (x, z) in page pixels. */
export function tileToPoint(geo: PickerGeometry, x: number, z: number): PickerPoint {
  const tileW = geo.w / geo.sizeX;
  const tileH = geo.h / geo.sizeZ;
  return {
    px: geo.x + (x - geo.minX + 0.5) * tileW,
    py: geo.y + (z - geo.minZ + 0.5) * tileH,
  };
}

/**
 * P3 in-scene placement (replaces the 2D picker above). Poll until the tool
 * is armed, so a pickTile/dragTiles action that races the button click it
 * follows waits instead of acting on nothing.
 */
export async function awaitPlacementArmed(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const armed = await page.evaluate(() => (window as unknown as {
      __placement?: { isArmed: () => boolean };
    }).__placement?.isArmed() ?? false);
    if (armed) return;
    if (Date.now() > deadline) throw new Error('no placement tool is armed');
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * Screen point for world tile (x, z), via the live camera projection —
 * recomputed on every call, same "never bake pixels" reasoning as the 2D
 * picker mapping above. Used by the playtest harness so a placement click is
 * a real page.mouse click, not a call into __placement (that hook is for
 * scenario mode only — see PlacementController.paintRect).
 *
 * @throws when the tile projects off-screen or behind the camera — the
 *   caller (a playtest def) asked for a tile the player could not see either,
 *   which is itself the finding.
 */
export async function worldToScreenPoint(page: Page, x: number, z: number): Promise<PickerPoint> {
  const point = await page.evaluate((wx: number, wz: number) => (window as unknown as {
    __worldToScreen: (x: number, z: number) => { px: number; py: number; onScreen: boolean } | null;
  }).__worldToScreen(wx, wz), x, z);
  if (!point || !point.onScreen) {
    throw new Error(`world tile (${x}, ${z}) is not on screen — frame it with a camera move first`);
  }
  return { px: point.px, py: point.py };
}
