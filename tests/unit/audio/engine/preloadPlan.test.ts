import { describe, it, expect } from 'vitest';
import { SOUND_CATALOG, type SoundDefinition } from '../../../../src/audio/SoundCatalog.js';
import { planPreload } from '../../../../src/audio/engine/preloadPlan.js';

const sample = (files: string[], over: Partial<SoundDefinition> = {}): SoundDefinition => ({
  bus: 'effects', source: { kind: 'sample', files }, gainDb: 0, priority: 1, ...over,
});

describe('planPreload', () => {
  it('puts samples of interface and high-priority sounds in tier 1, the rest in tier 2', () => {
    const plan = planPreload({
      click: sample(['click'], { bus: 'ui', priority: 1 }),
      boom: sample(['boom_1', 'boom_2'], { priority: 4 }),
      alert: sample(['alert'], { priority: 3 }),
      dig: sample(['dig'], { priority: 1 }),
      hit: sample(['hit'], { priority: 2 }),
    });
    expect([...plan.essentialSamples].sort()).toEqual(['alert', 'boom_1', 'boom_2', 'click']);
    expect([...plan.otherSamples].sort()).toEqual(['dig', 'hit']);
  });

  it('lists a shared file once, in the earliest tier that needs it', () => {
    const plan = planPreload({
      a: sample(['shared'], { priority: 1 }),
      b: sample(['shared'], { priority: 4 }),
    });
    expect(plan.essentialSamples).toEqual(['shared']);
    expect(plan.otherSamples).toEqual([]);
  });

  it('collects each synth recipe once', () => {
    const plan = planPreload({
      one: { bus: 'effects', source: { kind: 'synth', recipe: 'phone_ring' }, gainDb: 0, priority: 2 },
      two: { bus: 'ambient', source: { kind: 'synth', recipe: 'phone_ring' }, gainDb: 0, priority: 2 },
      three: { bus: 'ambient', source: { kind: 'synth', recipe: 'siren_loop' }, gainDb: 0, priority: 1, loop: true },
    });
    expect(plan.recipes).toEqual(['phone_ring', 'siren_loop']);
    expect(plan.essentialSamples).toEqual([]);
  });

  it('never holds `ready` for a looped bed, whatever its priority: beds fade in, and their files are the largest', () => {
    const plan = planPreload({
      bed: { ...sample(['bed_file'], { priority: 3, bus: 'ambient' }), loop: true },
      alarm: sample(['alarm'], { priority: 3 }),
    });
    expect(plan.essentialSamples).toEqual(['alarm']);
    expect(plan.otherSamples).toEqual(['bed_file']);
  });

  it('covers every file and recipe of the real catalog exactly once', () => {
    const plan = planPreload(SOUND_CATALOG);
    const files = [...plan.essentialSamples, ...plan.otherSamples];
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain('ui_click_1');
    expect(files).toContain('blast_boom_1');
    expect(plan.essentialSamples).toContain('ui_click_1');
    expect(plan.essentialSamples).toContain('blast_boom_1');
    expect(plan.otherSamples).toContain('dig_1');
    expect(plan.recipes).toContain('blast_sub');
    expect(plan.otherSamples).toContain('bed_wind');
    expect(plan.essentialSamples).not.toContain('bed_wind');
    expect(new Set(plan.recipes).size).toBe(plan.recipes.length);
  });
});
