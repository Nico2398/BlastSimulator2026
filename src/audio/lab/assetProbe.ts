// BlastSimulator2026 — Asset probe
// Wraps the engine's injection points (byte source, decoder, recipes, reverb
// impulse) so a load attempt leaves a report: which sample files decoded and how
// long and loud they are, which recipes rendered clean (finite, non-empty, not
// silent) and what failed with which reason. The engine already survives any of
// these failing; the probe is how the lab and the check find out.

import type { SynthRecipeId } from '../SoundCatalog.js';
import type { ByteSource, Decoder } from '../engine/SampleBank.js';
import type { RenderedAudio, SynthRecipe } from '../synth/types.js';
import { LAB_STATS_CONFIG } from '../../core/config/audio/lab.js';
import { amplitudeToDb, roundDb } from './levels.js';
import type { AssetReport, LoadedAsset } from './labReport.js';

/** A decoded clip counts as silent below this peak (dBFS): a corrupt or empty file, not a quiet sound. */
const SILENT_PEAK_DB = -80;

/** Basename without extension: `/audio/sfx/ui_click_1.mp3` is `ui_click_1`. */
function assetName(url: string): string {
  const file = url.split('/').pop() ?? url;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PeakAndFinite {
  readonly peak: number;
  readonly finite: boolean;
}

function scan(channels: readonly ArrayLike<number>[]): PeakAndFinite {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const v = channel[i] ?? 0;
      if (!Number.isFinite(v)) return { peak, finite: false };
      peak = Math.max(peak, Math.abs(v));
    }
  }
  return { peak, finite: true };
}

/** Planar channels of a decoded buffer. */
function bufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
}

/** Fetches once per URL; every caller gets its own copy, because decoding detaches the bytes it is given. */
export function memoizeBytes(source: ByteSource): ByteSource {
  const cache = new Map<string, Promise<ArrayBuffer>>();
  return async (url) => {
    let pending = cache.get(url);
    if (!pending) {
      pending = source(url);
      cache.set(url, pending);
      pending.catch(() => cache.delete(url));
    }
    return (await pending).slice(0);
  };
}

export class AssetProbe {
  private readonly urlOfBytes = new WeakMap<ArrayBuffer, string>();
  private readonly samples = new Map<string, LoadedAsset>();
  private readonly recipeStats = new Map<string, LoadedAsset>();
  private impulse: LoadedAsset | null = null;
  private readonly failures: string[] = [];

  /** Wrap a byte source: remember which file each byte block came from, and record fetch failures. */
  wrapFetch(source: ByteSource): ByteSource {
    return async (url) => {
      try {
        const bytes = await source(url);
        this.urlOfBytes.set(bytes, url);
        return bytes;
      } catch (error) {
        this.fail('sample', assetName(url), reasonOf(error));
        throw error;
      }
    };
  }

  /** Wrap a decoder: record each clip's length and peak, and fail empty or silent ones. */
  wrapDecode(decode: Decoder): Decoder {
    return async (bytes) => {
      const url = this.urlOfBytes.get(bytes);
      const name = url ? assetName(url) : 'unknown';
      try {
        const buffer = await decode(bytes);
        const { peak, finite } = scan(bufferChannels(buffer));
        const peakDbfs = roundDb(amplitudeToDb(peak));
        if (!finite || buffer.duration <= 0) throw new Error('decoded to empty or non-finite audio');
        if (peakDbfs < SILENT_PEAK_DB) throw new Error(`decoded to silence (peak ${peakDbfs} dBFS)`);
        this.samples.set(name, { name, kind: 'sample', durationS: Math.round(buffer.duration * 1000) / 1000, peakDbfs });
        return buffer;
      } catch (error) {
        this.fail('sample', name, reasonOf(error));
        throw error;
      }
    };
  }

  /** Wrap the recipes: each render is checked for being finite, non-empty and not silent. */
  wrapRecipes(recipes: Readonly<Record<SynthRecipeId, SynthRecipe>>): Record<SynthRecipeId, SynthRecipe> {
    const wrapped = {} as Record<SynthRecipeId, SynthRecipe>;
    for (const id of Object.keys(recipes) as SynthRecipeId[]) {
      const recipe = recipes[id];
      wrapped[id] = { ...recipe, render: variant => this.checkedRender('recipe', id, () => recipe.render(variant)) };
    }
    return wrapped;
  }

  wrapImpulse(render: () => RenderedAudio): () => RenderedAudio {
    return () => this.checkedRender('impulse', 'reverb_impulse', render);
  }

  report(): AssetReport {
    const byName = (a: LoadedAsset, b: LoadedAsset): number => a.name.localeCompare(b.name);
    return {
      loaded: [
        ...[...this.samples.values()].sort(byName),
        ...[...this.recipeStats.values()].sort(byName),
        ...(this.impulse ? [this.impulse] : []),
      ],
      failed: [...this.failures],
    };
  }

  private checkedRender(kind: 'recipe' | 'impulse', name: string, render: () => RenderedAudio): RenderedAudio {
    try {
      const audio = render();
      const first = audio.channels[0];
      if (!first || first.length === 0) throw new Error('rendered no audio');
      const { peak, finite } = scan(audio.channels);
      if (!finite) throw new Error('rendered NaN or infinite samples');
      const peakDbfs = roundDb(amplitudeToDb(peak));
      if (peakDbfs < SILENT_PEAK_DB) throw new Error(`rendered silence (peak ${peakDbfs} dBFS)`);
      this.remember(kind, name, first.length / audio.sampleRate, peakDbfs);
      return audio;
    } catch (error) {
      this.fail(kind, name, reasonOf(error));
      throw error;
    }
  }

  /** Keep the longest and loudest variant of a recipe as its entry. */
  private remember(kind: 'recipe' | 'impulse', name: string, durationS: number, peakDbfs: number): void {
    const previous = kind === 'impulse' ? this.impulse : this.recipeStats.get(name);
    const entry: LoadedAsset = {
      name,
      kind,
      durationS: Math.round(Math.max(durationS, previous?.durationS ?? 0) * 1000) / 1000,
      peakDbfs: Math.max(peakDbfs, previous?.peakDbfs ?? LAB_STATS_CONFIG.floorDb),
    };
    if (kind === 'impulse') this.impulse = entry;
    else this.recipeStats.set(name, entry);
  }

  private fail(kind: string, name: string, reason: string): void {
    const text = `${kind}:${name} (${reason})`;
    if (!this.failures.includes(text)) this.failures.push(text);
  }
}
