// BlastSimulator2026 — Ambient wind: single global wind vector, seeded and
// weather-driven (#458 T7.1/D12/A24)
//
// Renderer-only, pure math (no THREE/DOM dependency) so it's trivially
// Node-testable. Core stays untouched — wind is "purely cosmetic" per the
// issue, and every ambient module (clouds, birds, smoke, water, vegetation
// sway) reads the same WindState instance so they all lean the same way.

import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { cellRand } from '../../core/math/Hash.js';

/** Wind target speed per weather state — storm gusts hardest, sunny barely stirs. */
const TARGET_SPEED: Record<WeatherState, number> = {
  sunny: 0.15,
  cloudy: 0.3,
  light_rain: 0.45,
  heavy_rain: 0.65,
  storm: 1.0,
  heat_wave: 0.1,
  cold_snap: 0.35,
};

/** Seconds to converge ~63% of the way to a new target speed after a weather change. */
const SPEED_CONVERGENCE_RATE = 0.1;

/** Salt distinguishing the wind's seeded base angle from other cellRand callers. */
const WIND_SALT = 1;

export interface WindVector {
  x: number;
  z: number;
}

/**
 * Single global wind vector (direction + strength), derived from the current
 * weather state with seeded smooth drift so it never looks locked to a
 * single compass heading. `vector` is what every ambient module reads.
 */
export class WindState {
  private readonly baseAngle: number;
  private readonly phase1: number;
  private readonly phase2: number;

  private time = 0;
  private speed = 0;
  private angle: number;

  constructor(seed: number) {
    this.baseAngle = cellRand(seed, 0, 0, WIND_SALT) * Math.PI * 2;
    this.phase1 = cellRand(seed, 1, 0, WIND_SALT) * Math.PI * 2;
    this.phase2 = cellRand(seed, 2, 0, WIND_SALT) * Math.PI * 2;
    this.angle = this.baseAngle;
  }

  /** Advance wind simulation. Call every frame. */
  update(dt: number, weather: WeatherState): void {
    this.time += dt;
    const targetSpeed = TARGET_SPEED[weather];
    this.speed += (targetSpeed - this.speed) * Math.min(1, SPEED_CONVERGENCE_RATE * dt);
    // Slow coherent wander around the seeded base heading — never fully
    // settles on one direction, but never spins wildly either.
    this.angle = this.baseAngle
      + 0.35 * Math.sin(this.time * 0.005 + this.phase1)
      + 0.15 * Math.sin(this.time * 0.013 + this.phase2);
  }

  /** Current wind vector — magnitude is speed (roughly 0.1-1.0), direction is the wander angle. */
  get vector(): WindVector {
    return { x: Math.cos(this.angle) * this.speed, z: Math.sin(this.angle) * this.speed };
  }

  /** Current wind strength, independent of direction — 0 (calm) to ~1 (storm). */
  get speedMagnitude(): number {
    return this.speed;
  }
}
