// BlastSimulator2026 — Mine type presets
// Each preset configures terrain generation parameters.

export interface MinePreset {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  /** Rock IDs that dominate this terrain, in decreasing probability. */
  readonly dominantRocks: readonly string[];
  /** Ore richness multiplier (1.0 = normal). */
  readonly oreRichness: number;
  /** Base surface elevation as fraction of grid height (0–1). */
  readonly baseElevation: number;
  /** Elevation variation amplitude (higher = more mountainous). */
  readonly elevationVariation: number;
  /** How flat the terrain is (0 = very rough, 1 = very flat). */
  readonly flatness: number;
  /** Border zone width in voxels (neutral dirt/sand zone). */
  readonly borderWidth: number;
}

const PRESETS: readonly MinePreset[] = [
  {
    id: 'desert',
    nameKey: 'mine.desert.name',
    descKey: 'mine.desert.desc',
    dominantRocks: ['cruite', 'sandite', 'molite'],
    oreRichness: 0.8,
    baseElevation: 0.35,
    elevationVariation: 0.08,
    flatness: 0.7,
    borderWidth: 5,
  },
  {
    id: 'mountain',
    nameKey: 'mine.mountain.name',
    descKey: 'mine.mountain.desc',
    dominantRocks: ['grumpite', 'clunkite', 'stubite', 'obstiite'],
    oreRichness: 1.0,
    baseElevation: 0.50,
    elevationVariation: 0.20,
    flatness: 0.3,
    borderWidth: 5,
  },
  {
    id: 'tropical',
    nameKey: 'mine.tropical.name',
    descKey: 'mine.tropical.desc',
    dominantRocks: ['obstiite', 'gnarlite', 'absurdite', 'titanite'],
    oreRichness: 1.5,
    baseElevation: 0.40,
    elevationVariation: 0.15,
    flatness: 0.5,
    borderWidth: 5,
  },
] as const;

const PRESET_MAP = new Map<string, MinePreset>(PRESETS.map(p => [p.id, p]));

export function getMinePreset(id: string): MinePreset | undefined {
  return PRESET_MAP.get(id);
}

export function getAllMinePresets(): readonly MinePreset[] {
  return PRESETS;
}
