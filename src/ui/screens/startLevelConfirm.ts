// Confirmation shown before starting a level while another game is live (#1809).

import { t } from '../../core/i18n/I18n.js';
import { getLevel } from '../../core/campaign/Level.js';
import { SANDBOX_LEVEL_ID } from '../../core/campaign/Sandbox.js';
import type { ConfirmModalConfig } from '../panels/ConfirmModal.js';

interface StartLevelConfirmInput {
  /** state.campaign.activeLevelId of the live game; null = sandbox. */
  liveLevelId: string | null;
  targetLevelId: string;
  /** Already formatted autosave-loss text; used on the leave branch only. */
  autosaveText: string;
}

/** Display name of the live game: sandbox label, level name, or the raw id when unknown. */
export function liveGameLabel(liveLevelId: string | null): string {
  if (liveLevelId === null || liveLevelId === SANDBOX_LEVEL_ID) return t('menu.sandbox');
  const level = getLevel(liveLevelId);
  return level ? t(level.nameKey) : liveLevelId;
}

/** Confirm-modal config: restart copy when same level, leave copy otherwise. */
export function buildStartLevelConfirm(
  input: StartLevelConfirmInput,
  onConfirm: () => void,
): ConfirmModalConfig {
  if (input.liveLevelId === input.targetLevelId) {
    return {
      icon: 'blast',
      title: t('ui.portfolio.restart_confirm_title'),
      body: t('ui.portfolio.restart_confirm_body'),
      confirmLabel: t('ui.portfolio.restart_confirm_button'),
      onConfirm,
    };
  }
  const game = liveGameLabel(input.liveLevelId);
  return {
    icon: 'warn',
    title: t('ui.portfolio.leave_confirm_title', { game }),
    body: `${t('ui.portfolio.leave_confirm_body', { game })} ${input.autosaveText}`,
    confirmLabel: t('ui.portfolio.leave_confirm_button'),
    onConfirm,
  };
}
