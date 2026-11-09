// BlastSimulator2026 — Loading a save written before the software tier line-up changed (#2201)
//
// The tiers were renumbered and the preview gained the fragment distribution, so a persisted
// `lastBlastPreview` from before carries data under the wrong numbering. It carries a `shape`;
// one that is not BLAST_PREVIEW_SHAPE loads as null, while the purchased `softwareTier` is kept.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { BLAST_PREVIEW_SHAPE } from '../../../src/core/config/balance.js';
import { makePreviewSummary } from '../../helpers/blastPreviewFixture.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function saveWith(tier: number, mutate?: (json: Json) => void, preview = makePreviewSummary(tier)): string {
  const state = createGame({ seed: 42 });
  state.softwareTier = tier;
  state.lastBlastPreview = preview;
  const json = JSON.parse(serialize(state)) as Json;
  mutate?.(json);
  return JSON.stringify(json);
}

describe('save load — software tier and blast preview shape (#2201)', () => {
  it.each([0, 1, 2, 3, 4])('keeps softwareTier %i through a save', (tier) => {
    expect(deserialize(saveWith(tier)).softwareTier).toBe(tier);
  });

  it.each([0, 1, 2, 3])('keeps a preview of the current shape at tier %i, whole', (tier) => {
    const restored = deserialize(saveWith(tier));
    expect(restored.lastBlastPreview).toEqual(makePreviewSummary(tier));
    expect(restored.lastBlastPreview!.shape).toBe(BLAST_PREVIEW_SHAPE);
  });

  it('loads a preview of another shape as null', () => {
    const restored = deserialize(saveWith(2, json => { json['lastBlastPreview'].shape = BLAST_PREVIEW_SHAPE - 1; }));
    expect(restored.lastBlastPreview).toBeNull();
  });

  it('loads a preview of a later shape as null too', () => {
    const restored = deserialize(saveWith(2, json => { json['lastBlastPreview'].shape = BLAST_PREVIEW_SHAPE + 1; }));
    expect(restored.lastBlastPreview).toBeNull();
  });

  it('loads a preview that has no shape at all (written before shapes existed) as null', () => {
    const restored = deserialize(saveWith(2, json => { delete json['lastBlastPreview'].shape; }));
    expect(restored.lastBlastPreview).toBeNull();
  });

  it('loads an old-tier-line-up preview (energy gated, fragments at T2) as null', () => {
    const restored = deserialize(saveWith(1, json => {
      json['lastBlastPreview'] = {
        tier: 1,
        energy: { affectedVoxels: 42, minEnergy: 1, maxEnergy: 9 },
        fragments: null, projections: null, vibrations: null,
      };
    }));
    expect(restored.lastBlastPreview).toBeNull();
  });

  it('keeps the purchased tier when it drops the preview', () => {
    const restored = deserialize(saveWith(3, json => { json['lastBlastPreview'].shape = 1; }));
    expect(restored.lastBlastPreview).toBeNull();
    expect(restored.softwareTier).toBe(3);
  });

  it('a save with no preview at all still loads with none', () => {
    const state = createGame({ seed: 42 });
    state.softwareTier = 2;
    const restored = deserialize(serialize(state));
    expect(restored.lastBlastPreview).toBeNull();
    expect(restored.softwareTier).toBe(2);
  });

  it('a save whose lastBlastPreview field is missing loads with none', () => {
    const state = createGame({ seed: 42 });
    const json = JSON.parse(serialize(state)) as Json;
    delete json['lastBlastPreview'];
    expect(deserialize(JSON.stringify(json)).lastBlastPreview ?? null).toBeNull();
  });

  it('dropping a stale preview leaves the rest of the state alone', () => {
    const state = createGame({ seed: 42, startingCash: 12_345 });
    state.cash = 12_345;
    state.lastBlastPreview = makePreviewSummary(1);
    const json = JSON.parse(serialize(state)) as Json;
    json['lastBlastPreview'].shape = 1;
    const restored = deserialize(JSON.stringify(json));
    expect(restored.cash).toBe(12_345);
    expect(restored.lastBlastPreview).toBeNull();
  });

  it('a round trip of a loaded save keeps the preview null rather than reviving it', () => {
    const once = deserialize(saveWith(2, json => { json['lastBlastPreview'].shape = 1; }));
    expect(deserialize(serialize(once)).lastBlastPreview).toBeNull();
  });
});
