// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial ripple (#2234)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TutorialRipple, RIPPLE_LAYER_CLASS } from '../../../src/ui/tutorialRipple.js';
import type { TileRegion } from '../../../src/ui/tutorialPickerRegion.js';

// ── manual animation frames ─────────────────────────────────────────────

let frameQueue = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let clock = 0;
let requestCount = 0;
let reducedMotion = false;

/** Stub a global on both globalThis and window so either access path sees it. */
function stub(name: string, value: unknown): void {
  vi.stubGlobal(name, value);
  const w = window as unknown as Record<string, unknown>;
  if (w !== (globalThis as unknown as Record<string, unknown>)) {
    Object.defineProperty(window, name, { value, configurable: true, writable: true });
  }
}

function installFrameStubs(): void {
  frameQueue = new Map();
  nextFrameId = 1;
  clock = 0;
  requestCount = 0;
  stub('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = nextFrameId++;
    requestCount++;
    frameQueue.set(id, cb);
    return id;
  });
  stub('cancelAnimationFrame', (id: number): void => {
    frameQueue.delete(id);
  });
  stub('matchMedia', (query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

/** Run every callback pending right now once (one animation frame). */
function frame(): void {
  clock += 16;
  const pending = [...frameQueue.entries()];
  frameQueue = new Map();
  for (const [, cb] of pending) cb(clock);
}

function frames(n: number): void {
  for (let i = 0; i < n; i++) frame();
}

// ── DOM helpers ─────────────────────────────────────────────────────────

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function target(id: string, rect: DOMRect): HTMLElement {
  const el = document.createElement('button');
  el.id = id;
  el.getBoundingClientRect = () => rect;
  document.body.appendChild(el);
  return el;
}

function layers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`.${RIPPLE_LAYER_CLASS}`)];
}

function layer(): HTMLElement {
  const found = layers();
  expect(found.length).toBe(1);
  return found[0]!;
}

const REGION: TileRegion = { x1: 10, z1: 20, x2: 12, z2: 22 };

