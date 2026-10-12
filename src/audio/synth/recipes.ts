// BlastSimulator2026 — Synth recipe table
// One entry per SynthRecipeId; the engine renders each once at startup. Adding a generative
// sound is adding its id to the catalog plus a recipe here.

import type { SynthRecipeId } from '../SoundCatalog.js';
import { BLAST_BEEP } from './sounds/blastBeep.js';
import { BLAST_CANCEL } from './sounds/blastCancel.js';
import { BLAST_SUB } from './sounds/blastSub.js';
import { BLAST_TAIL } from './sounds/blastTail.js';
import { MACHINERY_BED } from './sounds/machinery.js';
import { RAIN_HEAVY_BED, RAIN_LIGHT_BED } from './sounds/rain.js';
import { renderOutdoorIr } from './sounds/reverb.js';
import { SIREN_LOOP } from './sounds/siren.js';
import { THUNDER } from './sounds/thunder.js';
import { WIND_BED } from './sounds/wind.js';
import type { RenderedAudio, SynthRecipe } from './types.js';

export const SYNTH_RECIPES: Record<SynthRecipeId, SynthRecipe> = {
  blast_sub: BLAST_SUB,
  blast_tail: BLAST_TAIL,
  blast_beep: BLAST_BEEP,
  blast_cancel: BLAST_CANCEL,
  siren_loop: SIREN_LOOP,
  thunder: THUNDER,
  wind_bed: WIND_BED,
  rain_light_bed: RAIN_LIGHT_BED,
  rain_heavy_bed: RAIN_HEAVY_BED,
  machinery_bed: MACHINERY_BED,
};

/** Impulse response of the shared outdoor reverb (stereo, ~2.4 s). */
export function renderReverbIr(): RenderedAudio {
  return renderOutdoorIr();
}
