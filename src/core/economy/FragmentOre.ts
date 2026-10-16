import type { FragmentData } from '../mining/BlastExecution.js';
import { sumOreMass } from '../mining/BlastOreReport.js';

export interface FragmentOreBreakdown {
  byOre: Record<string, number>;
  barrenKg: number;
}

/**
 * Scale per-ore kg down in place when it adds up to more than `massKg`.
 * Ore kg derives from volume at the nominal ore density, so it can exceed the real mass.
 */
export function capOreToMass(oreKg: Record<string, number>, massKg: number): void {
  const oreSum = Object.values(oreKg).reduce((sum, kg) => sum + kg, 0);
  if (oreSum <= massKg || oreSum <= 0) return;
  const scale = massKg / oreSum;
  for (const oreId of Object.keys(oreKg)) oreKg[oreId] = oreKg[oreId]! * scale;
}

/** Ore mass (kg) per ore type in a fragment, plus the barren remainder. */
export function fragmentOreKg(f: Pick<FragmentData, 'volume' | 'mass' | 'oreDensities'>): FragmentOreBreakdown {
  const { oreKg, barrenKg } = sumOreMass([f], f.mass);
  capOreToMass(oreKg, f.mass);
  return { byOre: oreKg, barrenKg };
}
