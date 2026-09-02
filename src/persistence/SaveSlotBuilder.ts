// BlastSimulator2026 — Shared save-slot construction for persistence backends.

import type { SaveMeta, SaveSlot } from '../core/state/SaveBackend.js';
import { SAVE_VERSION } from '../core/state/GameState.js';

/** Builds the {@link SaveSlot} every backend's `save()` writes out. */
export function buildSaveSlot(
  slotId: string,
  name: string,
  data: string,
  campaignSummary: string,
  levelId: string | null,
): SaveSlot {
  const meta: SaveMeta = {
    slotId,
    name,
    timestamp: Date.now(),
    version: SAVE_VERSION,
    campaignSummary,
    levelId,
  };
  return { meta, data };
}
