// BlastSimulator2026 — Shell layout registry (#956)
//
// Screen-edge UI shell regions (TopBar, ToolRail, Toasts, SelectionBar,
// ActivityLog) declare their on-screen bounds here so a test can prove no
// two 'hud'-layer regions overlap at a matrix of viewport sizes, and that
// none falls outside the viewport. Populated by each shell region on
// construction, cleared on dispose() — see shell/TopBar.ts etc.

export interface Viewport { readonly width: number; readonly height: number; }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }

/**
 * 'hud'     — always-on chrome. Two 'hud' regions overlapping is the defect
 *             this mechanism exists to catch.
 * 'overlay' — a layer deliberately drawn on top of hud chrome by design (a
 *             drawer, a modal, a popover anchored to its own control) —
 *             exempt from the pairwise overlap check, still checked for on-screen.
 */
type LayoutLayer = 'hud' | 'overlay';

interface LayoutRegion {
  readonly id: string;
  readonly layer: LayoutLayer;
  readonly bounds: (viewport: Viewport) => Rect;
}

export class LayoutRegistry {
  private readonly regions = new Map<string, LayoutRegion>();

  register(region: LayoutRegion): void {
    this.regions.set(region.id, region);
  }

  unregister(id: string): void {
    this.regions.delete(id);
  }

  list(): readonly LayoutRegion[] {
    return Array.from(this.regions.values());
  }

  has(id: string): boolean {
    return this.regions.has(id);
  }
}

/** Process-wide instance shared by every shell region, mirroring the injectTokens()/registerIcons() singleton pattern already used in src/ui. */
export const shellLayoutRegistry = new LayoutRegistry();

/** Shared-area test on two axis-aligned boxes; touching edges do not count as intersecting. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** True when rect sits entirely within [0,0,viewport.width,viewport.height]. */
export function rectWithinViewport(rect: Rect, viewport: Viewport): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= viewport.width &&
    rect.y + rect.height <= viewport.height
  );
}

/** Order: spec floor, spec ceiling, ultrawide, short, tall. */
export const SHELL_VIEWPORT_MATRIX: readonly Viewport[] = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 3440, height: 1440 },
  { width: 1920, height: 800 },
  { width: 1280, height: 1600 },
];
