// BlastSimulator2026 — Save backend selection with in-memory fallback.
// Lives OUTSIDE src/core/.

import type { SaveBackend } from '../core/state/SaveBackend.js';
import { IndexedDBPersistence } from './IndexedDBPersistence.js';
import { InMemoryPersistence } from './InMemoryPersistence.js';

export type SaveBackendKind = 'indexeddb' | 'memory';

export interface SaveBackendFactory {
  idb: () => SaveBackend & { probe(): Promise<void> };
  fallback: () => SaveBackend;
}

const DEFAULT_FACTORY: SaveBackendFactory = {
  idb: () => new IndexedDBPersistence(),
  fallback: () => new InMemoryPersistence(),
};

/**
 * Pick IndexedDB when its probe resolves, otherwise the in-memory fallback.
 * Never throws.
 */
export async function selectSaveBackend(
  factory: SaveBackendFactory = DEFAULT_FACTORY,
): Promise<{ backend: SaveBackend; kind: SaveBackendKind }> {
  try {
    const idb = factory.idb();
    await idb.probe();
    return { backend: idb, kind: 'indexeddb' };
  } catch {
    return { backend: factory.fallback(), kind: 'memory' };
  }
}
