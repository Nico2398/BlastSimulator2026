// BlastSimulator2026 — Console commands for weather and tubing

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, requireGameWithSub, resolveHoleId } from './shared.js';
import {
  forceAdvanceInState,
  setWeather,
  ALL_WEATHER_STATES,
  type WeatherState,
} from '../../../core/weather/WeatherCycle.js';
import { buyTubing, installTubing } from '../../../core/mining/Tubing.js';
import { addExpense } from '../../../core/economy/Finance.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { drainHoles, type DrainBlock } from '../../../core/mining/HoleDrain.js';
import { wetHoles } from '../../../core/mining/WetHoles.js';
import { HOLE_DRAIN_COST_PER_HOLE } from '../../../core/config/balance.js';

export function weatherCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const weather = ctx.state!.weather;

  if (args[0] === 'advance') {
    forceAdvanceInState(weather);
    return { success: true, output: `Weather: ${weather.current}` };
  }

  if (args[0] === 'set') {
    const target = args[1] as WeatherState | undefined;
    if (!target || !ALL_WEATHER_STATES.includes(target)) {
      return {
        success: false,
        output: t('mining.weather.set_usage', { valid: ALL_WEATHER_STATES.join(', ') }),
      };
    }
    setWeather(weather, target);
    return { success: true, output: `Weather: ${weather.current}` };
  }

  return { success: true, output: `Current weather: ${weather.current}` };
}

export function tubingCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'buy') {
    const amount = parseInt(named['amount'] ?? '1', 10);
    const result = buyTubing(ctx.state!.tubingState, amount, ctx.state!.cash);
    if (!result.success) return { success: false, output: result.message };
    ctx.state!.cash -= result.cost;
    addExpense(ctx.state!.finances, result.cost, 'equipment', `Tubing x${amount}`, ctx.state!.tickCount);
    return { success: true, output: `${result.message}. Inventory: ${ctx.state!.tubingState.inventory}` };
  }

  if (sub === 'install') {
    const holeSpec = named['hole'] ?? '';
    if (!holeSpec) return { success: false, output: t('mining.tubing.install_usage') };
    const holeId = resolveHoleId(ctx.state!, holeSpec, false);
    const result = installTubing(ctx.state!.tubingState, holeId, ctx.state!.drillHoles.map(h => h.id));
    return { success: result.success, output: result.message };
  }

  return { success: true, output: `Tubing inventory: ${ctx.state!.tubingState.inventory}, installed: ${ctx.state!.tubingState.installedHoles.size} holes` };
}

const DRAIN_BLOCK_KEY: Record<DrainBlock, string> = {
  dry: 'mining.drain.dry',
  porous_untubed: 'mining.drain.porous',
  unknown_hole: 'mining.drain.unknown_hole',
  insufficient_funds: 'mining.drain.insufficient_funds',
};

/** `drain_hole hole:<id|*>` — `*` drains every wet hole; blocked ones are named, the rest still drain. */
export function drainHoleCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };
  const state = ctx.state!;
  const spec = named['hole'] ?? '';
  if (!spec) return { success: false, output: t('mining.drain.usage') };

  const batch = spec === '*';
  const ids = batch ? wetHoles(state) : [resolveHoleId(state, spec, false)];
  if (batch && ids.length === 0) return { success: false, output: t('mining.drain.nothing') };

  const result = drainHoles(state, ids);
  const blocked = Object.entries(result.refused);
  if (!batch && blocked.length > 0) {
    const [hole, block] = blocked[0]!;
    return { success: false, output: t(DRAIN_BLOCK_KEY[block], { hole, cost: `$${formatMoney(HOLE_DRAIN_COST_PER_HOLE)}` }) };
  }
  const summary = {
    count: result.drained.length,
    cost: `$${formatMoney(result.cost)}`,
    holes: result.drained.join(', '),
    blocked: blocked.map(([id]) => id).join(', '),
  };
  if (blocked.length > 0) {
    return { success: result.drained.length > 0, output: t('mining.drain.batch_blocked', summary) };
  }
  return { success: true, output: t('mining.drain.success', summary) };
}
