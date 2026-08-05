import { describe, it, expect } from 'vitest';
import { flightPositionAt, totalFlightDuration, type FragmentFlight } from '../../../src/core/mining/BlastResolve.js';

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

describe('flightPositionAt', () => {
  it('sits at the start before it is due to move', () => {
    const f = flight({ delayS: 1.5 });

    expect(flightPositionAt(f, 0)).toEqual(f.from);
    expect(flightPositionAt(f, 1.4)).toEqual(f.from);
  });

  it('arrives exactly at the resting place, so the picture can never drift from the game state', () => {
    const f = flight({ from: { x: 3, y: 18, z: -4 }, to: { x: 9, y: 2, z: 5 }, durationS: 1.7, thrown: true });

    expect(flightPositionAt(f, 1.7)).toEqual(f.to);
    expect(flightPositionAt(f, 99)).toEqual(f.to);
  });

  it('is somewhere between the two while it travels', () => {
    const f = flight({ from: { x: 0, y: 20, z: 0 }, to: { x: 10, y: 0, z: 0 }, thrown: true });
    const mid = flightPositionAt(f, 1);

    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(10);
    expect(mid.y).toBeLessThan(20);
    expect(mid.y).toBeGreaterThan(0);
  });

  it('moves horizontally at a steady rate', () => {
    const f = flight({ from: { x: 0, y: 10, z: 0 }, to: { x: 8, y: 0, z: 4 }, durationS: 2, thrown: true });

    expect(flightPositionAt(f, 0.5).x).toBeCloseTo(2, 6);
    expect(flightPositionAt(f, 1.0).x).toBeCloseTo(4, 6);
    expect(flightPositionAt(f, 1.5).x).toBeCloseTo(6, 6);
    expect(flightPositionAt(f, 1.0).z).toBeCloseTo(2, 6);
  });

  it('falls under gravity rather than sliding down in a straight line', () => {
    const f = flight({ from: { x: 0, y: 20, z: 0 }, to: { x: 0, y: 0, z: 0 }, durationS: 2 });
    const halfway = flightPositionAt(f, 1).y;

    // A straight line would put it at 10; gravity keeps it higher for longer.
    expect(halfway).toBeGreaterThan(10);
  });

  it('throws rock upward first when it has to clear a rise', () => {
    // Landing higher than it started: the only way there is up and over.
    const f = flight({ from: { x: 0, y: 4, z: 0 }, to: { x: 10, y: 6, z: 0 }, durationS: 2, thrown: true });

    expect(flightPositionAt(f, 1).y).toBeGreaterThan(6);
  });

  it('accounts for the delay, so a staggered collapse ripples', () => {
    const f = flight({ delayS: 1, durationS: 2 });

    expect(flightPositionAt(f, 1)).toEqual(f.from);
    expect(flightPositionAt(f, 3)).toEqual(f.to);
    expect(flightPositionAt(f, 2).y).toBeLessThan(f.from.y);
  });

  it('snaps to the destination for a zero-length flight', () => {
    const f = flight({ durationS: 0 });
    expect(flightPositionAt(f, 0.5)).toEqual(f.to);
  });
});

describe('totalFlightDuration', () => {
  it('is when the last fragment lands, delay included', () => {
    expect(totalFlightDuration([
      flight({ fragmentId: 0, delayS: 0, durationS: 2 }),
      flight({ fragmentId: 1, delayS: 3, durationS: 1.5 }),
      flight({ fragmentId: 2, delayS: 1, durationS: 1 }),
    ])).toBeCloseTo(4.5, 6);
  });

  it('is zero for a blast that moved nothing', () => {
    expect(totalFlightDuration([])).toBe(0);
  });
});
