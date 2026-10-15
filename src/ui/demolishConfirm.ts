// Demolish confirmation modal config (#1399).

import type { Building } from '../core/entities/Building.js';
import { getDemolishCost, warehouseStockKg } from '../core/entities/Building.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import { t } from '../core/i18n/I18n.js';
import type { LogisticsState } from '../core/economy/Logistics.js';
import { warehouseStoredKg } from '../core/economy/FreightWarehouses.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';

/** Freight ore (kg) a demolition of `b` would lose; 0 for any other type. */
export function freightOreKg(logistics: LogisticsState, b: Building): number {
  return b.type === 'freight_warehouse' ? Math.round(warehouseStoredKg(logistics, b.id)) : 0;
}

/** Build the confirm-modal config for demolishing `b`; `onConfirm` runs the demolition. */
export function buildDemolishConfirm(b: Building, onConfirm: () => void, opts: { storedOreKg?: number } = {}): ConfirmModalConfig {
  const lines = [
    t('ui.build.demolish_confirm_body', {
      name: t(`building.${b.type}.t${b.tier}.name`),
      cost: formatMoney(getDemolishCost(b)),
    }),
  ];
  const kg = warehouseStockKg(b);
  if (kg > 0) lines.push(t('ui.build.demolish_confirm_loses_explosives', { kg }));
  if ((opts.storedOreKg ?? 0) > 0) lines.push(t('ui.build.demolish_confirm_loses_ore', { kg: opts.storedOreKg! }));
  return {
    icon: 'trash',
    title: t('ui.build.demolish_confirm_title'),
    body: lines.join(' '),
    confirmLabel: t('ui.build.demolish'),
    onConfirm,
  };
}
