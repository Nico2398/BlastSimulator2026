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
// holes, and ramps survive a save/load round trip. A save with no embedded
// voxels at all — `load` falls back to regenerating pristine terrain from
// the saved seed/size/mine type, the same way `new_game` builds it, same as
// this file's whole history (#408). A save whose embedded voxels carry a
// generator version this build doesn't match is refused outright instead
// (`loadGridForState`, world.ts, #1181) — it is never silently regenerated.

import type { GameContext } from './world.js';
import { embedVoxelsForSave, loadGridForState } from './world.js';
import type { CommandResult } from '../ConsoleRunner.js';
import { serialize, deserialize } from '../../core/state/SaveLoad.js';
import { requireGame } from './commandUtils.js';

const DEFAULT_SLOT = 'quicksave';

/** In-process quick-save slots, keyed by name. Cleared on process restart. */
const quickSaveSlots = new Map<string, string>();

export function saveCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const slot = named['slot'] ?? args[0] ?? DEFAULT_SLOT;
  state.world = embedVoxelsForSave(ctx, state);
  quickSaveSlots.set(slot, serialize(state));
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
  const refusal = loadGridForState(ctx, state);
  if (refusal) return { success: false, output: refusal };

  return { success: true, output: `Loaded from slot "${slot}".` };
}
