// BlastSimulator2026 — rampLegSpecs unit tests (#1942): the ramp preview follows every leg.

import { describe, it, expect } from 'vitest';
import { rampLegSpecs } from '../../../src/renderer/RampArrow.js';

describe('rampLegSpecs', () => {
  it('a straight ramp gives one spec carrying its origin, direction, length and width', () => {
    const specs = rampLegSpecs({ originX: 20, originZ: 20, direction: 'south', length: 11, width: 5 });
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ originX: 20, originZ: 20, direction: 'south', length: 11, width: 5 });
  });

  it('a two-leg switchback gives one spec per leg, the second starting at the corner', () => {
    const specs = rampLegSpecs({
      originX: 15, originZ: 15, direction: 'south', length: 22, width: 3,
      legs: [{ direction: 'south', length: 12 }, { direction: 'east', length: 10 }],
    });
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ originX: 15, originZ: 15, direction: 'south', length: 12, width: 3 });
    expect(specs[1]).toMatchObject({ originX: 15, originZ: 27, direction: 'east', length: 10, width: 3 });
  });

  it('three legs chain corner to corner', () => {
    const specs = rampLegSpecs({
      originX: 10, originZ: 10, direction: 'east', length: 15,
      legs: [{ direction: 'east', length: 5 }, { direction: 'south', length: 4 }, { direction: 'west', length: 6 }],
    });
    expect(specs.map(s => [s.originX, s.originZ, s.direction, s.length])).toEqual([
      [10, 10, 'east', 5], [15, 10, 'south', 4], [15, 14, 'west', 6],
    ]);
  });
});
