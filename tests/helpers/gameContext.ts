// BlastSimulator2026 — Shared GameContext test-fixture builder (#830)
//
// Consolidates the repeated `{ state: null, grid: null, landscape: null,
// playableArea: null, emitter: new EventEmitter() }` + newGameCommand(...)
// boilerplate that used to be hand-rolled across test files into two shared
// builders: `makeEmptyGameContext` for a bare, no-game-started context, and
// `makeGameContext` for one with a fresh game already started.

import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { newGameCommand, buildNavGridSyncTarget, type GameContext, type LandscapeHandle } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { PlayableArea } from '../../src/core/world/PlayableArea.js';
import { subscribeNavGridToUpdates } from '../../src/core/nav/NavGridSync.js';

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
  const ctx: GameContext = {
    state: overrides?.state !== undefined ? overrides.state : null,
    grid: overrides?.grid !== undefined ? overrides.grid : null,
    landscape: overrides?.landscape !== undefined ? overrides.landscape : null,
    playableArea: overrides?.playableArea !== undefined ? overrides.playableArea : null,
    emitter: overrides?.emitter !== undefined ? overrides.emitter : new EventEmitter(),
  };

  // Mirrors createRunner.ts's own wiring (#1146, #1161) — every test built on
  // this fixture keeps getting NavGrid patched automatically from
  // `terrain:updated` and `nav:occupancy_changed` now that the manual
  // per-call-site patch calls are gone.
  subscribeNavGridToUpdates(ctx.emitter, () => buildNavGridSyncTarget(ctx));

  return ctx;
}

/**
 * Stand-in for the old `grid.sizeY` read (#1192): the height-free `VoxelGrid`
 * constructor now reports a fixed internal sentinel there instead of the real
 * generated height, so a test scanning a full column of a `makeGameContext`-
 * (or equivalent `new_game size:32`-)built grid needs its own ceiling. Real
 * generated terrain never exceeds `size` (unchanged by the migration,
 * byte-identical generation per #1190), so this mirrors `makeGameContext`'s
 * own `size` default below and is the right ceiling for a full-column
 * clear/set/scan.
 */
export const GENERATED_TERRAIN_GRID_SIZE_Y = 32;

/** Options for `makeGameContext` — mirrors `newGameCommand`'s named-arg surface (all optional, all string|number where a raw console arg could be either). */
export interface MakeGameContextOptions {
  mineType?: string;
  seed?: number | string;
  size?: number | string;
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
    size: String(opts?.size ?? GENERATED_TERRAIN_GRID_SIZE_Y),
  };
  if (opts?.cash !== undefined) named['cash'] = String(opts.cash);
  if (opts?.staffed !== undefined) named['staffed'] = String(opts.staffed);

  const result = newGameCommand(ctx, [], named);
  if (!result.success) {
    throw new Error(`makeGameContext: newGameCommand failed: ${result.output}`);
  }

  return ctx;
}
