// Confirmation shown before starting a level while another game is live (#1809).

import type { ConfirmModalConfig } from '../panels/ConfirmModal.js';

export interface StartLevelConfirmInput {
  /** state.campaign.activeLevelId of the live game; null = sandbox. */
  liveLevelId: string | null;
  targetLevelId: string;
  /** Already formatted autosave-loss text; used on the leave branch only. */
  autosaveText: string;
}

/** Display name of the live game: sandbox label, level name, or the raw id when unknown. */
export function liveGameLabel(_liveLevelId: string | null): string {
  // TODO: implement
  return undefined as unknown as string;
}

/** Confirm-modal config: restart copy when same level, leave copy otherwise. */
export function buildStartLevelConfirm(
  _input: StartLevelConfirmInput,
  _onConfirm: () => void,
): ConfirmModalConfig {
  // TODO: implement
  return undefined as unknown as ConfirmModalConfig;
}
