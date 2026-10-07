// Replace-pattern confirmation modal config (#1345).

import { t } from '../core/i18n/I18n.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';

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
