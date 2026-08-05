// LoadingScreen — DOM tests (jsdom)
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LoadingScreen, nextPaint } from '../../../src/ui/LoadingScreen.js';
import { LOADING_QUIPS, QuipBag } from '../../../src/ui/loadingQuips.js';

describe('LoadingScreen', () => {
  let container: HTMLElement;
  let screen: LoadingScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    // jsdom has no rAF driver of its own that advances on a timer, so give it
    // one — every paint-ordering assertion below depends on it firing.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    screen = new LoadingScreen(container);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('starts hidden', () => {
    expect(screen.visible).toBe(false);
    expect(document.getElementById('bs-loading-screen')).toBeTruthy();
  });

  it('mirrors visibility onto the DOM node for harness-side asserts', () => {
    const overlay = document.getElementById('bs-loading-screen') as unknown as { visible: boolean };
    expect(overlay.visible).toBe(false);
    screen.show();
    expect(overlay.visible).toBe(true);
    screen.hide();
    expect(overlay.visible).toBe(false);
  });

  it('show puts it on screen at zero progress', () => {
    screen.show();
    expect(screen.visible).toBe(true);
    expect(screen.progress).toBe(0);
  });

  it('setPhase updates the caption and the bar', () => {
    screen.show();
    screen.setPhase('Bribing the geological survey', 0.5);
    expect(screen.phaseText).toBe('Bribing the geological survey');
    expect(screen.progress).toBeCloseTo(0.5, 2);
  });

  it('shows a satirical line rather than naming the work being done', () => {
    screen.show();
    expect(LOADING_QUIPS).toContain(screen.phaseText);
  });

  it('clamps progress to 0..1 rather than emitting a nonsense bar width', () => {
    screen.show();
    screen.setPhase('x', 5);
    expect(screen.progress).toBe(1);
    screen.setPhase('x', -3);
    expect(screen.progress).toBe(0);
  });

  describe('runPhases', () => {
    it('runs every phase in order and finishes hidden', async () => {
      const order: string[] = [];
      await screen.runPhases([
        { run: () => order.push('a') },
        { run: () => order.push('b') },
      ]);
      expect(order).toEqual(['a', 'b']);
      expect(screen.visible).toBe(false);
    });

    it('is on screen, with the phase caption set, BEFORE that phase blocks', async () => {
      // The whole point of the component. If a phase ran before a frame was
      // presented the player would see a freeze and then the finished level,
      // with the overlay never actually visible.
      const seen: { visible: boolean; caption: string; progress: number }[] = [];
      await screen.runPhases([
        { run: () => seen.push({ visible: screen.visible, caption: screen.phaseText, progress: screen.progress }) },
        { run: () => seen.push({ visible: screen.visible, caption: screen.phaseText, progress: screen.progress }) },
      ]);

      expect(seen).toHaveLength(2);
      for (const s of seen) expect(s.visible).toBe(true);
      expect(seen[0]!.caption).not.toBe(seen[1]!.caption); // a fresh quip per phase
      expect(seen[1]!.progress).toBeGreaterThan(seen[0]!.progress);
    });

    it('waits for a presented frame between phases, not merely a microtask', async () => {
      // nextPaint resolves on the SECOND rAF, because a callback on the first
      // still runs before its own paint.
      let frames = 0;
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        frames++;
        return setTimeout(() => cb(0), 0) as unknown as number;
      });
      await nextPaint();
      expect(frames).toBe(2);
    });

    it('hides even when a phase throws, so a failed load cannot strand the player', async () => {
      await expect(screen.runPhases([
        { run: () => { throw new Error('generation blew up'); } },
      ])).rejects.toThrow('generation blew up');
      expect(screen.visible).toBe(false);
    });

    it('reaches full progress before hiding', async () => {
      let atEnd = -1;
      await screen.runPhases([
        { run: () => {} },
        { run: () => { /* last phase */ } },
      ]).then(() => { atEnd = screen.progress; });
      // Progress is read after hide(); the bar keeps its final width.
      expect(atEnd).toBe(1);
    });

    it('copes with an empty phase list', async () => {
      await screen.runPhases([]);
      expect(screen.visible).toBe(false);
    });

    it('sits above the main menu and the sandbox panel', () => {
      const overlay = document.getElementById('bs-loading-screen')!;
      const z = Number(overlay.style.zIndex);
      expect(z).toBeGreaterThan(9999);  // main menu
      expect(z).toBeGreaterThan(10000); // sandbox panel
    });
  });

  it('dispose removes it from the document', () => {
    screen.dispose();
    expect(document.getElementById('bs-loading-screen')).toBeNull();
  });
});

describe('nextPaint', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('resolves rather than hanging where requestAnimationFrame does not exist', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    await expect(nextPaint()).resolves.toBeUndefined();
  });
});

describe('QuipBag', () => {
  it('offers a decent spread of lines', () => {
    expect(LOADING_QUIPS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(LOADING_QUIPS).size).toBe(LOADING_QUIPS.length);
    for (const q of LOADING_QUIPS) expect(q.trim().length).toBeGreaterThan(0);
  });

  it('never repeats a line until every one has been used', () => {
    const bag = new QuipBag();
    const drawn = new Set<string>();
    for (let i = 0; i < LOADING_QUIPS.length; i++) {
      const q = bag.next();
      expect(drawn.has(q), `repeated "${q}" before the bag was empty`).toBe(false);
      drawn.add(q);
    }
    expect(drawn.size).toBe(LOADING_QUIPS.length);
  });

  it('refills once drained rather than running out', () => {
    const bag = new QuipBag();
    for (let i = 0; i < LOADING_QUIPS.length; i++) bag.next();
    expect(bag.remainingCount).toBe(0);
    expect(LOADING_QUIPS).toContain(bag.next());
  });

  it('draws in a different order for a different random source', () => {
    const seq = (r: () => number) => {
      const bag = new QuipBag(r);
      return Array.from({ length: 8 }, () => bag.next()).join('|');
    };
    expect(seq(() => 0)).not.toBe(seq(() => 0.999));
  });

  it('a degenerate random source still yields valid lines', () => {
    const bag = new QuipBag(() => 1);
    for (let i = 0; i < 5; i++) expect(LOADING_QUIPS).toContain(bag.next());
  });
});
