// BlastSimulator2026 — Explanation texts for HUD elements (#2169)
//
// What a modifier chip, the weather button, the board chip and a mini-map legend entry do
// to the game, translated through t(); every number is read from balance.ts or the core
// function that applies it. Callers attach the text with explainable() / bindExplain().

import type { ActiveModifier } from '../core/events/ActiveModifiers.js';
import { modifierValueText } from '../core/events/ModifierText.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';
import {
  BOARD_CONFIDENCE_MAX, BOARD_CONFIDENCE_MET_GAIN, BOARD_CONFIDENCE_MISS_PENALTY, BOARD_CONFIDENCE_START,
} from '../core/config/balance.js';
import { t } from '../core/i18n/I18n.js';
import { formatGameClock } from './formatGameClock.js';
import type { MiniMapLayerId } from './miniMapLayers.js';

/** What a live modifier does, and until when (game clock) or that it is permanent. */
export function modifierExplain(m: ActiveModifier, tick: number): string {
  const parts = [t(`ui.hud_explain.modifier.${m.kind}`, { value: modifierValueText(m) })];
  if (m.role !== null) parts.push(t('ui.hud_explain.role', { role: t(`role.${m.role}`) }));
  parts.push(m.endTick === null
    ? t('ui.hud_explain.permanent')
    : t('ui.hud_explain.until', { when: formatGameClock(Math.max(m.endTick, tick)) }));
  return parts.join(' ');
}

/** The weather's name and its effect on the mine. */
export function weatherExplain(weather: WeatherState): string {
  return t('ui.hud_explain.weather', { name: t(`hud.weather.${weather}`), effect: t(`ui.weather.effect.${weather}`) });
}

/** What board confidence and the quarterly review do. */
export function boardExplain(): string {
  return t('ui.hud_explain.board', {
    start: BOARD_CONFIDENCE_START, max: BOARD_CONFIDENCE_MAX,
    gain: BOARD_CONFIDENCE_MET_GAIN, penalty: BOARD_CONFIDENCE_MISS_PENALTY,
  });
}

/** What one mini-map legend colour stands for. */
export function minimapLayerExplain(id: MiniMapLayerId): string {
  return t(`ui.hud_explain.minimap.${id}`);
}
