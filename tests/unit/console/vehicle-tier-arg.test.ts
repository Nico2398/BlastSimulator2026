// BlastSimulator2026 — unit tests for parseVehicleTierArg (issue #411)
// Parses/validates the `tier:` named arg for `vehicle buy <role> tier:<1|2|3>`.
// Backward compatible: omitted tier defaults to 1 so existing callers of
// `vehicle buy <role>` (no tier arg) keep working unchanged.

import { describe, it, expect } from 'vitest';
import { parseVehicleTierArg } from '../../../src/console/commands/vehicle.js';

describe('parseVehicleTierArg (#411)', () => {
  it('parses tier:1 to 1', () => {
    expect(parseVehicleTierArg({ tier: '1' })).toBe(1);
  });

  it('parses tier:2 to 2', () => {
    expect(parseVehicleTierArg({ tier: '2' })).toBe(2);
  });

  it('parses tier:3 to 3', () => {
    expect(parseVehicleTierArg({ tier: '3' })).toBe(3);
  });

  it('defaults to tier 1 when the tier arg is omitted', () => {
    expect(parseVehicleTierArg({})).toBe(1);
  });

  it('defaults to tier 1 when other unrelated named args are present but tier is omitted', () => {
    expect(parseVehicleTierArg({ role: 'debris_hauler', at: '1,2' })).toBe(1);
  });

  it('rejects tier:0 as out of range', () => {
    expect(parseVehicleTierArg({ tier: '0' })).toBeNull();
  });

  it('rejects tier:9 as out of range', () => {
    expect(parseVehicleTierArg({ tier: '9' })).toBeNull();
  });

  it('rejects tier:-1 as out of range', () => {
    expect(parseVehicleTierArg({ tier: '-1' })).toBeNull();
  });

  it('rejects non-numeric tier:abc', () => {
    expect(parseVehicleTierArg({ tier: 'abc' })).toBeNull();
  });

  it('rejects an empty tier string', () => {
    expect(parseVehicleTierArg({ tier: '' })).toBeNull();
  });
});
