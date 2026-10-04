// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DownloadPersistence } from '../../../src/persistence/DownloadPersistence.js';

describe('DownloadPersistence as in-memory fallback', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('save never creates an anchor or an object URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    const createElement = vi.spyOn(document, 'createElement');
    const backend = new DownloadPersistence();
    await backend.save('slot_1', 'One', '{"a":1}', '$1', null);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(createElement.mock.calls.filter(c => c[0] === 'a')).toHaveLength(0);
  });

  it('round-trips save, load, list and delete in memory', async () => {
    const backend = new DownloadPersistence();
    await backend.save('slot_1', 'One', 'DATA1', '$1', 'dusty_hollow');
    await backend.save('slot_2', 'Two', 'DATA2', '$2', null);

    const loaded = await backend.load('slot_1');
    expect(loaded?.data).toBe('DATA1');
    expect(loaded?.meta.name).toBe('One');
    expect(loaded?.meta.levelId).toBe('dusty_hollow');

    const ids = (await backend.list()).map(m => m.slotId).sort();
    expect(ids).toEqual(['slot_1', 'slot_2']);

    await backend.delete('slot_1');
    expect(await backend.load('slot_1')).toBeNull();
    expect((await backend.list()).map(m => m.slotId)).toEqual(['slot_2']);
  });

  it('saving the same slot twice replaces its content', async () => {
    const backend = new DownloadPersistence();
    await backend.save('slot_1', 'One', 'OLD', '$1', null);
    await backend.save('slot_1', 'One', 'NEW', '$1', null);
    expect((await backend.load('slot_1'))?.data).toBe('NEW');
    expect(await backend.list()).toHaveLength(1);
  });

  it('loading a missing slot returns null and deleting one does not throw', async () => {
    const backend = new DownloadPersistence();
    expect(await backend.load('nope')).toBeNull();
    await expect(backend.delete('nope')).resolves.toBeUndefined();
  });
});
