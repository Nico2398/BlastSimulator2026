import { describe, it, expect } from 'vitest';
import { fragmentOreKg, type FragmentOreBreakdown } from '../../../src/core/economy/FragmentOre.js';
import { oreContributionKg } from '../../../src/core/mining/BlastOreReport.js';
import { ORE_DENSITY_KG_M3 } from '../../../src/core/config/balance.js';

describe('fragmentOreKg', () => {
  it('derives ore kg from volume and density and leaves the rest barren', () => {
    const f = { volume: 1, mass: 5000, oreDensities: { goldite: 0.2, dirtite: 0.1 } };
    const r: FragmentOreBreakdown = fragmentOreKg(f);
    expect(r.byOre['goldite']).toBeCloseTo(oreContributionKg(1, 0.2));
    expect(r.byOre['dirtite']).toBeCloseTo(oreContributionKg(1, 0.1));
    expect(r.barrenKg).toBeCloseTo(5000 - ORE_DENSITY_KG_M3 * 0.3);
  });

  it('returns no ores and the whole mass barren for empty densities', () => {
    const r = fragmentOreKg({ volume: 2, mass: 4000, oreDensities: {} });
    expect(r.byOre).toEqual({});
    expect(r.barrenKg).toBe(4000);
  });

  it('ignores zero densities without dividing by zero', () => {
    const r = fragmentOreKg({ volume: 2, mass: 4000, oreDensities: { goldite: 0 } });
    expect(r.byOre).toEqual({});
    expect(r.barrenKg).toBe(4000);
    expect(Number.isFinite(r.barrenKg)).toBe(true);
  });

  it('scales ore down to the mass when the ore sum exceeds it', () => {
    const f = { volume: 1, mass: 1000, oreDensities: { goldite: 0.6, dirtite: 0.2 } };
    const r = fragmentOreKg(f);
    const sum = Object.values(r.byOre).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1000);
    expect(r.barrenKg).toBeCloseTo(0);
    expect(r.byOre['goldite']! / r.byOre['dirtite']!).toBeCloseTo(3);
  });

  it('does not scale when ore equals the mass exactly', () => {
    const mass = oreContributionKg(1, 0.4);
    const r = fragmentOreKg({ volume: 1, mass, oreDensities: { goldite: 0.4 } });
    expect(r.byOre['goldite']).toBeCloseTo(mass);
    expect(r.barrenKg).toBeCloseTo(0);
  });

  it('never reports negative barren kg', () => {
    const r = fragmentOreKg({ volume: 1, mass: 10, oreDensities: { goldite: 0.9 } });
    expect(r.barrenKg).toBeGreaterThanOrEqual(0);
  });

  it('handles a zero-mass fragment', () => {
    const r = fragmentOreKg({ volume: 1, mass: 0, oreDensities: { goldite: 0.5 } });
    expect(r.byOre['goldite'] ?? 0).toBe(0);
    expect(r.barrenKg).toBe(0);
  });
});
