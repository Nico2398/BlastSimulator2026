import { describe, it, expect } from 'vitest';
import { getRock, getAllRocks } from '../../../src/core/world/RockCatalog.js';

describe('RockCatalog', () => {
  it('getRock returns valid data for cruite', () => {
    const rock = getRock('cruite');
    expect(rock).toBeDefined();
    expect(rock!.id).toBe('cruite');
    expect(rock!.nameKey).toBe('rock.cruite.name');
    expect(rock!.hardnessTier).toBe(1);
    expect(rock!.density).toBeGreaterThan(0);
    expect(rock!.porosity).toBeGreaterThanOrEqual(0);
    expect(rock!.porosity).toBeLessThanOrEqual(1);
    expect(rock!.energyAbsorption).toBeGreaterThan(0);
    expect(rock!.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('all rock IDs are unique', () => {
    const rocks = getAllRocks();
    const ids = rocks.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ore probability distributions sum to <= 1.0 for each rock', () => {
    for (const rock of getAllRocks()) {
      const sum = Object.values(rock.oreProbabilities).reduce((a, b) => a + b, 0);
      expect(sum).toBeLessThanOrEqual(1.0 + 1e-9); // floating point tolerance
    }
  });

  it('at least 8 rocks defined spanning tiers 1-5', () => {
    const rocks = getAllRocks();
    expect(rocks.length).toBeGreaterThanOrEqual(8);
    const tiers = new Set(rocks.map(r => r.hardnessTier));
    for (let t = 1; t <= 5; t++) {
      expect(tiers.has(t)).toBe(true);
    }
  });

  it('higher tier rocks absorb more energy before fracturing', () => {
    const rocks = [...getAllRocks()].sort((a, b) => a.hardnessTier - b.hardnessTier);
    for (let i = 1; i < rocks.length; i++) {
      const prev = rocks[i - 1]!;
      const curr = rocks[i]!;
      if (curr.hardnessTier > prev.hardnessTier) {
        expect(curr.energyAbsorption).toBeGreaterThan(prev.energyAbsorption);
      }
    }
  });

  it('terrain shader params are within their documented ranges (#458 T4.1/A19.2)', () => {
    for (const rock of getAllRocks()) {
      expect(rock.macroFreq).toBeGreaterThan(0);
      expect(rock.detailFreq).toBeGreaterThan(rock.macroFreq); // detail is finer-grained than macro
      expect(rock.veinStrength).toBeGreaterThanOrEqual(0);
      expect(rock.veinStrength).toBeLessThanOrEqual(0.5);
      expect(rock.contrast).toBeGreaterThanOrEqual(0);
      expect(rock.contrast).toBeLessThanOrEqual(0.6);
    }
  });
});
