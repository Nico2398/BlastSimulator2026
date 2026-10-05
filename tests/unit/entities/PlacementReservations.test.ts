import { describe, it, expect } from 'vitest';
import {
  terrainReservations,
  reservationBlocking,
  RESERVATION_REFUSAL,
  type TerrainReservation,
} from '../../../src/core/entities/PlacementReservations.js';

const ramp = (minX: number, maxX: number, minZ: number, maxZ: number): TerrainReservation =>
  ({ kind: 'ramp', minX, maxX, minZ, maxZ });
const hole = (x: number, z: number): TerrainReservation =>
  ({ kind: 'hole', minX: x, maxX: x, minZ: z, maxZ: z });

function stateWith(over: Record<string, unknown> = {}) {
  return { builtRamps: [], plannedRamps: [], drillHoles: [], plannedDrillHoles: [], ...over } as any;
}

describe('RESERVATION_REFUSAL', () => {
  it('maps each kind to its shell.placement key', () => {
    expect(RESERVATION_REFUSAL.ramp.errorKey).toBe('shell.placement.refused_ramp');
    expect(RESERVATION_REFUSAL.hole.errorKey).toBe('shell.placement.refused_hole');
  });

  it('carries the English fallback beside each key', () => {
    expect(RESERVATION_REFUSAL.ramp.error).toBe('Blocks a ramp');
    expect(RESERVATION_REFUSAL.hole.error).toBe('Blocks a drill hole');
  });
});

describe('terrainReservations (#1390)', () => {
  it('returns nothing for an empty state', () => {
    expect(terrainReservations(stateWith())).toEqual([]);
  });

  it('covers a built ramp footprint inclusively', () => {
    const r = terrainReservations(stateWith({
      builtRamps: [{ id: 1, footprint: { minX: 29, maxX: 31, minZ: 20, maxZ: 39 } }],
    }));
    expect(r).toEqual([ramp(29, 31, 20, 39)]);
  });

  it('covers a planned ramp footprint inclusively', () => {
    const r = terrainReservations(stateWith({
      plannedRamps: [{ id: 2, footprint: { minX: 5, maxX: 7, minZ: 8, maxZ: 12 }, segments: [] }],
    }));
    expect(r).toEqual([ramp(5, 7, 8, 12)]);
  });

  it('covers a drilled hole as a 1x1 cell', () => {
    const r = terrainReservations(stateWith({ drillHoles: [{ id: 'H1', x: 20, z: 40, depth: 8, diameter: 0.1 }] }));
    expect(r).toEqual([hole(20, 40)]);
  });

  it('floors fractional hole coordinates to the containing cell', () => {
    const r = terrainReservations(stateWith({ drillHoles: [{ id: 'H1', x: 20.9, z: 40.2, depth: 8, diameter: 0.1 }] }));
    expect(r).toEqual([hole(20, 40)]);
  });

  it('covers a planned hole as a 1x1 cell', () => {
    const r = terrainReservations(stateWith({ plannedDrillHoles: [{ id: 'H2', x: 3, z: 4, depth: 8, diameter: 0.1 }] }));
    expect(r).toEqual([hole(3, 4)]);
  });

  it('combines all four sources', () => {
    const r = terrainReservations(stateWith({
      builtRamps: [{ id: 1, footprint: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } }],
      plannedRamps: [{ id: 2, footprint: { minX: 4, maxX: 5, minZ: 4, maxZ: 5 }, segments: [] }],
      drillHoles: [{ id: 'H1', x: 9, z: 9, depth: 1, diameter: 0.1 }],
      plannedDrillHoles: [{ id: 'H2', x: 10, z: 10, depth: 1, diameter: 0.1 }],
    }));
    expect(r).toHaveLength(4);
    expect(r.filter(x => x.kind === 'ramp')).toHaveLength(2);
    expect(r.filter(x => x.kind === 'hole')).toHaveLength(2);
  });
});

describe('reservationBlocking (#1390)', () => {
  const rampR = [ramp(29, 31, 20, 39)];

  it('returns null with no reservations', () => {
    expect(reservationBlocking([], { minX: 0, minZ: 0, maxX: 100, maxZ: 100 })).toBeNull();
  });

  it('blocks a rect overlapping the reservation', () => {
    expect(reservationBlocking(rampR, { minX: 28, minZ: 19, maxX: 30, maxZ: 21 })).toBe('ramp');
  });

  it('blocks when the rect min cell equals the reservation max cell (inclusive reservation)', () => {
    expect(reservationBlocking(rampR, { minX: 31, minZ: 39, maxX: 33, maxZ: 41 })).toBe('ramp');
  });

  it('accepts a rect whose max-exclusive edge touches the reservation min', () => {
    expect(reservationBlocking(rampR, { minX: 27, minZ: 20, maxX: 29, maxZ: 22 })).toBeNull();
  });

  it('accepts a rect starting just past the reservation max', () => {
    expect(reservationBlocking(rampR, { minX: 32, minZ: 20, maxX: 34, maxZ: 22 })).toBeNull();
    expect(reservationBlocking(rampR, { minX: 29, minZ: 40, maxX: 31, maxZ: 42 })).toBeNull();
  });

  it('blocks a rect covering a single hole cell', () => {
    expect(reservationBlocking([hole(20, 40)], { minX: 19, minZ: 39, maxX: 21, maxZ: 41 })).toBe('hole');
  });

  it('accepts a rect whose max-exclusive edge ends at the hole cell', () => {
    expect(reservationBlocking([hole(20, 40)], { minX: 18, minZ: 40, maxX: 20, maxZ: 42 })).toBeNull();
  });

  it('reports ramp when ramp and hole both overlap', () => {
    const both = [hole(30, 30), ramp(29, 31, 20, 39)];
    expect(reservationBlocking(both, { minX: 29, minZ: 29, maxX: 32, maxZ: 32 })).toBe('ramp');
    expect(reservationBlocking([...both].reverse(), { minX: 29, minZ: 29, maxX: 32, maxZ: 32 })).toBe('ramp');
  });
});
