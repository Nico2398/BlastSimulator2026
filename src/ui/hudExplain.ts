// BlastSimulator2026 — Explanation texts for HUD elements (#2169)
//
// What a modifier chip, the weather button, the board chip and a mini-map legend entry do
// to the game, translated through t(); every number is read from balance.ts or the core
// function that applies it. Callers attach the text with explainable() / bindExplain().

import type { ActiveModifier } from '../core/events/ActiveModifiers.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';
import type { MiniMapLayerId } from './miniMapLayers.js';

/** What a live modifier does, and until when (game clock) or that it is permanent. */
export function modifierExplain(_m: ActiveModifier, _tick: number): string {
  throw new Error('not implemented');
}

/** The weather's name and its effect on the mine. */
export function weatherExplain(_weather: WeatherState): string {
  throw new Error('not implemented');
}

/** What board confidence and the quarterly review do. */
export function boardExplain(): string {
  throw new Error('not implemented');
}

/** What one mini-map legend colour stands for. */
export function minimapLayerExplain(_id: MiniMapLayerId): string {
  throw new Error('not implemented');
}
