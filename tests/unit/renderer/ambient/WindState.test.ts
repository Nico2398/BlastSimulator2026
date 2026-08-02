// WindState — unit tests (#458 T7.1/D12/A24)

import { describe, it, expect } from 'vitest';
import { WindState } from '../../../../src/renderer/ambient/WindState.js';
import type { WeatherState } from '../../../../src/core/weather/WeatherCycle.js';

function vecLength(v: { x: number; z: number }): number {
  return Math.hypot(v.x, v.z);
}

describe('WindState', () => {
  it('starts at zero speed regardless of seed', () => {
    const w = new WindState(42);
    expect(w.speedMagnitude).toBe(0);
    expect(vecLength(w.vector)).toBe(0);
  });

  it('speed converges toward the weather target over repeated updates', () => {
    const w = new WindState(1);
    for (let i = 0; i < 500; i++) w.update(0.1, 'storm');
    // storm target is 1.0 — should have converged close to it.
    expect(w.speedMagnitude).toBeGreaterThan(0.9);
    expect(w.speedMagnitude).toBeLessThanOrEqual(1.0);
  });

  it('speed tracks a low-wind weather state down from a high one', () => {
    const w = new WindState(1);
    for (let i = 0; i < 500; i++) w.update(0.1, 'storm');
    const stormSpeed = w.speedMagnitude;
    for (let i = 0; i < 500; i++) w.update(0.1, 'sunny');
    expect(w.speedMagnitude).toBeLessThan(stormSpeed);
    expect(w.speedMagnitude).toBeCloseTo(0.15, 1); // sunny target
  });

  it('different seeds produce different base headings', () => {
    const a = new WindState(1);
    const b = new WindState(2);
    a.update(0.001, 'storm');
    b.update(0.001, 'storm');
    // Same tiny dt/weather, only the seed differs — angles should differ.
    expect(a.vector.x).not.toBeCloseTo(b.vector.x, 5);
  });

  it('the same seed is fully deterministic', () => {
    const a = new WindState(7);
    const b = new WindState(7);
    for (let i = 0; i < 100; i++) {
      a.update(0.05, 'cloudy');
      b.update(0.05, 'cloudy');
    }
    expect(a.vector.x).toBe(b.vector.x);
    expect(a.vector.z).toBe(b.vector.z);
  });

  it('wind vector magnitude never exceeds the highest weather target (storm, 1.0)', () => {
    const w = new WindState(3);
    const states: WeatherState[] = ['sunny', 'storm', 'cloudy', 'storm', 'heat_wave'];
    let maxSpeed = 0;
    for (const s of states) {
      for (let i = 0; i < 200; i++) {
        w.update(0.05, s);
        maxSpeed = Math.max(maxSpeed, w.speedMagnitude);
      }
    }
    expect(maxSpeed).toBeLessThanOrEqual(1.0001);
  });
});
