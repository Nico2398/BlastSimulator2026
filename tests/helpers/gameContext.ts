// BlastSimulator2026 — Shared GameContext test-fixture builder (#830)
//
// Consolidates the repeated `{ state: null, grid: null, landscape: null,
// playableArea: null, emitter: new EventEmitter() }` + newGameCommand(...)
// boilerplate that used to be hand-rolled across test files into two shared
// builders: `makeEmptyGameContext` for a bare, no-game-started context, and
// `makeGameContext` for one with a fresh game already started.

import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { newGameCommand, type GameContext, type LandscapeHandle } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { PlayableArea } from '../../src/core/world/PlayableArea.js';

// Re-exported so callers of this module don't need to reach into
// console/commands/world.js separately just to type a ctx.
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
 */
export function makeEmptyGameContext(overrides?: GameContextOverrides): GameContext {
  return {
    state: overrides?.state !== undefined ? overrides.state : null,
    grid: overrides?.grid !== undefined ? overrides.grid : null,
    landscape: overrides?.landscape !== undefined ? overrides.landscape : null,
    playableArea: overrides?.playableArea !== undefined ? overrides.playableArea : null,
    emitter: overrides?.emitter !== undefined ? overrides.emitter : new EventEmitter(),
  };
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
 */
export function makeGameContext(opts?: MakeGameContextOptions): GameContext {
  const ctx = makeEmptyGameContext();

  const named: Record<string, string> = {
    mine_type: String(opts?.mineType ?? 'desert'),
    seed: String(opts?.seed ?? 42),
    size: String(opts?.size ?? 32),
  };
  if (opts?.sizeY !== undefined) named['size_y'] = String(opts.sizeY);
  if (opts?.cash !== undefined) named['cash'] = String(opts.cash);
  if (opts?.staffed !== undefined) named['staffed'] = String(opts.staffed);

  const result = newGameCommand(ctx, [], named);
  if (!result.success) {
    throw new Error(`makeGameContext: newGameCommand failed: ${result.output}`);
  }

  return ctx;
}
