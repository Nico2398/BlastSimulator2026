// BlastSimulator2026 — Preload plan
// Splits the catalog's audio into loading tiers: the samples that gate `ready`,
// the rest of the samples, and the generative sounds (AudioEngine renders those
// while the rest of the samples download). `ready` says nothing about synth cues.

import { PRELOAD_CONFIG } from '../../core/config/audio/engine.js';
import type { SoundDefinition, SynthRecipeId } from '../SoundCatalog.js';

interface PreloadPlan {
  /** Tier 1: every sample of an interface-bus sound or of a sampled one-shot with priority >= PRELOAD_CONFIG.essentialPriority. */
  readonly essentialSamples: readonly string[];
  /** Tier 2: the remaining samples. */
  readonly otherSamples: readonly string[];
  /** Recipes to render, after the essential samples and whatever their priority (the reverb impulse comes after them). */
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
    // A bed fades in, so it never holds up `ready`: its files are the largest and come with the other samples.
    const isEssential = def.bus === 'ui' || (def.priority >= PRELOAD_CONFIG.essentialPriority && !def.loop);
    for (const file of def.source.files) (isEssential ? essential : other).add(file);
  }
  for (const file of essential) other.delete(file);
  return { essentialSamples: [...essential], otherSamples: [...other], recipes: [...recipes] };
}
