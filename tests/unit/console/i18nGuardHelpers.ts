// BlastSimulator2026 — Shared "no game loaded" context helper for the
// i18n-guards test suite (mining/economy/policy/state/saveload
// *-i18n-guards.test.ts files). Extracted here per #822.

import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';

/**
 * Build a minimal context representing "no game loaded" — every game-data
 * field null, only a fresh event emitter. Structurally assignable to the
 * narrower `GameContext` too, since `MiningContext`'s extra fields are all
 * optional.
 */
export function makeEmptyCtx(): MiningContext {
  return { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
}
