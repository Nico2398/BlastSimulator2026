// BlastSimulator2026 — Model loading
// Turns .glb bytes into library prototypes. The byte source is injected so
// the browser fetches from public/models/ while Node tests read the same
// files from disk — both exercise the real exported assets.

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModelLibrary } from './ModelLibrary.js';
import { buildPrototype, type ModelPrototype } from './ModelMerge.js';
import { allModelIds, modelUrl } from './ModelIds.js';

export type ByteSource = (url: string) => Promise<ArrayBuffer>;

export interface PreloadResult {
  loaded: string[];
  /** Ids whose asset could not be fetched or parsed — they render as stand-in boxes. */
  failed: string[];
}

const loader = new GLTFLoader();

/** Parse one binary glTF into a merged, toon-shaded prototype. */
export function parseModel(bytes: ArrayBuffer): Promise<ModelPrototype> {
  return new Promise((resolve, reject) => {
    loader.parse(bytes, '', gltf => resolve(buildPrototype(gltf.scene)), reject);
  });
}

/**
 * Load every model id (default: all of them) into `library`. Failures are
 * reported, not thrown: a missing asset costs one stand-in box, never the
 * level.
 */
export async function preloadModels(
  library: ModelLibrary,
  fetchBytes: ByteSource,
  ids: readonly string[] = allModelIds(),
  base?: string,
): Promise<PreloadResult> {
  const result: PreloadResult = { loaded: [], failed: [] };
  await Promise.all(ids.map(async id => {
    try {
      const bytes = await fetchBytes(modelUrl(id, base));
      library.register(id, await parseModel(bytes));
      result.loaded.push(id);
    } catch {
      result.failed.push(id);
    }
  }));
  return result;
}

/** Browser byte source: a plain fetch of the served asset. */
export async function fetchModelBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}
