// BlastSimulator2026 — Preload plan
// Splits the catalog's audio into loading tiers: what must exist before the
// first click or boom, the rest of the samples, then the generative sounds.

import { PRELOAD_CONFIG } from '../../core/config/audio/engine.js';
import type { SoundDefinition, SynthRecipeId } from '../SoundCatalog.js';

interface PreloadPlan {
  /** Tier 1: every sample of a high-priority or interface sound. */
  readonly essentialSamples: readonly string[];
  /** Tier 2: the remaining samples. */
  readonly otherSamples: readonly string[];
  /** Tier 3: recipes to render (the reverb impulse comes with them). */
  readonly recipes: readonly SynthRecipeId[];
}

export function planPreload(catalog: Readonly<Record<string, SoundDefinition>>): PreloadPlan {
  const essential = new Set<string>();
  const other = new Set<string>();
  const recipes = new Set<SynthRecipeId>();
  for (const def of Object.values(catalog)) {
    if (def.source.kind === 'synth') {
      recipes.add(def.source.recipe);
      continue;
    }
    const isEssential = def.priority >= PRELOAD_CONFIG.essentialPriority || def.bus === 'ui';
    for (const file of def.source.files) (isEssential ? essential : other).add(file);
  }
  for (const file of essential) other.delete(file);
  return { essentialSamples: [...essential], otherSamples: [...other], recipes: [...recipes] };
}
