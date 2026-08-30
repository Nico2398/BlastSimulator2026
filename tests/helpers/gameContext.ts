// BlastSimulator2026 — Shared GameContext test-fixture builder (skeleton, #830)
//
// Consolidates the repeated `{ state: null, grid: null, landscape: null,
// playableArea: null, emitter: new EventEmitter() }` + newGameCommand(...)
// boilerplate scattered across test files into one shared builder. Bodies
// are stubs only — implementer fills these in on a separate branch that
// never sees the tests written against this API.

import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import type { GameContext, LandscapeHandle } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { PlayableArea } from '../../src/core/world/PlayableArea.js';

// Re-exported so callers of this module don't need to reach into
// console/commands/world.js separately just to type a ctx.
// Implementer will import `newGameCommand` (value import) from that module
// directly inside makeGameContext's body once it's filled in.
export type { GameContext };

/** Per-field overrides for `makeEmptyGameContext`. Omitted fields default to null/a fresh EventEmitter. */
export interface GameContextOverrides {
  state?: GameState | null;
  grid?: VoxelGrid | null;
  landscape?: LandscapeHandle | null;
  playableArea?: PlayableArea | null;
  emitter?: EventEmitter;
}

/**
 * Build a bare GameContext with no game started — all fields null except a
 * fresh EventEmitter, unless overridden.
 * // TODO: implement
 */
export function makeEmptyGameContext(_overrides?: GameContextOverrides): GameContext {
  return undefined as unknown as GameContext;
}

/** Options for `makeGameContext` — mirrors `newGameCommand`'s named-arg surface (all optional, all string|number where a raw console arg could be either). */
export interface MakeGameContextOptions {
  mineType?: string;
  seed?: number | string;
  size?: number | string;
  sizeY?: number | string;
  cash?: number | string;
  staffed?: boolean;
}

/**
 * Build a GameContext with a fresh game started via `newGameCommand`, using
 * sensible defaults for every option so callers only need to set what their
 * test cares about.
 * // TODO: implement
 */
export function makeGameContext(_opts?: MakeGameContextOptions): GameContext {
  return undefined as unknown as GameContext;
}
