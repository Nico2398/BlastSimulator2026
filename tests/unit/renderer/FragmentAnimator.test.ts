import { describe, it, expect, vi } from 'vitest';
import { FragmentAnimator } from '../../../src/renderer/FragmentAnimator.js';
import type { FragmentFlight } from '../../../src/core/mining/BlastResolve.js';
import type { FragmentMesh, FragmentInstanceTransform } from '../../../src/renderer/FragmentMesh.js';
import { TUMBLE_DROP_FACTOR, SETTLE_DURATION_S } from '../../../src/core/config/balance.js';

/** A stand-in for FragmentMesh that just records what it was told to draw. */
function recorder() {
  const frames: Array<Map<number, FragmentInstanceTransform>> = [];
  const mesh = {
    updateTransforms: vi.fn((transforms: Map<number, FragmentInstanceTransform>) => {
      frames.push(new Map(transforms));
    }),
  };
  return { mesh: mesh as unknown as FragmentMesh, frames, spy: mesh.updateTransforms };
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

/** Reads just x/y/z off a transform, ignoring tumble/settle fields (#485). */
function pos(t: FragmentInstanceTransform | undefined): { x: number; y: number; z: number } {
  return { x: t!.x, y: t!.y, z: t!.z };
}

describe('FragmentAnimator', () => {
  it('puts rock at its starting point the moment the blast fires', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);

    animator.begin([flight()]);

    // Without this first write the player would see the finished pile for one
    // frame before the collapse started.
    expect(pos(frames[0]!.get(0))).toEqual({ x: 0, y: 20, z: 0 });
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

    expect(pos(frames[frames.length - 1]!.get(0))).toEqual(f.to);
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

  it('shows the collapse at the moment asked for', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const f = flight({ from: { x: 0, y: 20, z: 0 }, to: { x: 0, y: 0, z: 0 }, durationS: 2 });
    animator.begin([f]);

    animator.seek(1);
    const half = frames[frames.length - 1]!.get(0)!;

    expect(half.y).toBeLessThan(20);
    expect(half.y).toBeGreaterThan(0);
  });

  it('seeks backward as readily as forward', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight({ durationS: 4 })]);

    animator.seek(3);
    const late = frames[frames.length - 1]!.get(0)!.y;
    animator.seek(1);
    const early = frames[frames.length - 1]!.get(0)!.y;

    expect(early).toBeGreaterThan(late);
  });

  it('clamps a seek to the collapse it is playing', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const f = flight({ to: { x: 4, y: 3, z: -2 }, durationS: 2 });
    animator.begin([f]);

    animator.seek(99);

    expect(pos(frames[frames.length - 1]!.get(0))).toEqual(f.to);
    expect(animator.isPlaying).toBe(false);
  });

  it('holds a seeked collapse still against the render loop', () => {
    // A harness stepping through a blast must land on the moments it asked for,
    // not on whatever the next frame does to them.
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight({ durationS: 4 })]);

    animator.seek(1);
    const held = frames[frames.length - 1]!.get(0)!;
    animator.update(1);

    expect(frames[frames.length - 1]!.get(0)).toEqual(held);
  });

  it('reports how long the collapse it is playing takes', () => {
    const { mesh } = recorder();
    const animator = new FragmentAnimator(mesh);

    expect(animator.durationS).toBe(0);
    animator.begin([flight({ durationS: 2, delayS: 1.5 })]);

    expect(animator.durationS).toBeCloseTo(3.5, 6);
  });

  it('lands everything at once when told to finish', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const near = flight({ fragmentId: 0, to: { x: 4, y: 3, z: -2 }, durationS: 2 });
    const far = flight({ fragmentId: 1, to: { x: 9, y: 1, z: 5 }, durationS: 6, delayS: 1 });
    animator.begin([near, far]);

    animator.finish();

    const last = frames[frames.length - 1]!;
    expect(pos(last.get(0))).toEqual(near.to);
    expect(pos(last.get(1))).toEqual(far.to);
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

  // ─── Tumble and settle (#485) ────────────────────────────────────────────

  it('tumbles more as a thrown fragment falls, not just a fixed pose', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const f = flight({ thrown: true, impactSpeed: 20, durationS: 2 });
    animator.begin([f]);

    animator.seek(0.5);
    const early = frames[frames.length - 1]!.get(0)!.tumbleAngle;
    animator.seek(1.0);
    const mid = frames[frames.length - 1]!.get(0)!.tumbleAngle;
    animator.seek(1.5);
    const late = frames[frames.length - 1]!.get(0)!.tumbleAngle;

    expect(Math.abs(mid)).toBeGreaterThan(Math.abs(early));
    expect(Math.abs(late)).toBeGreaterThan(Math.abs(mid));
  });

  it('tumbles far less when dropped than when thrown, at the same impact speed', () => {
    const { mesh: thrownMesh, frames: thrownFrames } = recorder();
    const thrownAnimator = new FragmentAnimator(thrownMesh);
    thrownAnimator.begin([flight({ thrown: true, impactSpeed: 15, durationS: 2 })]);
    thrownAnimator.seek(1.0);
    const thrownAngle = thrownFrames[thrownFrames.length - 1]!.get(0)!.tumbleAngle;

    const { mesh: droppedMesh, frames: droppedFrames } = recorder();
    const droppedAnimator = new FragmentAnimator(droppedMesh);
    droppedAnimator.begin([flight({ thrown: false, impactSpeed: 15, durationS: 2 })]);
    droppedAnimator.seek(1.0);
    const droppedAngle = droppedFrames[droppedFrames.length - 1]!.get(0)!.tumbleAngle;

    expect(Math.abs(droppedAngle)).toBeLessThan(Math.abs(thrownAngle));
    // "Bounded by the drop factor ratio" — a small margin covers rounding, not a
    // different formula entirely.
    expect(Math.abs(droppedAngle)).toBeLessThanOrEqual(Math.abs(thrownAngle) * TUMBLE_DROP_FACTOR + 1e-6);
  });

  it('barely tumbles at all when the impact speed is near zero, thrown or dropped', () => {
    for (const thrown of [true, false]) {
      const { mesh, frames } = recorder();
      const animator = new FragmentAnimator(mesh);
      animator.begin([flight({ thrown, impactSpeed: 0.0001, durationS: 2 })]);

      for (const t of [0.25, 0.5, 1, 1.5]) {
        animator.seek(t);
        const angle = frames[frames.length - 1]!.get(0)!.tumbleAngle;
        expect(Math.abs(angle)).toBeLessThan(0.01);
      }
    }
  });

  it('holds a fully settled fragment at exactly no tumble and no squash', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const f = flight({ thrown: true, impactSpeed: 15, durationS: 2, delayS: 0.5 });
    animator.begin([f]);

    animator.seek(f.delayS + f.durationS + SETTLE_DURATION_S);
    const settled = frames[frames.length - 1]!.get(0)!;

    expect(settled.tumbleAngle).toBe(0);
    expect(settled.settleScale).toEqual({ x: 1, y: 1, z: 1 });

    // Stays settled well past the settle window too.
    animator.seek(f.delayS + f.durationS + SETTLE_DURATION_S + 10);
    const later = frames[frames.length - 1]!.get(0)!;
    expect(later.tumbleAngle).toBe(0);
    expect(later.settleScale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('squashes away from identity mid-settle and returns to identity by window end, with no jump at landing', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const f = flight({ thrown: true, impactSpeed: 12, durationS: 2, delayS: 0 });
    animator.begin([f]);
    const landingT = f.delayS + f.durationS;

    animator.seek(landingT - 0.001);
    const justBeforeLanding = frames[frames.length - 1]!.get(0)!;

    animator.seek(landingT);
    const atLanding = frames[frames.length - 1]!.get(0)!;

    animator.seek(landingT + SETTLE_DURATION_S * 0.5);
    const midSettle = frames[frames.length - 1]!.get(0)!;

    animator.seek(landingT + SETTLE_DURATION_S);
    const endSettle = frames[frames.length - 1]!.get(0)!;

    // Settle starts exactly where flight left off — no discontinuous pop.
    expect(atLanding.settleScale).toEqual({ x: 1, y: 1, z: 1 });
    expect(Math.abs(atLanding.tumbleAngle - justBeforeLanding.tumbleAngle)).toBeLessThan(0.05);

    // Somewhere in the settle window the scale visibly deviates from identity —
    // that's the bounce/squash the issue asks for.
    const deviatesFromIdentity =
      midSettle.settleScale.x !== 1 || midSettle.settleScale.y !== 1 || midSettle.settleScale.z !== 1;
    expect(deviatesFromIdentity).toBe(true);

    // And it's back to exact identity by the end of the settle window.
    expect(endSettle.settleScale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('keeps resting position exact regardless of tumble/settle', () => {
    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    const f = flight({ to: { x: 4, y: 3, z: -2 }, thrown: true, impactSpeed: 30, durationS: 2 });
    animator.begin([f]);

    animator.seek(f.durationS + SETTLE_DURATION_S);
    const settled = frames[frames.length - 1]!.get(0)!;

    expect(pos(settled)).toEqual(f.to);
  });

  it('reaches identical tumble/settle values by seeking directly or by accumulating update() calls', () => {
    const { mesh: seekMesh, frames: seekFrames } = recorder();
    const seekAnimator = new FragmentAnimator(seekMesh);
    seekAnimator.begin([flight({ thrown: true, impactSpeed: 18, durationS: 2 })]);
    seekAnimator.seek(1.3);
    const seeked = seekFrames[seekFrames.length - 1]!.get(0)!;

    const { mesh: stepMesh, frames: stepFrames } = recorder();
    const stepAnimator = new FragmentAnimator(stepMesh);
    stepAnimator.begin([flight({ thrown: true, impactSpeed: 18, durationS: 2 })]);
    stepAnimator.update(0.3);
    stepAnimator.update(0.4);
    stepAnimator.update(0.6);
    const stepped = stepFrames[stepFrames.length - 1]!.get(0)!;

    expect(stepped.tumbleAngle).toBeCloseTo(seeked.tumbleAngle, 9);
    expect(stepped.settleScale.x).toBeCloseTo(seeked.settleScale.x, 9);
    expect(stepped.settleScale.y).toBeCloseTo(seeked.settleScale.y, 9);
    expect(stepped.settleScale.z).toBeCloseTo(seeked.settleScale.z, 9);
  });

  it('produces identical tumble/settle sequences for identical flight input across separate animators', () => {
    const makeRun = () => {
      const { mesh, frames } = recorder();
      const animator = new FragmentAnimator(mesh);
      animator.begin([flight({ thrown: true, impactSpeed: 22, durationS: 2, delayS: 0.3 })]);
      const samples: FragmentInstanceTransform[] = [];
      for (const t of [0, 0.5, 1, 1.5, 2, 2.2, 2.5]) {
        animator.seek(t);
        samples.push(frames[frames.length - 1]!.get(0)!);
      }
      return samples;
    };

    expect(makeRun()).toEqual(makeRun());
  });

  it('stops costing anything only once settle has finished, not merely on landing', () => {
    const { mesh, spy } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([flight({ durationS: 2 })]);

    animator.update(2); // exactly at the landing instant
    expect(animator.isPlaying).toBe(true);

    animator.update(SETTLE_DURATION_S);
    expect(animator.isPlaying).toBe(false);

    const callsAfterSettle = spy.mock.calls.length;
    animator.update(1);
    animator.update(1);
    expect(spy.mock.calls.length).toBe(callsAfterSettle);
  });

  it('settles each fragment independently even when several land in the same frame', () => {
    const a = flight({ fragmentId: 0, thrown: true, impactSpeed: 5, durationS: 2, delayS: 0 });
    const b = flight({ fragmentId: 1, thrown: true, impactSpeed: 40, durationS: 1, delayS: 1 });
    const sampleT = 2 + SETTLE_DURATION_S * 0.5; // both land at t=2

    const { mesh, frames } = recorder();
    const animator = new FragmentAnimator(mesh);
    animator.begin([a, b]);
    animator.seek(sampleT);
    const combined = frames[frames.length - 1]!;

    const { mesh: meshA, frames: framesA } = recorder();
    const animatorA = new FragmentAnimator(meshA);
    animatorA.begin([a]);
    animatorA.seek(sampleT);
    const soloA = framesA[framesA.length - 1]!.get(0)!;

    const { mesh: meshB, frames: framesB } = recorder();
    const animatorB = new FragmentAnimator(meshB);
    animatorB.begin([b]);
    animatorB.seek(sampleT);
    const soloB = framesB[framesB.length - 1]!.get(1)!;

    expect(combined.get(0)!.tumbleAngle).toBeCloseTo(soloA.tumbleAngle, 9);
    expect(combined.get(0)!.settleScale).toEqual(soloA.settleScale);
    expect(combined.get(1)!.tumbleAngle).toBeCloseTo(soloB.tumbleAngle, 9);
    expect(combined.get(1)!.settleScale).toEqual(soloB.settleScale);
  });
});
