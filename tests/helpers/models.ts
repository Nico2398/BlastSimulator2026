// BlastSimulator2026 — Model-library test fixtures
//
// Loads the real exported assets under public/models/ into a ModelLibrary
// from disk, through the same parser the browser uses, so a unit test can
// assert against the geometry the player actually sees (node names, tint
// materials, bounds) instead of a stand-in.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ModelLibrary } from '../../src/renderer/models/ModelLibrary.js';
import { preloadModels, type ByteSource, type PreloadResult } from '../../src/renderer/models/ModelLoader.js';

export const MODEL_DIR = resolve(import.meta.dirname, '..', '..', 'public', 'models');

/** Byte source mapping the served `/models/<id>.glb` URL onto public/models/. */
export const readModelBytes: ByteSource = async (url) => {
  const file = resolve(MODEL_DIR, url.replace(/^\/models\//, ''));
  const buf = readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

/** Load every model (or `ids`) from disk into `library`; returns what loaded and what failed. */
export async function loadModelsFromDisk(library: ModelLibrary, ids?: readonly string[]): Promise<PreloadResult> {
  return preloadModels(library, readModelBytes, ids);
}

/** A fresh library holding every exported asset. */
export async function loadedModelLibrary(ids?: readonly string[]): Promise<ModelLibrary> {
  const library = new ModelLibrary();
  await loadModelsFromDisk(library, ids);
  return library;
}
