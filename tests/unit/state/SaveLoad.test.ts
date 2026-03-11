import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createGame } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { FilePersistence } from '../../../src/persistence/FilePersistence.js';

const TEST_SAVE_DIR = path.join(process.cwd(), 'tmp-test-saves');

afterAll(() => {
  // Cleanup test directory
  if (fs.existsSync(TEST_SAVE_DIR)) {
    fs.rmSync(TEST_SAVE_DIR, { recursive: true });
  }
});

describe('serialize / deserialize', () => {
  it('round-trip produces an equivalent state', () => {
    const state = createGame({ seed: 42 });
    state.time = 5000;
    state.timeScale = 2;
    const json = serialize(state);
    const restored = deserialize(json);
    expect(restored).toEqual(state);
  });

  it('serialized output is valid JSON', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('deserialization of unknown future version throws a clear error', () => {
    const futureState = JSON.stringify({ version: 9999, seed: 1 });
    expect(() => deserialize(futureState)).toThrow(/unknown save version.*9999/i);
  });

  it('deserialization of invalid data throws', () => {
    expect(() => deserialize('"not an object"')).toThrow(/expected a JSON object/i);
  });

  it('deserialization of missing version throws', () => {
    expect(() => deserialize('{"seed":1}')).toThrow(/missing version/i);
  });
});

describe('FilePersistence', () => {
  let backend: FilePersistence;

  beforeEach(() => {
    // Clean directory between tests
    if (fs.existsSync(TEST_SAVE_DIR)) {
      fs.rmSync(TEST_SAVE_DIR, { recursive: true });
    }
    backend = new FilePersistence(TEST_SAVE_DIR);
  });

  it('save and load round-trip', async () => {
    const state = createGame({ seed: 42 });
    const data = serialize(state);
    await backend.save('slot1', 'My Save', data, 'Level 1 in progress');

    const loaded = await backend.load('slot1');
    expect(loaded).not.toBeNull();
    expect(loaded!.data).toBe(data);
    expect(loaded!.meta.name).toBe('My Save');
    expect(loaded!.meta.slotId).toBe('slot1');
    expect(loaded!.meta.campaignSummary).toBe('Level 1 in progress');
    expect(loaded!.meta.timestamp).toBeGreaterThan(0);
  });

  it('load returns null for nonexistent slot', async () => {
    const result = await backend.load('nonexistent');
    expect(result).toBeNull();
  });

  it('list returns all saved slots with metadata', async () => {
    await backend.save('slot1', 'Save A', '{}', 'L1');
    await backend.save('slot2', 'Save B', '{}', 'L2');

    const metas = await backend.list();
    expect(metas).toHaveLength(2);
    const ids = metas.map(m => m.slotId).sort();
    expect(ids).toEqual(['slot1', 'slot2']);
  });

  it('delete removes a save slot', async () => {
    await backend.save('slot1', 'Temp', '{}', '');
    await backend.delete('slot1');
    const loaded = await backend.load('slot1');
    expect(loaded).toBeNull();
  });

  it('metadata includes version', async () => {
    await backend.save('slot1', 'Test', '{}', '');
    const loaded = await backend.load('slot1');
    expect(loaded!.meta.version).toBeDefined();
    expect(typeof loaded!.meta.version).toBe('number');
  });
});
