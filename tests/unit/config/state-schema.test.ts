// BlastSimulator2026 — State schema / serializer agreement
// The schema in validate-state-schema.ts had drifted to a field set
// serializeGameState never emitted (money, morale, corruption), so every
// scenario dump failed validation and the signal was ignored. These tests tie
// the two together: adding a field to one without the other fails here.

import { describe, it, expect } from 'vitest';
import { createRunner, serializeGameState } from '../../../src/console-api.js';
import type { MiningContext } from '../../../src/console-api.js';
import { GAME_STATE_SCHEMA } from '../../../scripts/validate-state-schema.js';

describe('state schema', () => {
  it('covers exactly the fields serializeGameState emits', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    const emitted = Object.keys(serializeGameState(ctx as MiningContext)!).sort();

    expect(Object.keys(GAME_STATE_SCHEMA).sort()).toEqual(emitted);
  });

  it('declares a type matching each emitted value', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    const state = serializeGameState(ctx as MiningContext)! as unknown as Record<string, unknown>;

    for (const [field, spec] of Object.entries(GAME_STATE_SCHEMA)) {
      const value = state[field];
      const declared = (spec as { type: string; optional?: boolean });

      if (value === null || value === undefined) {
        expect(declared.optional, `${field} is null but not marked optional`).toBe(true);
        continue;
      }

      const actual = Array.isArray(value) ? 'array' : typeof value;
      expect(actual, `${field} type`).toBe(declared.type);
    }
  });
});
