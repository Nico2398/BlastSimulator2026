import { describe, it, expect, vi } from 'vitest';
import { FragmentAnimator } from '../../../src/renderer/FragmentAnimator.js';
import type { FragmentFlight } from '../../../src/core/mining/BlastResolve.js';
import type { FragmentMesh } from '../../../src/renderer/FragmentMesh.js';

/** A stand-in for FragmentMesh that just records what it was told to draw. */
function recorder() {
  const frames: Array<Map<number, { x: number; y: number; z: number }>> = [];
  const mesh = {
    updatePositions: vi.fn((positions: Map<number, { x: number; y: number; z: number }>) => {
      frames.push(new Map(positions));
    }),
  };
  return { mesh: mesh as unknown as FragmentMesh, frames, spy: mesh.updatePositions };
}

function flight(overrides: Partial<FragmentFlight> = {}): FragmentFlight {
  return {
    fragmentId: 0,
    from: { x: 0, y: 20, z: 0 },
    to: { x: 0, y: 0, z: 0 },
    delayS: 0,
    durationS: 2,
    impactSpeed: 10,
    thrown: false,
    ...overrides,
  };
}

describe('FragmentAnimator', () => {
  it('puts rock at its starting point the moment the blast fires', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);

    animator.begin([flight()]);

    // Without this first write the player would see the finished pile for one
    // frame before the collapse started.
    expect(frames[0]!.get(0)).toEqual({ x: 0, y: 20, z: 0 });
  });

  it('moves rock downward as time passes', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight()]);

    animator.update(0.5);
    animator.update(0.5);

    const heights = frames.map(f => f.get(0)!.y);
    expect(heights[1]!).toBeLessThan(heights[0]!);
    expect(heights[2]!).toBeLessThan(heights[1]!);
  });

  it('finishes with every fragment exactly where the blast put it', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const f = flight({ to: { x: 4, y: 3, z: -2 }, thrown: true });
    animator.begin([f]);

    animator.update(5);

    expect(frames[frames.length - 1]!.get(0)).toEqual(f.to);
  });

  it('stops costing anything once the rock has landed', () => {
    const { mesh, spy } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight()]);

    animator.update(3);
    expect(animator.isPlaying).toBe(false);

    const callsAfterLanding = spy.mock.calls.length;
    animator.update(1);
    animator.update(1);
    expect(spy.mock.calls.length).toBe(callsAfterLanding);
  });

  it('reports itself as playing only while rock is still in the air', () => {
    const { mesh } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight({ durationS: 2 })]);

    expect(animator.isPlaying).toBe(true);
    animator.update(1);
    expect(animator.isPlaying).toBe(true);
    animator.update(1.5);
    expect(animator.isPlaying).toBe(false);
  });

  it('ignores fragments that settled where they already were', () => {
    const { mesh, spy } = recorder();
    const animator = new FragmentAnimator(mesh);

    animator.begin([flight({ from: { x: 1, y: 2, z: 3 }, to: { x: 1, y: 2, z: 3 } })]);

    expect(spy).not.toHaveBeenCalled();
    expect(animator.isPlaying).toBe(false);
  });

  it('holds a delayed fragment still until its turn comes', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight({ delayS: 1 })]);

    animator.update(0.5);
    expect(frames[frames.length - 1]!.get(0)!.y).toBe(20);

    animator.update(1);
    expect(frames[frames.length - 1]!.get(0)!.y).toBeLessThan(20);
  });

  it('animates a whole blast worth of fragments together', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const flights = Array.from({ length: 50 }, (_, i) =>
      flight({ fragmentId: i, from: { x: i, y: 20, z: 0 }, to: { x: i, y: 0, z: 0 } }));

    animator.begin(flights);
    animator.update(1);

    expect(frames[frames.length - 1]!.size).toBe(50);
  });

  it('shrugs off a bad frame time', () => {
    const { mesh } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight()]);

    expect(() => {
      animator.update(Number.NaN);
      animator.update(-1);
      animator.update(0);
    }).not.toThrow();
    expect(animator.isPlaying).toBe(true);
  });

  it('lands everything at once when told to finish', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const near = flight({ fragmentId: 0, to: { x: 4, y: 3, z: -2 }, durationS: 2 });
    const far = flight({ fragmentId: 1, to: { x: 9, y: 1, z: 5 }, durationS: 6, delayS: 1 });
    animator.begin([near, far]);

    animator.finish();

    const last = frames[frames.length - 1]!;
    expect(last.get(0)).toEqual(near.to);
    expect(last.get(1)).toEqual(far.to);
    expect(animator.isPlaying).toBe(false);
  });

  it('costs nothing per frame after finishing', () => {
    const { mesh, spy } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight()]);
    animator.finish();

    const calls = spy.mock.calls.length;
    animator.update(1);

    expect(spy.mock.calls.length).toBe(calls);
  });

  it('finishing a blast with nothing to animate does nothing', () => {
    const { mesh, spy } = recorder();
    const animator = new FragmentAnimator(mesh);

    animator.finish();

    expect(spy).not.toHaveBeenCalled();
  });

  it('drops everything when stopped', () => {
    const { mesh, spy } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight()]);

    animator.stop();
    const calls = spy.mock.calls.length;
    animator.update(1);

    expect(animator.isPlaying).toBe(false);
    expect(spy.mock.calls.length).toBe(calls);
  });
});
