// Demolish confirmation modal config (#1399).

import type { Building } from '../core/entities/Building.js';
import { getDemolishCost } from '../core/entities/Building.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import { t } from '../core/i18n/I18n.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';

/** Build the confirm-modal config for demolishing `b`; `onConfirm` runs the demolition. */
export function buildDemolishConfirm(b: Building, onConfirm: () => void): ConfirmModalConfig {
  const lines = [
    t('ui.build.demolish_confirm_body', {
      name: t(`building.${b.type}.t${b.tier}.name`),
      cost: formatMoney(getDemolishCost(b)),
    }),
  ];
  const kg = b.storedExplosivesKg ?? 0;
  if (kg > 0) lines.push(t('ui.build.demolish_confirm_loses_explosives', { kg }));
  return {
    icon: 'trash',
    title: t('ui.build.demolish_confirm_title'),
    body: lines.join(' '),
    confirmLabel: t('ui.build.demolish'),
    onConfirm,
  };
}
