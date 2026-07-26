// BlastSimulator2026 — Tutorial picker constraint

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPickerRegion,
  getPickerRegion,
  regionContains,
  regionContainsSelection,
} from '../../../src/ui/tutorialPickerRegion.js';

const AREA = { x1: 8, z1: 8, x2: 16, z2: 16 };

beforeEach(() => setPickerRegion(null));

describe('picker region handoff', () => {
  it('starts with no constraint, so an ordinary game is unrestricted', () => {
    expect(getPickerRegion()).toBeNull();
  });

  it('publishes and lifts a region', () => {
    setPickerRegion(AREA);
    expect(getPickerRegion()).toEqual(AREA);
    setPickerRegion(null);
    expect(getPickerRegion()).toBeNull();
  });

  it('hands out a copy, so a picker cannot mutate the published area', () => {
    setPickerRegion(AREA);
    const got = getPickerRegion()!;
    got.x1 = 0;
    expect(getPickerRegion()!.x1).toBe(8);
  });

  it('keeps its own copy, so later mutation by the caller does not move the area', () => {
    const mutable = { ...AREA };
    setPickerRegion(mutable);
    mutable.x1 = 0;
    expect(getPickerRegion()!.x1).toBe(8);
  });
});

describe('regionContains', () => {
  it('accepts a tile inside', () => {
    expect(regionContains(AREA, 12, 12)).toBe(true);
  });

  it('is inclusive of the edges', () => {
    expect(regionContains(AREA, 8, 8)).toBe(true);
    expect(regionContains(AREA, 16, 16)).toBe(true);
  });

  it('rejects a tile just outside', () => {
    expect(regionContains(AREA, 7, 12)).toBe(false);
    expect(regionContains(AREA, 17, 12)).toBe(false);
    expect(regionContains(AREA, 12, 7)).toBe(false);
    expect(regionContains(AREA, 12, 17)).toBe(false);
  });
});

describe('regionContainsSelection', () => {
  it('accepts a rectangle fully inside', () => {
    expect(regionContainsSelection(AREA, { x1: 9, z1: 9, x2: 15, z2: 15 })).toBe(true);
  });

  it('accepts a rectangle exactly filling the area', () => {
    expect(regionContainsSelection(AREA, { x1: 8, z1: 8, x2: 16, z2: 16 })).toBe(true);
  });

  it('rejects a rectangle that starts inside and runs out', () => {
    // The grid tool's whole problem: a drag that begins in the pit and ends in
    // a corner of the map the step knows nothing about.
    expect(regionContainsSelection(AREA, { x1: 10, z1: 10, x2: 22, z2: 22 })).toBe(false);
  });

  it('rejects a rectangle that starts outside', () => {
    expect(regionContainsSelection(AREA, { x1: 2, z1: 2, x2: 10, z2: 10 })).toBe(false);
  });

  it('rejects a rectangle entirely elsewhere', () => {
    expect(regionContainsSelection(AREA, { x1: 20, z1: 20, x2: 22, z2: 22 })).toBe(false);
  });

  it('accepts a single tile inside', () => {
    expect(regionContainsSelection(AREA, { x1: 12, z1: 12, x2: 12, z2: 12 })).toBe(true);
  });
});
