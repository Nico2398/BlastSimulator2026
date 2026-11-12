// BlastSimulator2026 — Tutorial ripple
//
// A subtle full-screen effect that draws the eye to the control a guided
// tutorial stage highlights: concentric amber rings converge on it from the
// screen edges. Driven by requestAnimationFrame (CSS keyframes stalled under
// main-thread load, #977), above every panel, and never intercepts a click.

import type { TileRegion } from './tutorialPickerRegion.js';

/** Marks the ripple layer in the DOM. */
export const RIPPLE_LAYER_CLASS = 'bsx-ripple-layer';

/** What the ripple converges on. */
export interface RippleStage {
  /** Selector of the highlighted control. */
  selector: string;
  /** Tile region of a tile-pick stage; the ripple converges on its projected centre. */
  region?: TileRegion | null;
}

/** Projects a tile region's centre to CSS pixels, or null when unavailable. */
export type RegionProjector = (region: TileRegion) => { x: number; y: number } | null;

export class TutorialRipple {
  constructor(_projector: RegionProjector | null = null) {
    void _projector;
  }

  /** Supply (or drop) the in-scene projection. */
  setProjector(_projector: RegionProjector | null): void {
    throw new Error('not implemented');
  }

  /** Start or keep the ripple for `stage`; null stops it. */
  show(_stage: RippleStage | null): void {
    throw new Error('not implemented');
  }

  /** Remove the layer and stop animating. */
  stop(): void {
    throw new Error('not implemented');
  }

  get running(): boolean {
    throw new Error('not implemented');
  }
}
