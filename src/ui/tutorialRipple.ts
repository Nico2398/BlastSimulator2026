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

/** Rings in flight at once. */
const RING_COUNT = 3;
/** Milliseconds one ring takes to travel from the screen edge to the target. */
const RING_TRAVEL_MS = 2400;
/** Milliseconds between two rings of one wave. */
const RING_STAGGER_MS = 450;
/** Milliseconds of calm after a wave, before the next one. */
const WAVE_REST_MS = 1800;
/** Peak ring opacity — low contrast on purpose. */
const RING_PEAK_OPACITY = 0.3;
/** Ring stroke width in px. */
const RING_WIDTH_PX = 2;

const WAVE_MS = RING_TRAVEL_MS + (RING_COUNT - 1) * RING_STAGGER_MS;
const CYCLE_MS = WAVE_MS + WAVE_REST_MS;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

interface Point { x: number; y: number }

export class TutorialRipple {
  private projector: RegionProjector | null;
  private layer: HTMLElement | null = null;
  private rings: HTMLElement[] = [];
  private stage: RippleStage | null = null;
  private frame: number | null = null;
  private startedAt: number | null = null;

  constructor(projector: RegionProjector | null = null) {
    this.projector = projector;
  }

  /** Supply (or drop) the in-scene projection. */
  setProjector(projector: RegionProjector | null): void {
    this.projector = projector;
  }

  /** Start or keep the ripple for `stage`; null stops it. */
  show(stage: RippleStage | null): void {
    if (!stage || prefersReducedMotion()) {
      this.stop();
      return;
    }
    if (this.layer && this.stage?.selector === stage.selector) {
      this.stage = stage;
      return;
    }
    this.stop();
    if (stage.region && this.focusOf(stage) === null) return; // projection unavailable: skip this stage
    this.stage = stage;
    this.mount();
    this.update(performance.now());
    this.schedule();
  }

  /** Remove the layer and stop animating. */
  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.layer?.remove();
    this.layer = null;
    this.rings = [];
    this.stage = null;
    this.startedAt = null;
  }

  get running(): boolean {
    return this.layer !== null;
  }

  private mount(): void {
    const layer = document.createElement('div');
    layer.className = RIPPLE_LAYER_CLASS;
    layer.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;'
      + 'z-index:var(--bsx-z-coach);display:none;';
    layer.dataset.rippleVisible = 'false';
    this.rings = [];
    for (let i = 0; i < RING_COUNT; i++) {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;pointer-events:none;box-sizing:border-box;border-radius:50%;'
        + `border:${RING_WIDTH_PX}px solid var(--bsx-amber);opacity:0;`;
      layer.appendChild(ring);
      this.rings.push(ring);
    }
    document.body.appendChild(layer);
    this.layer = layer;
  }

  private schedule(): void {
    this.frame = requestAnimationFrame((ts) => {
      this.frame = null;
      if (!this.layer) return;
      this.update(typeof ts === 'number' ? ts : performance.now());
      this.schedule();
    });
  }

  /** Where the rings converge, in CSS px; null when the target is absent or unmeasurable. */
  private focusOf(stage: RippleStage): Point | null {
    if (stage.region) return this.projector?.(stage.region) ?? null;
    const el = document.querySelector(stage.selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  private update(now: number): void {
    const layer = this.layer;
    if (!layer || !this.stage) return;
    const focus = this.focusOf(this.stage);
    layer.dataset.rippleVisible = focus ? 'true' : 'false';
    layer.style.display = focus ? '' : 'none';
    if (!focus) return;
    layer.dataset.rippleX = String(focus.x);
    layer.dataset.rippleY = String(focus.y);
    if (this.startedAt === null) this.startedAt = now;
    const t = (now - this.startedAt) % CYCLE_MS;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const maxR = Math.hypot(Math.max(focus.x, w - focus.x), Math.max(focus.y, h - focus.y));
    this.rings.forEach((ring, i) => {
      const p = (t - i * RING_STAGGER_MS) / RING_TRAVEL_MS;
      if (p < 0 || p > 1) {
        ring.style.opacity = '0';
        return;
      }
      const r = maxR * (1 - p) ** 2;
      ring.style.width = `${2 * r}px`;
      ring.style.height = `${2 * r}px`;
      ring.style.left = `${focus.x - r}px`;
      ring.style.top = `${focus.y - r}px`;
      ring.style.opacity = String(RING_PEAK_OPACITY * Math.sin(Math.PI * p));
    });
  }
}
