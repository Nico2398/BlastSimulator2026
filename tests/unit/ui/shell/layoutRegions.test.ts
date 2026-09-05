// @vitest-environment jsdom
//
// #956 — Shell layout region matrix. Every screen-edge HUD region (TopBar,
// ToolRail, Toasts, SelectionBar, ActivityLog) registers its own on-screen
// bounds with the shared `shellLayoutRegistry` (LayoutRegistry.ts). This file
// proves two things at a matrix of viewport sizes (SHELL_VIEWPORT_MATRIX):
//
//   1. every registered region stays within the viewport, and
//   2. no two 'hud'-layer regions overlap each other (an 'overlay' region,
//      e.g. the activity log drawer, is deliberately drawn on top of hud
//      chrome by design and is exempt from the pairwise check).
//
// jsdom has no real layout engine, so `getBoundingClientRect()` always reads
// zero here — every assertion below goes through each region's own declared
// `bounds(viewport)` function instead (see tests/unit/ui/shell/Toasts.test.ts
// for the precedent on why).
//
// `shellLayoutRegistry` is a module-level singleton shared by every region in
// this file (mirroring the real app, where exactly one shell exists at a
// time). Vitest isolates modules per test *file* by default, so this
// singleton starts empty for this file, but state still accumulates across
// the `it` blocks *within* this file since they all import the same module
// instance — hence disposing all 5 real regions in `afterAll`, once, rather
// than re-mounting per test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TopBar } from '../../../../src/ui/shell/TopBar.js';
import { ToolRail } from '../../../../src/ui/shell/ToolRail.js';
import { Toasts } from '../../../../src/ui/shell/Toasts.js';
import { SelectionBar } from '../../../../src/ui/shell/SelectionBar.js';
import { ActivityLog } from '../../../../src/ui/shell/ActivityLog.js';
import {
  LayoutRegistry,
  shellLayoutRegistry,
  rectsIntersect,
  rectWithinViewport,
  SHELL_VIEWPORT_MATRIX,
  type Rect,
} from '../../../../src/ui/shell/LayoutRegistry.js';

const EXPECTED_IDS = ['topbar', 'tool-rail', 'toasts', 'selection-bar', 'activity-log'] as const;

