// ModelLoader — .glb bytes → library prototypes, from disk and over fetch

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { fetchModelBytes, parseModel, preloadModels, yieldToEventLoop } from '../../../../src/renderer/models/ModelLoader.js';
import { allModelIds } from '../../../../src/renderer/models/ModelIds.js';
import { readModelBytes } from '../../../helpers/models.js';

describe('parseModel', () => {
  it('parses an exported worker into a prototype with the six animatable nodes and the role tint', async () => {
    const proto = await parseModel(await readModelBytes('/models/worker_driller.glb'));
    const names = proto.root.children.map(c => c.name).sort();
    expect(names).toEqual(['ArmL', 'ArmR', 'Head', 'LegL', 'LegR', 'Torso']);
    expect(proto.tintNames).toEqual(['TintRole']);
    // Stands on the ground, a little over a metre tall, facing +X.
    expect(proto.bounds.min.y).toBeCloseTo(0, 1);
    expect(proto.bounds.max.y).toBeGreaterThan(1.1);
    expect(proto.bounds.max.y).toBeLessThan(1.6);
  });

  it('rejects bytes that are not a glTF', async () => {
    await expect(parseModel(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toBeDefined();
  });
});

describe('preloadModels', () => {
  it('loads the requested ids and reports the ones whose bytes or parse failed, without throwing', async () => {
    const lib = new ModelLibrary();
    const source = async (url: string): Promise<ArrayBuffer> => {
      if (url.includes('bogus')) throw new Error('404');
      if (url.includes('garbage')) return new Uint8Array([9, 9, 9, 9]).buffer;
      return readModelBytes(url);
    };
    const result = await preloadModels(lib, source, { ids: ['worker_driller', 'bogus', 'garbage'] });
    expect(result.loaded).toEqual(['worker_driller']);
    expect(result.failed.sort()).toEqual(['bogus', 'garbage']);
    expect(lib.has('worker_driller')).toBe(true);
    expect(lib.has('bogus')).toBe(false);
  });

  it('defaults to every catalogued id and a custom base path', async () => {
    const urls: string[] = [];
    const lib = new ModelLibrary();
    await preloadModels(lib, async url => { urls.push(url); throw new Error('skip'); }, { base: '/cdn/' });
    expect(urls).toHaveLength(allModelIds().length);
    expect(urls.every(u => u.startsWith('/cdn/') && u.endsWith('.glb'))).toBe(true);
  });
});

describe('preloadModels — pacing', () => {
  it('parses in id order, one at a time, awaiting the yield between parses but not after the last', async () => {
    const lib = new ModelLibrary();
    const events: string[] = [];
    const source = async (url: string): Promise<ArrayBuffer> => readModelBytes(url);
    const originalRegister = lib.register.bind(lib);
    lib.register = (id, proto) => { events.push(`parse:${id}`); originalRegister(id, proto); };
    const yields = { count: 0 };
    await preloadModels(lib, source, {
      ids: ['worker_driller', 'worker_manager', 'vehicle_drill_rig'],
      yieldBetween: async () => { yields.count++; events.push('yield'); },
    });
    expect(events).toEqual(['parse:worker_driller', 'yield', 'parse:worker_manager', 'yield', 'parse:vehicle_drill_rig']);
    expect(yields.count).toBe(2);
  });

  it('yieldToEventLoop resolves on a later macrotask', async () => {
    let flag = false;
    const p = yieldToEventLoop().then(() => { flag = true; });
    expect(flag).toBe(false);
    await p;
    expect(flag).toBe(true);
  });
});

describe('fetchModelBytes', () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  it('returns the response body and throws on a non-2xx status', async () => {
    const body = new Uint8Array([7, 7]).buffer;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => ({
      ok: !String(url).includes('missing'),
      status: String(url).includes('missing') ? 404 : 200,
      arrayBuffer: async () => body,
    })) as unknown as typeof fetch;
    expect(await fetchModelBytes('/models/a.glb')).toBe(body);
    await expect(fetchModelBytes('/models/missing.glb')).rejects.toThrow('HTTP 404');
  });
});
