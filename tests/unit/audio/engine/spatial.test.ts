import { describe, it, expect } from 'vitest';
import type { Listener } from '../../../../src/audio/AudioPlayer.js';
import { computeSpatial } from '../../../../src/audio/engine/spatial.js';
import { SPATIAL_CONFIG } from '../../../../src/core/config/audio/engine.js';

/** Looking along +z with right = +x, at the given camera distance. */
const listener = (viewDistance = 30): Listener => ({ x: 0, z: 0, rightX: 1, rightZ: 0, viewDistance });
const REF = 30 * SPATIAL_CONFIG.referencePerViewMetre;
const CULL = REF * SPATIAL_CONFIG.cullDistanceFactor;

describe('computeSpatial distance', () => {
  it('is full level, centred and unfiltered-ish at zero distance', () => {
    const r = computeSpatial(listener(15), { x: 0, z: 0 });
    expect(r.audible).toBe(true);
    expect(r.gain).toBe(1);
    expect(r.pan).toBe(0);
    expect(r.lowpassHz).toBe(SPATIAL_CONFIG.lowpassMaxHz);
  });

  it('gain and lowpass never rise with distance', () => {
    let gain = Infinity;
    let lowpass = Infinity;
    for (let d = 0; d <= CULL + 10; d += 1) {
      const r = computeSpatial(listener(), { x: 0, z: d });
      expect(r.gain).toBeLessThanOrEqual(gain + 1e-12);
      expect(r.lowpassHz).toBeLessThanOrEqual(lowpass + 1e-9);
      gain = r.gain;
      lowpass = r.lowpassHz;
    }
  });

  it('stays at full level inside the reference distance, then falls', () => {
    const inside = computeSpatial(listener(), { x: 0, z: REF * 0.9 });
    const beyond = computeSpatial(listener(), { x: 0, z: REF * 2 });
    expect(inside.gain).toBeGreaterThan(beyond.gain);
    expect(beyond.gain).toBeCloseTo(0.5 * computeSpatial(listener(), { x: 0, z: 0 }).gain, 6);
  });

  it('keeps a floor level until the cull fade, then fades to silence at the cull distance', () => {
    const farButNear = computeSpatial(listener(), { x: 0, z: CULL * 0.7 });
    expect(farButNear.audible).toBe(true);
    expect(farButNear.gain).toBeGreaterThanOrEqual(SPATIAL_CONFIG.floorGain * computeSpatial(listener(), { x: 0, z: 0 }).gain - 1e-9);
    const atCull = computeSpatial(listener(), { x: 0, z: CULL });
    expect(atCull.audible).toBe(false);
    expect(atCull.gain).toBe(0);
  });

  it('culls everything beyond the cull distance', () => {
    expect(computeSpatial(listener(), { x: 0, z: CULL * 3 }).audible).toBe(false);
    expect(computeSpatial(listener(), { x: CULL, z: CULL }).audible).toBe(false);
  });

  it('fades smoothly across the cull edge instead of cutting', () => {
    const before = computeSpatial(listener(), { x: 0, z: CULL * 0.95 });
    const after = computeSpatial(listener(), { x: 0, z: CULL * 0.99 });
    expect(before.gain).toBeGreaterThan(after.gain);
    expect(after.gain).toBeLessThan(SPATIAL_CONFIG.floorGain);
  });

  it('never goes below the air-absorption floor frequency', () => {
    expect(computeSpatial(listener(), { x: 0, z: 1e6 }).lowpassHz).toBe(SPATIAL_CONFIG.lowpassMinHz);
  });
});

describe('computeSpatial pan', () => {
  it('pans right for sources on the right and left for the left, symmetrically', () => {
    const right = computeSpatial(listener(), { x: 20, z: 0 });
    const left = computeSpatial(listener(), { x: -20, z: 0 });
    expect(right.pan).toBeGreaterThan(0.5);
    expect(left.pan).toBeCloseTo(-right.pan, 12);
    expect(left.gain).toBe(right.gain);
    expect(left.lowpassHz).toBe(right.lowpassHz);
  });

  it('is centred for a source straight ahead or behind', () => {
    expect(computeSpatial(listener(), { x: 0, z: 25 }).pan).toBe(0);
    expect(Math.abs(computeSpatial(listener(), { x: 0, z: -25 }).pan)).toBe(0);
  });

  it('never exceeds the max pan', () => {
    expect(computeSpatial(listener(), { x: 500, z: 0 }).pan).toBeLessThanOrEqual(SPATIAL_CONFIG.maxPan);
    expect(computeSpatial(listener(), { x: -500, z: 0 }).pan).toBeGreaterThanOrEqual(-SPATIAL_CONFIG.maxPan);
  });

  it('eases toward centre for a source right next to the listener', () => {
    const near = computeSpatial(listener(), { x: 0.5, z: 0 });
    const away = computeSpatial(listener(), { x: 10, z: 0 });
    expect(Math.abs(near.pan)).toBeLessThan(Math.abs(away.pan));
  });

  it('follows the listener orientation', () => {
    const turned: Listener = { x: 0, z: 0, rightX: 0, rightZ: 1, viewDistance: 30 };
    expect(computeSpatial(turned, { x: 0, z: 20 }).pan).toBeGreaterThan(0.5);
    expect(computeSpatial(turned, { x: 20, z: 0 }).pan).toBe(0);
  });
});

describe('computeSpatial zoom', () => {
  it('a zoomed-out camera hears farther but quieter', () => {
    const point = { x: 0, z: 90 };
    const close = computeSpatial(listener(15), point);
    const wide = computeSpatial(listener(150), point);
    expect(close.audible).toBe(false);
    expect(wide.audible).toBe(true);
    const sameSpot = { x: 0, z: 0 };
    expect(computeSpatial(listener(150), sameSpot).gain).toBeLessThan(computeSpatial(listener(15), sameSpot).gain);
  });

  it('the zoom trim never drops below its minimum', () => {
    const r = computeSpatial(listener(1e6), { x: 0, z: 0 });
    expect(r.gain).toBe(SPATIAL_CONFIG.zoomTrimMin);
  });

  it('accepts a custom config', () => {
    const cfg = { ...SPATIAL_CONFIG, cullDistanceFactor: 1.5 };
    expect(computeSpatial(listener(), { x: 0, z: REF * 2 }, cfg).audible).toBe(false);
    expect(computeSpatial(listener(), { x: 0, z: REF * 2 }).audible).toBe(true);
  });
});
