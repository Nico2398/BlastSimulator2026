// BlastSimulator2026 — AudioEngine load-status accessors
// `preloaded` and `failedAssets` are what the smoke test polls to know the preload is over and clean.

import { describe, it, expect } from 'vitest';
import { AudioEngine } from '../../../../src/audio/AudioEngine.js';
import { AudioManager } from '../../../../src/audio/AudioManager.js';
import type { SoundDefinition } from '../../../../src/audio/SoundCatalog.js';
import type { RenderedAudio } from '../../../../src/audio/synth/types.js';
import { Random } from '../../../../src/core/math/Random.js';
import { FakeAudioContext, asAudioContext } from '../../../helpers/audioFakes.js';

const CATALOG = {
  ui_click: { bus: 'ui', source: { kind: 'sample', files: ['click_a', 'click_missing'] }, gainDb: 0, priority: 2 },
  thunder: { bus: 'ambient', source: { kind: 'synth', recipe: 'phone_ring' }, gainDb: 0, priority: 2 },
} as const satisfies Record<string, SoundDefinition>;

const tone = (): RenderedAudio => ({ sampleRate: 44100, channels: [new Float32Array(16).fill(0.1)] });

function engineWith(failingRecipe: boolean): AudioEngine {
  const manager = new AudioManager({ createContext: () => asAudioContext(new FakeAudioContext()), document: null });
  return new AudioEngine(manager, {
    random: new Random(3),
    catalog: CATALOG,
    fetchBytes: async url => {
      if (url.includes('missing')) throw new Error('404');
      return new ArrayBuffer(4);
    },
    recipes: { phone_ring: { variants: 1, loop: false, render: () => { if (failingRecipe) throw new Error('x'); return tone(); } } },
    renderImpulse: tone,
  });
}

describe('AudioEngine load status', () => {
  it('is not preloaded and has no failures before the preload runs', () => {
    const engine = engineWith(false);
    expect(engine.preloaded).toBe(false);
    expect(engine.failedAssets).toEqual([]);
  });

  it('reports the missing sample after the preload settles', async () => {
    const engine = engineWith(false);
    const done = engine.preload();
    expect(engine.preloaded).toBe(false);
    await done;
    expect(engine.preloaded).toBe(true);
    expect(engine.failedAssets).toEqual(['click_missing']);
  });

  it('lists a recipe that failed to render beside the failed samples', async () => {
    const engine = engineWith(true);
    await engine.preload();
    expect(engine.failedAssets).toEqual(['click_missing', 'phone_ring']);
  });

  it('settles as preloaded without a context and reports nothing failed', async () => {
    const manager = new AudioManager({ createContext: () => { throw new Error('none'); } });
    const engine = new AudioEngine(manager, { random: new Random(1), catalog: CATALOG });
    await engine.preload();
    expect(engine.preloaded).toBe(true);
    expect(engine.failedAssets).toEqual([]);
  });
});