function mountContainer(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

describe('shell regions — layout matrix (#956)', () => {
  // Constructed in beforeAll rather than at describe-body scope: while
  // LayoutRegistry.register() is still an unimplemented stub, constructing
  // any of these classes throws immediately (each registers itself in its
  // own constructor) — a describe-body-scope throw crashes the whole file's
  // collection with no individual test results at all, whereas a beforeAll
  // throw fails every dependent test in this block individually and still
  // lets ShellRegionsRegistered.test.ts (a different file) run unaffected.
  let topBar!: TopBar;
  let toolRail!: ToolRail;
  let toasts!: Toasts;
  let selectionBar!: SelectionBar;
  let activityLog!: ActivityLog;

  beforeAll(() => {
    const container = mountContainer();
    topBar = new TopBar(container);
    toolRail = new ToolRail(container, () => {});
    toasts = new Toasts(container);
    selectionBar = new SelectionBar(container);
    activityLog = new ActivityLog(container);
  });

  afterAll(() => {
    // Dispose every real region so the shared singleton doesn't leak
    // registered ids into any other test file sharing this module instance.
    topBar?.dispose();
    toolRail?.dispose();
    toasts?.dispose();
    selectionBar?.dispose();
    activityLog?.dispose();
  });

  it('registers exactly the 5 expected shell regions on construction', () => {
    const ids = shellLayoutRegistry.list().map(r => r.id).sort();
    expect(ids).toEqual([...EXPECTED_IDS].sort());
  });

  it.each(SHELL_VIEWPORT_MATRIX)('every region stays within the viewport at %o', (viewport) => {
    for (const region of shellLayoutRegistry.list()) {
      const rect = region.bounds(viewport);
      expect(
        rectWithinViewport(rect, viewport),
        `region "${region.id}" bounds ${JSON.stringify(rect)} fall outside viewport ${JSON.stringify(viewport)}`,
      ).toBe(true);
    }
  });

  it.each(SHELL_VIEWPORT_MATRIX)('no two hud-layer regions overlap at %o', (viewport) => {
    const hudRegions = shellLayoutRegistry.list().filter(r => r.layer !== 'overlay');
    const overlaps: string[] = [];
    for (let i = 0; i < hudRegions.length; i++) {
      for (let j = i + 1; j < hudRegions.length; j++) {
        const a = hudRegions[i]!;
        const b = hudRegions[j]!;
        const rectA = a.bounds(viewport);
        const rectB = b.bounds(viewport);
        if (rectsIntersect(rectA, rectB)) {
          overlaps.push(`"${a.id}" ${JSON.stringify(rectA)} overlaps "${b.id}" ${JSON.stringify(rectB)}`);
        }
      }
    }
    expect(overlaps, `hud regions overlapping at ${JSON.stringify(viewport)}:\n${overlaps.join('\n')}`).toEqual([]);
  });
});

// A throwaway registry instance (never the shared singleton) with two
// fabricated 'hud' regions whose rects are hand-picked to deliberately
// intersect. This is the permanent proof that the overlap-detection logic
// itself correctly flags a real collision — it does not depend on sabotaging
// any real component's geometry, so it stays meaningful even once the 5 real
// regions above are laid out correctly and never overlap.
describe('LayoutRegistry — overlap detection proof (fresh instance)', () => {
  function rect(x: number, y: number, width: number, height: number): Rect {
    return { x, y, width, height };
  }

  it('flags two hud regions with deliberately intersecting rects as overlapping', () => {
    const registry = new LayoutRegistry();
    registry.register({ id: 'a', layer: 'hud', bounds: () => rect(0, 0, 100, 100) });
    registry.register({ id: 'b', layer: 'hud', bounds: () => rect(50, 50, 100, 100) });

    const [a, b] = registry.list();
    expect(rectsIntersect(a!.bounds({ width: 1280, height: 720 }), b!.bounds({ width: 1280, height: 720 }))).toBe(true);
  });

  it('does not flag two hud regions with disjoint rects as overlapping', () => {
    const registry = new LayoutRegistry();
    registry.register({ id: 'a', layer: 'hud', bounds: () => rect(0, 0, 100, 100) });
    registry.register({ id: 'b', layer: 'hud', bounds: () => rect(200, 200, 100, 100) });

    const [a, b] = registry.list();
    expect(rectsIntersect(a!.bounds({ width: 1280, height: 720 }), b!.bounds({ width: 1280, height: 720 }))).toBe(false);
  });

  it('touching edges (sharing a boundary, zero shared area) do not count as intersecting', () => {
    // Per LayoutRegistry.ts's own doc comment on rectsIntersect: "touching
    // edges do not count as intersecting" — two regions flush against each
    // other is normal, valid layout, not a collision.
    expect(rectsIntersect(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false);
  });

  it('register/unregister/list/has round-trip on a fresh instance', () => {
    const registry = new LayoutRegistry();
    expect(registry.has('x')).toBe(false);
    registry.register({ id: 'x', layer: 'hud', bounds: () => rect(0, 0, 10, 10) });
    expect(registry.has('x')).toBe(true);
    expect(registry.list().map(r => r.id)).toEqual(['x']);
    registry.unregister('x');
    expect(registry.has('x')).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it('rectWithinViewport rejects a rect extending past the viewport edge', () => {
    expect(rectWithinViewport(rect(1200, 0, 100, 50), { width: 1280, height: 720 })).toBe(false);
    expect(rectWithinViewport(rect(0, 700, 50, 50), { width: 1280, height: 720 })).toBe(false);
  });

  it('rectWithinViewport accepts a rect flush against the viewport edges', () => {
    expect(rectWithinViewport(rect(0, 0, 1280, 720), { width: 1280, height: 720 })).toBe(true);
  });
});
