// @vitest-environment jsdom
// BlastSimulator2026 — MiniMap paints its static layers once per terrain change
//
// update() runs on every frame and after every console command. The terrain
// shading and grid lines used to be repainted each time (~10 ms on a 96×96
// site); they are now painted into an offscreen layer only when
// StaticLayerInputs reports a change, and copied onto the map otherwise.
// jsdom has no 2D context, so the contexts are stubbed and the painting is
// observed through them.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MiniMap } from '../../../src/ui/MiniMap.js';
import { makeGameContext } from '../../helpers/gameContext.js';

interface FakeContext {
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
}

function fakeContext(): FakeContext & Record<string, unknown> {
  const noop = () => undefined;
  return {
    fillRect: vi.fn(), drawImage: vi.fn(), clearRect: vi.fn(),
    fillText: noop, beginPath: noop, arc: noop, fill: noop, moveTo: noop, lineTo: noop, stroke: noop,
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', globalAlpha: 1,
  };
}

/** Stubs every canvas's 2D context with a fresh fake, returning them in creation order: [map, static layer]. */
function stubContexts(): FakeContext[] {
  const created: FakeContext[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx = fakeContext();
    created.push(ctx);
    return ctx as unknown as CanvasRenderingContext2D;
  } as never);
  return created;
}

describe('MiniMap — static layer cache', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('paints terrain into the offscreen layer once, then only copies it while the terrain is unchanged', () => {
    const contexts = stubContexts();
    const minimap = new MiniMap(document.body);
    const [map, layer] = contexts as [FakeContext, FakeContext];
    const state = makeGameContext({ seed: 42, size: 32 }).state!;

    minimap.update(state);
    const paintedOnce = layer.fillRect.mock.calls.length;
    expect(paintedOnce).toBeGreaterThan(0);
    expect(map.drawImage).toHaveBeenCalledTimes(1);

    minimap.update(state);
    minimap.update(state);
    expect(layer.fillRect.mock.calls.length).toBe(paintedOnce);
    expect(map.drawImage).toHaveBeenCalledTimes(3);
    // The map itself never paints terrain cells: its own fillRects are the
    // dynamic layers (buildings, vehicles), far fewer than one per cell.
    expect(map.fillRect.mock.calls.length).toBeLessThan(paintedOnce);
    minimap.dispose();
  });

  it('repaints the offscreen layer once the terrain changes', () => {
    const contexts = stubContexts();
    const minimap = new MiniMap(document.body);
    const [, layer] = contexts as [FakeContext, FakeContext];
    const state = makeGameContext({ seed: 42, size: 32 }).state!;
    minimap.update(state);
    const paintedOnce = layer.fillRect.mock.calls.length;

    const nav = state.navGrid!;
    nav.cellAt(nav.originX + 2, nav.originZ + 2)!.benchLevel += 1;
    minimap.update(state);

    expect(layer.clearRect).toHaveBeenCalledTimes(2);
    expect(layer.fillRect.mock.calls.length).toBe(paintedOnce * 2);
    minimap.dispose();
  });

  it('paints straight onto the map when no offscreen context can be had', () => {
    const created: FakeContext[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      // First canvas is the map; the offscreen layer gets no context (jsdom's own answer).
      if (created.length > 0) return null;
      const ctx = fakeContext();
      created.push(ctx);
      return ctx as unknown as CanvasRenderingContext2D;
    } as never);
    const minimap = new MiniMap(document.body);
    const state = makeGameContext({ seed: 42, size: 32 }).state!;

    minimap.update(state);
    minimap.update(state);

    const map = created[0]!;
    expect(map.drawImage).not.toHaveBeenCalled();
    expect(map.fillRect.mock.calls.length).toBeGreaterThanOrEqual(2 * 32 * 32);
    minimap.dispose();
  });
});
