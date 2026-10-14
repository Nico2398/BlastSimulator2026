// BlastSimulator2026 — Console command: buy explosives into warehouse stock (#1678)

import type { CommandResult } from '../../ConsoleRunner.js';
import type { MiningContext } from './types.js';
import { requireGame } from './shared.js';
import { levelExplosiveFailure } from './charge.js';
import { buyExplosiveStock, type BuyStockFailure } from '../../../core/mining/ExplosiveStock.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { t } from '../../../core/i18n/I18n.js';

const FAILURE_KEY: Partial<Record<BuyStockFailure, string>> = {
  invalid_amount: 'mining.buy.invalid_amount',
  unknown_explosive: 'mining.buy.unknown_explosive',
  no_warehouse: 'mining.buy.no_warehouse',
};

/** `buy explosive:<id> kg:<n>` — purchase bulk explosives into explosive warehouses. */
export function buyExplosiveCommand(
  ctx: MiningContext,
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };
  const state = ctx.state!;
  const explosiveId = named['explosive'] ?? '';
  if (named['kg'] === undefined) return { success: false, output: t('mining.buy.explosive_usage') };

  const result = buyExplosiveStock(state, explosiveId, Number(named['kg']));
  if (result.success) {
    return {
      success: true,
      output: t('mining.buy.explosive_success', {
        kg: result.kg,
        explosive: t(getExplosive(explosiveId)!.nameKey),
        cost: formatMoney(result.cost),
        perKg: formatMoney(result.pricePerKg),
        stock: result.stockKg,
        capacity: result.capacityKg,
      }),
    };
  }
  if (result.reason === 'not_available') {
    return levelExplosiveFailure(state.campaign.activeLevelId, explosiveId)
      ?? { success: false, output: t('mining.buy.unknown_explosive') };
  }
  if (result.reason === 'over_capacity') {
    return { success: false, output: t('mining.buy.over_capacity', { free: result.freeKg ?? 0, kg: Number(named['kg']) }) };
  }
  if (result.reason === 'insufficient_funds') {
    return {
      success: false,
      output: t('console.insufficient_funds', { need: formatMoney(result.need ?? 0), have: formatMoney(state.cash) }),
    };
  }
  return { success: false, output: t(FAILURE_KEY[result.reason]!) };
}
