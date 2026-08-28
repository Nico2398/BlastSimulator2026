// BlastSimulator2026 — Console commands for weather and tubing

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, requireGameWithSub, resolveHoleId } from './shared.js';
import {
  createWeatherCycle,
  forceAdvance,
  setWeather,
  ALL_WEATHER_STATES,
  type WeatherState,
} from '../../../core/weather/WeatherCycle.js';
import { Random } from '../../../core/math/Random.js';
import { buyTubing, installTubing } from '../../../core/mining/Tubing.js';
import { addExpense } from '../../../core/economy/Finance.js';

export function weatherCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (!ctx.weatherCycle) {
    ctx.weatherCycle = createWeatherCycle(ctx.state!.seed);
    ctx.rng = new Random(ctx.state!.seed + 1000);
  }

  if (args[0] === 'advance') {
    forceAdvance(ctx.weatherCycle, ctx.rng!);
    return { success: true, output: `Weather: ${ctx.weatherCycle.current}` };
  }

  if (args[0] === 'set') {
    const target = args[1] as WeatherState | undefined;
    if (!target || !ALL_WEATHER_STATES.includes(target)) {
      return {
        success: false,
        output: t('mining.weather.set_usage', { valid: ALL_WEATHER_STATES.join(', ') }),
      };
    }
    setWeather(ctx.weatherCycle, target);
    return { success: true, output: `Weather: ${ctx.weatherCycle.current}` };
  }

  return { success: true, output: `Current weather: ${ctx.weatherCycle.current}` };
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
    const holeId = resolveHoleId(ctx.state!, holeSpec, false);
    const result = installTubing(ctx.state!.tubingState, holeId);
    return { success: result.success, output: result.message };
  }

  return { success: true, output: `Tubing inventory: ${ctx.state!.tubingState.inventory}, installed: ${ctx.state!.tubingState.installedHoles.size} holes` };
}
