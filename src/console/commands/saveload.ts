// BlastSimulator2026 — Console save/load commands
//
// A synchronous quick-save round trip through the same serialize/deserialize
// functions the UI's persisted slots use (SaveLoadUI, IndexedDBPersistence),
// so console mode and the command-mode scenario harness can exercise
// save/load deterministically without depending on IndexedDB's async timing.
// This is intentionally separate from SaveLoadUI's own numbered slots —
// those remain reachable through the Save/Load panel and its own backend.
//
// The VoxelGrid is not part of the serialized GameState (see the WorldState
// comment in GameState.ts) — `load` regenerates it from the saved
// seed/size/mine type, the same way `new_game` builds it. Voxel mutations
// from blasts fired before the save are not replayed; that mirrors the save
// system's documented scope rather than adding a new limitation (#408).

import type { GameContext } from './world.js';
import { regenerateGrid, DEFAULT_GRID_SIZE } from './world.js';
import type { CommandResult } from '../ConsoleRunner.js';
import { serialize, deserialize } from '../../core/state/SaveLoad.js';
import { getMinePreset } from '../../core/world/MineType.js';

const DEFAULT_SLOT = 'quicksave';

/** In-process quick-save slots, keyed by name. Cleared on process restart. */
const quickSaveSlots = new Map<string, string>();

export function saveCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  if (!ctx.state) return { success: false, output: 'No game loaded. Use new_game first.' };
  const slot = named['slot'] ?? args[0] ?? DEFAULT_SLOT;
  quickSaveSlots.set(slot, serialize(ctx.state));
  return { success: true, output: `Saved to slot "${slot}".` };
}

export function loadCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const slot = named['slot'] ?? args[0] ?? DEFAULT_SLOT;
  const data = quickSaveSlots.get(slot);
  if (!data) return { success: false, output: `No save found in slot "${slot}".` };

  const state = deserialize(data);
  const preset = getMinePreset(state.mineType);
  if (!preset) return { success: false, output: `Save has unknown mine type "${state.mineType}".` };

  const { sizeX, sizeY, sizeZ } = state.world ?? {
    sizeX: DEFAULT_GRID_SIZE, sizeY: DEFAULT_GRID_SIZE, sizeZ: DEFAULT_GRID_SIZE, gridReady: true,
  };
  ctx.state = state;
  regenerateGrid(ctx, { seed: state.seed, preset, sizeX, sizeY, sizeZ });

  return { success: true, output: `Loaded from slot "${slot}".` };
}
