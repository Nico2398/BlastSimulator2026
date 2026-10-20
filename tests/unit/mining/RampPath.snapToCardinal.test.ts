// BlastSimulator2026 — snapToCardinal unit tests (#1942)
// The ramp tool snaps every clicked corner onto the cardinal axis of the previous one.

import { describe, it, expect } from 'vitest';
import { snapToCardinal } from '../../../src/core/mining/RampPath.js';

describe('snapToCardinal', () => {
  it('keeps a target already on the z axis', () => {
    expect(snapToCardinal({ x: 5, z: 5 }, { x: 5, z: 12 })).toEqual({ x: 5, z: 12 });
  });

  it('keeps a target already on the x axis', () => {
    expect(snapToCardinal({ x: 5, z: 5 }, { x: 14, z: 5 })).toEqual({ x: 14, z: 5 });
  });

  it('snaps to the x axis when |dx| dominates', () => {
    expect(snapToCardinal({ x: 5, z: 5 }, { x: 15, z: 8 })).toEqual({ x: 15, z: 5 });
  });

  it('snaps to the z axis when |dz| dominates', () => {
    expect(snapToCardinal({ x: 5, z: 5 }, { x: 7, z: 20 })).toEqual({ x: 5, z: 20 });
  });

  it('handles negative deltas on both axes', () => {
    expect(snapToCardinal({ x: 10, z: 10 }, { x: 2, z: 9 })).toEqual({ x: 2, z: 10 });
    expect(snapToCardinal({ x: 10, z: 10 }, { x: 9, z: 1 })).toEqual({ x: 10, z: 1 });
  });

  it('a diagonal tie goes to z, as rampDefFromEndpoints does', () => {
    expect(snapToCardinal({ x: 5, z: 5 }, { x: 9, z: 9 })).toEqual({ x: 5, z: 9 });
    expect(snapToCardinal({ x: 5, z: 5 }, { x: 1, z: 1 })).toEqual({ x: 5, z: 1 });
  });

  it('a zero delta returns the from tile', () => {
    expect(snapToCardinal({ x: 7, z: 3 }, { x: 7, z: 3 })).toEqual({ x: 7, z: 3 });
  });

  it('a one-tile step snaps to the axis it moves along', () => {
    expect(snapToCardinal({ x: 7, z: 3 }, { x: 8, z: 3 })).toEqual({ x: 8, z: 3 });
    expect(snapToCardinal({ x: 7, z: 3 }, { x: 7, z: 2 })).toEqual({ x: 7, z: 2 });
  });
});
