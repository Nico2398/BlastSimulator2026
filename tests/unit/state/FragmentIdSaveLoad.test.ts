// BlastSimulator2026 — nextFragmentId survives save/load (#1903)

import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import { makeRubbleFragment } from '../../helpers/blastFixtures.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function freshState(): GameState {
  return makeGameContext({ mineType: 'desert', seed: '1', size: '16' }).state!;
}

function legacyJson(state: GameState): string {
  const obj = JSON.parse(serialize(state));
  delete obj.logistics.nextFragmentId;
  return JSON.stringify(obj);
}

describe('SaveLoad nextFragmentId', () => {
  it('round-trips the counter', () => {
    const state = freshState();
    state.logistics.nextFragmentId = 42;
    expect(deserialize(serialize(state)).logistics.nextFragmentId).toBe(42);
  });

  it('round-trips a counter ahead of the fragments still on the ground', () => {
    const state = freshState();
    addBlastFragments(state.logistics, [makeRubbleFragment(3, 1000, { x: 5, y: 1, z: 5 })]);
    state.logistics.nextFragmentId = 90;
    expect(deserialize(serialize(state)).logistics.nextFragmentId).toBe(90);
  });

  it('an old save without the counter resumes after the highest fragment id', () => {
    const state = freshState();
    addBlastFragments(state.logistics, [
      makeRubbleFragment(2, 1000, { x: 5, y: 1, z: 5 }),
      makeRubbleFragment(9, 1000, { x: 6, y: 1, z: 6 }),
      makeRubbleFragment(4, 1000, { x: 7, y: 1, z: 7 }),
    ]);
    expect(deserialize(legacyJson(state)).logistics.nextFragmentId).toBe(10);
  });

  it('an old save with no fragments resumes at 0', () => {
    expect(deserialize(legacyJson(freshState())).logistics.nextFragmentId).toBe(0);
  });
});
