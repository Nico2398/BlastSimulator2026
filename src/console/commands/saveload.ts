// BlastSimulator2026 — Console save/load commands
//
// A synchronous quick-save round trip through the same serialize/deserialize
// functions the UI's persisted slots use (SavesModal, IndexedDBPersistence),
// so console mode and the command-mode scenario harness can exercise
// save/load deterministically without depending on IndexedDB's async timing.
// This is intentionally separate from SavesModal's own numbered slots —
// those remain reachable through the Saves modal and its own backend.
//
// The VoxelGrid is embedded into `ctx.state.world.voxels` right before saving
// (#458 T0.3) and restored from there on load, so blast craters, drilled
// holes, and ramps survive a save/load round trip. A save from before v6 (or
// one made without a live grid) has no embedded voxels — `load` falls back
// to regenerating pristine terrain from the saved seed/size/mine type, the
// same way `new_game` builds it, same as this file's whole history (#408).

import type { GameContext } from './world.js';
import { regenerateGrid, restoreGrid, terrainGenDatum } from './world.js';
import { DEFAULT_GRID_SIZE } from '../../core/config/balance.js';
import type { CommandResult } from '../ConsoleRunner.js';
import { serialize, deserialize } from '../../core/state/SaveLoad.js';
import { getBiome } from '../../core/world/BiomeCatalog.js';
import { encodeVoxelGrid } from '../../core/state/VoxelGridCodec.js';
import { t } from '../../core/i18n/I18n.js';

const DEFAULT_SLOT = 'quicksave';

/** In-process quick-save slots, keyed by name. Cleared on process restart. */
const quickSaveSlots = new Map<string, string>();

export function saveCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  if (!ctx.state) return { success: false, output: t('console.no_game_loaded') };
  const slot = named['slot'] ?? args[0] ?? DEFAULT_SLOT;
  if (ctx.grid && ctx.state.world) {
    ctx.state.world = { ...ctx.state.world, voxels: encodeVoxelGrid(ctx.grid, terrainGenDatum(ctx.state)) };
  }
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
  const biome = getBiome(state.mineType);
  if (!biome) return { success: false, output: `Save has unknown mine type "${state.mineType}".` };

  ctx.state = state;
  if (state.world?.voxels) {
    restoreGrid(ctx, state.world.voxels);
  } else {
    const { sizeX, sizeY, sizeZ } = state.world ?? {
      sizeX: DEFAULT_GRID_SIZE, sizeY: DEFAULT_GRID_SIZE, sizeZ: DEFAULT_GRID_SIZE, gridReady: true,
    };
    regenerateGrid(ctx, { seed: state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ });
  }

  return { success: true, output: `Loaded from slot "${slot}".` };
}
