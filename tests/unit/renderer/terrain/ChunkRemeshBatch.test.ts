// ChunkRemeshBatch — a blast's chunks marched across frames, swapped in together (#1603)

import { describe, it, expect } from 'vitest';
import { ChunkRemeshBatch, type QueuedChunk } from '../../../../src/renderer/terrain/ChunkRemeshBatch.js';

const chunk = (key: number): QueuedChunk => ({ key, cx: key, cy: 0, cz: 0 });

/** A batch whose builds each cost `costMs` of a fake clock, recording every call. */
function makeBatch(costMs = 3) {
  let clock = 0;
  let builds = 0;
  const installed: Array<[number, string]> = [];
  const discarded: string[] = [];
  const batch = new ChunkRemeshBatch<string>(
    c => { clock += costMs; builds++; return `mesh-${c.key}-${builds}`; },
    (c, built) => { installed.push([c.key, built]); },
    built => { discarded.push(built); },
  );
  return { batch, now: () => clock, installed, discarded, builds: () => builds };
}

describe('ChunkRemeshBatch', () => {
  it('marches within the frame budget and installs nothing until every chunk is built', () => {
    const { batch, now, installed, builds } = makeBatch(3);
    batch.queue([1, 2, 3, 4, 5].map(chunk));

    expect(batch.step(5, now)).toBe(false); // 2 builds: 3 ms < 5, then 6 ms ≥ 5
    expect(builds()).toBe(2);
    expect(installed).toEqual([]);
    expect(batch.pending).toBe(5);

    expect(batch.step(5, now)).toBe(false);
    expect(builds()).toBe(4);
    expect(installed).toEqual([]);

    expect(batch.step(5, now)).toBe(true); // the last build, then the whole swap
    expect(installed.map(([key]) => key)).toEqual([1, 2, 3, 4, 5]);
    expect(batch.pending).toBe(0);
  });

  it('builds at least one chunk per step, however small the budget', () => {
    const { batch, now, builds } = makeBatch(50);
    batch.queue([1, 2].map(chunk));
    batch.step(0, now);
    expect(builds()).toBe(1);
    expect(batch.step(0, now)).toBe(true);
  });

  it('re-marches a chunk queued again after it was built, discarding the stale build', () => {
    const { batch, now, installed, discarded } = makeBatch(10);
    batch.queue([1, 2].map(chunk));
    batch.step(5, now); // builds chunk 1 only
    batch.queue([chunk(1)]); // its voxels changed again
    expect(discarded).toEqual(['mesh-1-1']);
    batch.finish();
    expect(installed).toEqual([[1, 'mesh-1-2'], [2, 'mesh-2-3']]);
  });

  it('a chunk queued twice before it is built is marched once', () => {
    const { batch, installed, builds } = makeBatch();
    batch.queue([1, 2].map(chunk));
    batch.queue([2, 3].map(chunk));
    expect(batch.pending).toBe(3);
    expect(batch.finish()).toBe(true);
    expect(builds()).toBe(3);
    expect(installed.map(([key]) => key)).toEqual([1, 2, 3]);
  });

  it('finish builds and installs everything at once; with nothing queued it does nothing', () => {
    const { batch, installed } = makeBatch();
    expect(batch.finish()).toBe(false);
    batch.queue([7, 8].map(chunk));
    expect(batch.finish()).toBe(true);
    expect(installed.map(([key]) => key)).toEqual([7, 8]);
    expect(batch.finish()).toBe(false);
  });

  it('clear discards built chunks and installs none', () => {
    const { batch, now, installed, discarded } = makeBatch(10);
    batch.queue([1, 2, 3].map(chunk));
    batch.step(15, now); // builds 1 and 2
    batch.clear();
    expect(discarded).toEqual(['mesh-1-1', 'mesh-2-2']);
    expect(installed).toEqual([]);
    expect(batch.pending).toBe(0);
    expect(batch.step(15, now)).toBe(false);
  });
});
