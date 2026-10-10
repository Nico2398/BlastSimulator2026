// BlastSimulator2026 — Chunk remesh spread across frames, swapped in at once (#1603)
//
// A blast dirties a dozen terrain chunks at once. Re-marching them all inside
// the detonate frame was most of that frame's cost, so the blast's chunks are
// queued here instead: a few are marched each frame under a time budget, the
// finished geometry is held off-screen, and only when every queued chunk is
// built are they all installed together. Until then the old meshes stay up
// whole — the crater appears in one frame, a few frames late, under the flash
// and dust, rather than chunk by chunk with seams between built and stale ones.

/** One chunk to re-march, by its mesh key and chunk coordinates. */
export interface QueuedChunk {
  key: number;
  cx: number;
  cy: number;
  cz: number;
}

interface Entry<T> extends QueuedChunk {
  /** Built geometry once marched; `undefined` while still waiting. */
  built: T | undefined;
}

export class ChunkRemeshBatch<T> {
  private readonly entries = new Map<number, Entry<T>>();
  private unbuilt = 0;

  constructor(
    /** March one chunk, off-screen. */
    private readonly build: (chunk: QueuedChunk) => T,
    /** Put one built chunk on screen, replacing what was there. */
    private readonly install: (chunk: QueuedChunk, built: T) => void,
    /** Release a built chunk that will never be installed. */
    private readonly discard: (built: T) => void,
  ) {}

  /** Chunks queued and not yet installed. */
  get pending(): number {
    return this.entries.size;
  }

  /** Queue `chunks`; one already built is marched again, since its voxels changed since. */
  queue(chunks: Iterable<QueuedChunk>): void {
    for (const chunk of chunks) {
      const existing = this.entries.get(chunk.key);
      if (existing === undefined) {
        this.entries.set(chunk.key, { ...chunk, built: undefined });
        this.unbuilt++;
      } else if (existing.built !== undefined) {
        this.discard(existing.built);
        existing.built = undefined;
        this.unbuilt++;
      }
    }
  }

  /**
   * March queued chunks until `budgetMs` of `now()` has passed — always at
   * least one, so a slow machine still progresses — and install the whole
   * batch once none is left to build. True when this call installed it.
   */
  step(budgetMs: number, now: () => number): boolean {
    if (this.entries.size === 0) return false;
    const start = now();
    for (const entry of this.entries.values()) {
      if (entry.built !== undefined) continue;
      entry.built = this.build(entry);
      this.unbuilt--;
      if (this.unbuilt > 0 && now() - start >= budgetMs) return false;
    }
    this.installAll();
    return true;
  }

  /** Build everything still queued and install it now. True when anything was pending. */
  finish(): boolean {
    return this.step(Infinity, () => 0);
  }

  /** Drop the batch without installing it (the meshes it would replace are going away). */
  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.built !== undefined) this.discard(entry.built);
    }
    this.entries.clear();
    this.unbuilt = 0;
  }

  private installAll(): void {
    for (const entry of this.entries.values()) this.install(entry, entry.built as T);
    this.entries.clear();
    this.unbuilt = 0;
  }
}
