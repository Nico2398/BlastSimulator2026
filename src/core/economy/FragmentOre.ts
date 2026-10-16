import type { FragmentData } from '../mining/BlastExecution.js';

export interface FragmentOreBreakdown {
  byOre: Record<string, number>;
  barrenKg: number;
}

/** Ore mass (kg) per ore type in a fragment, plus the barren remainder. */
export function fragmentOreKg(_f: Pick<FragmentData, 'volume' | 'mass' | 'oreDensities'>): FragmentOreBreakdown {
  // TODO: implement
  return { byOre: {}, barrenKg: 0 };
}
