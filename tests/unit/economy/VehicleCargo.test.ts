// Vehicle cargo ore composition (#1761).
import { describe, it, expect } from 'vitest';
import { vehicleCargoByOre } from '../../../src/core/economy/VehicleCargo.js';
import type { TrackedFragment } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { oreContributionKg } from '../../../src/core/mining/BlastOreReport.js';

function frag(id: number, mass: number, oreDensities: Record<string, number>): FragmentData {
  return {
    id, position: { x: 0, y: 0, z: 0 }, volume: mass / 2500, mass, rockId: 'sandite', oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: id, origin: { x: 0, y: 0, z: 0 },
  };
}

function tracked(f: FragmentData): TrackedFragment {
  return { fragment: f, state: 'in_transit', vehicleId: '1', warehouseId: 7 };
}

function cargoOf(...fs: FragmentData[]) {
  return { cargo: fs.map(f => ({ fragmentId: f.id, massKg: f.mass })) };
}

describe('vehicleCargoByOre', () => {
  it('returns zeros for an empty cargo', () => {
    expect(vehicleCargoByOre({ cargo: [] }, [])).toEqual({ byOre: {}, barrenKg: 0, totalKg: 0, fragmentCount: 0 });
  });

  it('ignores fragments the vehicle does not carry', () => {
    const other = frag(9, 500, { goldite: 0.2 });
    const r = vehicleCargoByOre({ cargo: [] }, [tracked(other)]);
    expect(r.totalKg).toBe(0);
    expect(r.byOre).toEqual({});
  });

  it('sums kg per ore over the carried fragments', () => {
    const a = frag(1, 1000, { goldite: 0.2, dirtite: 0.1 });
    const b = frag(2, 600, { goldite: 0.1 });
    const r = vehicleCargoByOre(cargoOf(a, b), [tracked(a), tracked(b)]);
    expect(r.byOre['goldite']).toBeCloseTo(oreContributionKg(a.volume, 0.2) + oreContributionKg(b.volume, 0.1), 6);
    expect(r.byOre['dirtite']).toBeCloseTo(oreContributionKg(a.volume, 0.1), 6);
    expect(r.fragmentCount).toBe(2);
  });

  it('per-ore kg plus barren equals the load', () => {
    const a = frag(1, 1000, { goldite: 0.2, dirtite: 0.1 });
    const b = frag(2, 600, {});
    const r = vehicleCargoByOre(cargoOf(a, b), [tracked(a), tracked(b)]);
    const oreSum = Object.values(r.byOre).reduce((s, kg) => s + kg, 0);
    expect(r.totalKg).toBe(1600);
    expect(oreSum + r.barrenKg).toBeCloseTo(1600, 6);
    expect(r.barrenKg).toBeGreaterThanOrEqual(600);
  });

  it('a barren-only cargo is all barren', () => {
    const a = frag(1, 700, {});
    const r = vehicleCargoByOre(cargoOf(a), [tracked(a)]);
    expect(r.byOre).toEqual({});
    expect(r.barrenKg).toBe(700);
    expect(r.totalKg).toBe(700);
  });

  it('skips cargo ids with no matching fragment but keeps their mass in the total', () => {
    const a = frag(1, 1000, { goldite: 0.2 });
    const r = vehicleCargoByOre({ cargo: [{ fragmentId: 1, massKg: 1000 }, { fragmentId: 404, massKg: 300 }] }, [tracked(a)]);
    expect(r.fragmentCount).toBe(1);
    expect(r.byOre['goldite']).toBeCloseTo(oreContributionKg(a.volume, 0.2), 6);
    expect(r.totalKg).toBe(1300);
    const oreSum = Object.values(r.byOre).reduce((s, kg) => s + kg, 0);
    expect(oreSum + r.barrenKg).toBeCloseTo(1300, 6);
  });

  it('never reports a negative barren remainder', () => {
    const a = frag(1, 10, { goldite: 1 });
    expect(vehicleCargoByOre(cargoOf(a), [tracked(a)]).barrenKg).toBeGreaterThanOrEqual(0);
  });
});
