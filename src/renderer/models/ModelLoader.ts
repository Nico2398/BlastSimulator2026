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
 * Main-thread budget one run of parses may spend before yielding. Without a
 * GPU a yield costs a whole software-rendered frame (hundreds of ms in a
 * headless harness, seconds once a level is up), so yielding after every
 * parse turned a two-second preload into a minute; parsing in slices keeps
 * the page responsive at a fraction of that.
 */
export const PRELOAD_SLICE_MS = 120;

interface PreloadOptions {
  ids?: readonly string[];
  base?: string;
  /**
   * Awaited once a run of parses has used up `sliceMs` of main-thread time.
   * The browser passes an event-loop yield so a page booting through this
   * keeps painting and answering input: every parse is main-thread work, and
   * 76 of them back to back would otherwise run as one long task. Tests
   * leave it unset.
   */
  yieldBetween?: () => Promise<void>;
  /** Parse budget between two yields; defaults to PRELOAD_SLICE_MS. 0 yields after every parse. */
  sliceMs?: number;
}

/**
 * Load every model id (default: all of them) into `library`. Bytes are
 * fetched concurrently; parsing runs one model at a time, in id order.
 * Failures are reported, not thrown: a missing asset costs one stand-in box,
 * never the level.
 */
export async function preloadModels(
  library: ModelLibrary,
  fetchBytes: ByteSource,
  options: PreloadOptions = {},
): Promise<PreloadResult> {
  const ids = options.ids ?? allModelIds();
  const sliceMs = options.sliceMs ?? PRELOAD_SLICE_MS;
  const result: PreloadResult = { loaded: [], failed: [] };
  const pending = ids.map(id => fetchBytes(modelUrl(id, options.base)).then(
    bytes => ({ bytes }),
    (error: unknown) => ({ error }),
  ));
  let sliceStart = performance.now();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const fetched = await pending[i]!;
    try {
      if ('error' in fetched) throw fetched.error;
      library.register(id, await parseModel(fetched.bytes));
      result.loaded.push(id);
    } catch {
      result.failed.push(id);
    }
    if (options.yieldBetween && i < ids.length - 1 && performance.now() - sliceStart >= sliceMs) {
      await options.yieldBetween();
      sliceStart = performance.now();
    }
  }
  return result;
}

/** Browser yield between parses: one macrotask, so rendering and input get a turn. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Browser byte source: a plain fetch of the served asset. */
export async function fetchModelBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}
