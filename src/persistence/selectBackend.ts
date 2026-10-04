// BlastSimulator2026 — Save backend selection with in-memory fallback.
// Lives OUTSIDE src/core/. Stub — implementation pending.

import type { SaveBackend } from '../core/state/SaveBackend.js';

export type SaveBackendKind = 'indexeddb' | 'memory';

export interface SaveBackendFactory {
  idb: () => SaveBackend & { probe(): Promise<void> };
  fallback: () => SaveBackend;
}

/**
 * Pick IndexedDB when its probe resolves, otherwise the in-memory fallback.
 * Never throws.
 */
export async function selectSaveBackend(
  _factory?: SaveBackendFactory,
): Promise<{ backend: SaveBackend; kind: SaveBackendKind }> {
  throw new Error('not implemented');
}
