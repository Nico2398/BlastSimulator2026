import { describe, it, expect, vi } from 'vitest';
import { selectSaveBackend, type SaveBackendFactory } from '../../../src/persistence/selectBackend.js';
import type { SaveBackend } from '../../../src/core/state/SaveBackend.js';

function stubBackend(): SaveBackend {
  return {
    async save() { /* noop */ },
    async load() { return null; },
    async list() { return []; },
    async delete() { /* noop */ },
  };
}

function factory(probe: () => Promise<void>, idbThrows = false): SaveBackendFactory & { idbBackend: SaveBackend; fallbackBackend: SaveBackend } {
  const idbBackend = stubBackend();
  const fallbackBackend = stubBackend();
  return {
    idbBackend,
    fallbackBackend,
    idb: () => {
      if (idbThrows) throw new Error('indexedDB unavailable');
      return Object.assign(idbBackend, { probe });
    },
    fallback: () => fallbackBackend,
  };
}

describe('selectSaveBackend', () => {
  it('returns the IndexedDB backend when the probe resolves', async () => {
    const f = factory(async () => undefined);
    const result = await selectSaveBackend(f);
    expect(result.kind).toBe('indexeddb');
    expect(result.backend).toBe(f.idbBackend);
  });

  it('returns the fallback as memory when the probe rejects', async () => {
    const f = factory(async () => { throw new Error('blocked'); });
    const result = await selectSaveBackend(f);
    expect(result.kind).toBe('memory');
    expect(result.backend).toBe(f.fallbackBackend);
  });

  it('returns the fallback as memory when the idb factory throws', async () => {
    const f = factory(async () => undefined, true);
    const result = await selectSaveBackend(f);
    expect(result.kind).toBe('memory');
    expect(result.backend).toBe(f.fallbackBackend);
  });

  it('never rejects, whatever the probe does', async () => {
    const f = factory(() => Promise.reject('string reason'));
    await expect(selectSaveBackend(f)).resolves.toMatchObject({ kind: 'memory' });
  });

  it('probes exactly once', async () => {
    const probe = vi.fn(async () => undefined);
    await selectSaveBackend(factory(probe));
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('without a factory and no indexedDB global, still resolves with a usable backend', async () => {
    const result = await selectSaveBackend();
    expect(['indexeddb', 'memory']).toContain(result.kind);
    expect(await result.backend.list()).toEqual([]);
  });
});