describe('TutorialRipple', () => {
  let ripple: TutorialRipple;

  beforeEach(() => {
    document.body.innerHTML = '';
    reducedMotion = false;
    installFrameStubs();
    ripple = new TutorialRipple();
  });

  afterEach(() => {
    ripple.stop();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('mounting and removal (C1)', () => {
    it('is not running and mounts nothing before show', () => {
      expect(ripple.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });

    it('show mounts one layer on document.body and runs', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      expect(ripple.running).toBe(true);
      const el = layer();
      expect(el.parentElement).toBe(document.body);
      expect(el.classList.contains(RIPPLE_LAYER_CLASS)).toBe(true);
    });

    it('stop removes the layer and stops running', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      ripple.stop();
      expect(ripple.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });

    it('show(null) removes the layer and stops running', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      ripple.show(null);
      expect(ripple.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });

    it('show(null) and stop are safe when nothing was shown', () => {
      expect(() => ripple.show(null)).not.toThrow();
      expect(() => ripple.stop()).not.toThrow();
      expect(ripple.running).toBe(false);
    });

    it('stop twice is safe', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      ripple.stop();
      expect(() => ripple.stop()).not.toThrow();
      expect(layers()).toHaveLength(0);
    });

    it('frames pending at stop never bring the layer back', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frame();
      ripple.stop();
      expect(() => frames(3)).not.toThrow();
      expect(layers()).toHaveLength(0);
      expect(ripple.running).toBe(false);
    });

    it('the animation loop ends with stop (no frame left requested)', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(2);
      ripple.stop();
      frame();
      expect(frameQueue.size).toBe(0);
    });

    it('can be shown again after a stop', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      ripple.stop();
      ripple.show({ selector: '#t' });
      expect(ripple.running).toBe(true);
      expect(layers()).toHaveLength(1);
    });
  });

  describe('never intercepts a click (C2)', () => {
    it('the layer is fixed and pointer-events none inline', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(2);
      const el = layer();
      expect(el.style.pointerEvents).toBe('none');
      expect(el.style.position).toBe('fixed');
    });

    it('every descendant is fixed and pointer-events none inline, before and after frames', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      for (let pass = 0; pass < 3; pass++) {
        const descendants = [...layer().querySelectorAll<HTMLElement>('*')];
        for (const d of descendants) {
          expect(d.style.pointerEvents).toBe('none');
          expect(d.style.position).toBe('fixed');
        }
        frames(2);
      }
    });
  });

  describe('follows the target (C3)', () => {
    it('publishes the centre of the target rect', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(2);
      const el = layer();
      expect(Number(el.dataset['rippleX'])).toBe(120);
      expect(Number(el.dataset['rippleY'])).toBe(60);
      expect(el.dataset['rippleVisible']).toBe('true');
    });

    it('re-reads the rect each frame as the target moves', () => {
      let rect = rectOf(100, 50, 40, 20);
      const el = target('t', rect);
      el.getBoundingClientRect = () => rect;
      ripple.show({ selector: '#t' });
      frames(2);
      expect(Number(layer().dataset['rippleX'])).toBe(120);

      rect = rectOf(300, 200, 100, 60);
      frames(2);
      expect(Number(layer().dataset['rippleX'])).toBe(350);
      expect(Number(layer().dataset['rippleY'])).toBe(230);

      rect = rectOf(0, 0, 10, 10);
      frames(2);
      expect(Number(layer().dataset['rippleX'])).toBe(5);
      expect(Number(layer().dataset['rippleY'])).toBe(5);
    });

    it('keeps the loop alive across many frames', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(30);
      expect(ripple.running).toBe(true);
      expect(layers()).toHaveLength(1);
      expect(frameQueue.size).toBeGreaterThan(0);
    });
  });

  describe('target missing or empty (C4)', () => {
    it('a selector matching nothing mounts a hidden layer', () => {
      ripple.show({ selector: '#absent' });
      frames(2);
      expect(ripple.running).toBe(true);
      expect(layer().dataset['rippleVisible']).toBe('false');
    });

    it('turns visible once the target appears', () => {
      ripple.show({ selector: '#late' });
      frames(2);
      expect(layer().dataset['rippleVisible']).toBe('false');

      target('late', rectOf(10, 10, 80, 40));
      frames(2);
      expect(layer().dataset['rippleVisible']).toBe('true');
      expect(Number(layer().dataset['rippleX'])).toBe(50);
      expect(Number(layer().dataset['rippleY'])).toBe(30);
    });

    it('a zero-size rect is hidden', () => {
      target('t', rectOf(100, 50, 0, 0));
      ripple.show({ selector: '#t' });
      frames(2);
      expect(layer().dataset['rippleVisible']).toBe('false');
    });

    it('hides again when the target is removed', () => {
      const el = target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(2);
      expect(layer().dataset['rippleVisible']).toBe('true');
      el.remove();
      frames(2);
      expect(layer().dataset['rippleVisible']).toBe('false');
    });
  });

  describe('reduced motion (C5)', () => {
    it('mounts nothing and does not run when the user prefers reduced motion', () => {
      reducedMotion = true;
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(2);
      expect(ripple.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });

    it('mounts as usual when reduced motion is not requested', () => {
      reducedMotion = false;
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      expect(ripple.running).toBe(true);
    });

    it('a region stage mounts nothing under reduced motion either', () => {
      reducedMotion = true;
      const r = new TutorialRipple(() => ({ x: 1, y: 2 }));
      r.show({ selector: '#t', region: REGION });
      expect(r.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });
  });

  describe('driven by requestAnimationFrame (C6)', () => {
    it('requests animation frames while running', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      expect(requestCount).toBeGreaterThan(0);
      const before = requestCount;
      frames(3);
      expect(requestCount).toBeGreaterThan(before);
    });

    it('neither the layer nor its descendants use a CSS animation', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(3);
      const all = [layer(), ...layer().querySelectorAll<HTMLElement>('*')];
      for (const el of all) {
        expect(el.style.animation).toBe('');
        expect(el.style.animationName).toBe('');
      }
    });
  });

  describe('tile-pick stages (C7)', () => {
    it('converges on the projected region centre via the constructor projector', () => {
      const projector = vi.fn((_r: TileRegion) => ({ x: 321, y: 654 }));
      const r = new TutorialRipple(projector);
      r.show({ selector: '#absent', region: REGION });
      frames(2);
      expect(r.running).toBe(true);
      expect(projector).toHaveBeenCalledWith(REGION);
      expect(Number(layer().dataset['rippleX'])).toBe(321);
      expect(Number(layer().dataset['rippleY'])).toBe(654);
      r.stop();
    });

    it('setProjector supplies the projection after construction', () => {
      ripple.setProjector(() => ({ x: 11, y: 22 }));
      ripple.show({ selector: '#absent', region: REGION });
      frames(2);
      expect(ripple.running).toBe(true);
      expect(Number(layer().dataset['rippleX'])).toBe(11);
      expect(Number(layer().dataset['rippleY'])).toBe(22);
    });

    it('the projection wins over the selector target for a region stage', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.setProjector(() => ({ x: 700, y: 400 }));
      ripple.show({ selector: '#t', region: REGION });
      frames(2);
      expect(Number(layer().dataset['rippleX'])).toBe(700);
      expect(Number(layer().dataset['rippleY'])).toBe(400);
    });

    it('mounts nothing when there is no projector', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t', region: REGION });
      expect(ripple.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });

    it('mounts nothing when the projector returns null', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.setProjector(() => null);
      ripple.show({ selector: '#t', region: REGION });
      expect(ripple.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });

    it('a dropped projector (null) mounts nothing for a region stage', () => {
      ripple.setProjector(() => ({ x: 1, y: 1 }));
      ripple.setProjector(null);
      ripple.show({ selector: '#t', region: REGION });
      expect(ripple.running).toBe(false);
      expect(layers()).toHaveLength(0);
    });

    it('a stage without a region ignores the projector', () => {
      const projector = vi.fn(() => ({ x: 999, y: 999 }));
      ripple.setProjector(projector);
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(2);
      expect(Number(layer().dataset['rippleX'])).toBe(120);
      expect(projector).not.toHaveBeenCalled();
    });

    it('a null region behaves as no region', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t', region: null });
      frames(2);
      expect(ripple.running).toBe(true);
      expect(Number(layer().dataset['rippleX'])).toBe(120);
    });
  });

  describe('repeated show (C10)', () => {
    it('the same selector again keeps the same layer element mounted', () => {
      target('t', rectOf(100, 50, 40, 20));
      ripple.show({ selector: '#t' });
      frames(2);
      const first = layer();
      ripple.show({ selector: '#t' });
      frames(2);
      expect(layers()).toHaveLength(1);
      expect(layer()).toBe(first);
      expect(first.isConnected).toBe(true);
      expect(ripple.running).toBe(true);
    });

    it('a different selector leaves exactly one layer, converging on the new target', () => {
      target('a', rectOf(100, 50, 40, 20));
      target('b', rectOf(400, 300, 60, 40));
      ripple.show({ selector: '#a' });
      frames(2);
      ripple.show({ selector: '#b' });
      frames(2);
      expect(layers()).toHaveLength(1);
      expect(ripple.running).toBe(true);
      expect(Number(layer().dataset['rippleX'])).toBe(430);
      expect(Number(layer().dataset['rippleY'])).toBe(320);
    });

    it('switching to another selector and stopping leaves nothing behind', () => {
      target('a', rectOf(100, 50, 40, 20));
      target('b', rectOf(400, 300, 60, 40));
      ripple.show({ selector: '#a' });
      ripple.show({ selector: '#b' });
      ripple.stop();
      expect(layers()).toHaveLength(0);
      expect(ripple.running).toBe(false);
    });
  });
});
