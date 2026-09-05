// BlastSimulator2026 — Shell layout registry (#956)
//
// Screen-edge UI shell regions (TopBar, ToolRail, Toasts, SelectionBar,
// ActivityLog) declare their on-screen bounds here so a test can prove no
// two 'hud'-layer regions overlap at a matrix of viewport sizes, and that
// none falls outside the viewport. Populated by each shell region on
// construction, cleared on dispose() — see shell/TopBar.ts etc.
//
// A region declares the box it may grow to, not the box it happens to
// occupy: worst-case entry counts, worst-case action sets, borders and
// padding included. An envelope wider than the painted element is safe (it
// over-reports a collision); one narrower than it is not.
//
// TODO(#983): src/ui/MiniMap.ts is a screen-edge region too and does not
// register here yet — it really overlaps the ToolRail at 1280x720 today, and
// its width is locale-dependent (215px en / 245px fr), so declaring it needs
// a layout decision rather than a constant. Tracked in #983.

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

/**
 * Viewport sizes the overlap matrix runs at: spec floor, spec ceiling,
 * ultrawide (UWQHD 21:9), short, tall. Adding a size here is how a new
 * aspect ratio gets covered — nothing else needs to change.
 */
export const SHELL_VIEWPORT_MATRIX: readonly Viewport[] = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 3440, height: 1440 },
  { width: 1920, height: 800 },
  { width: 1280, height: 1600 },
];
