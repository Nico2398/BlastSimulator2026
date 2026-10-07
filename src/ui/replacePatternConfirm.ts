// Replace-pattern confirmation modal config (#1345).

import { t } from '../core/i18n/I18n.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';

/** What a new grid would wipe, or null when the plan holds nothing worth confirming. */
export function replacePatternLoss(
  drilledCount: number,
  chargeCount: number,
): { drilled: number; charged: number } | null {
  return drilledCount > 0 || chargeCount > 0 ? { drilled: drilledCount, charged: chargeCount } : null;
}

/** Build the confirm-modal config for replacing a drilled/charged pattern; `onConfirm` runs the grid command. */
export function buildReplacePatternConfirm(
  loss: { drilled: number; charged: number },
  onConfirm: () => void,
): ConfirmModalConfig {
  return {
    icon: 'trash',
    title: t('ui.blast_workshop.drill.replace_confirm_title'),
    body: t('ui.blast_workshop.drill.replace_confirm_body', loss),
    confirmLabel: t('ui.blast_workshop.drill.replace_confirm_confirm'),
    onConfirm,
  };
}
