// BlastSimulator2026 — Player-facing text for active event modifiers (#1414)

import type { ActiveModifier } from './ActiveModifiers.js';
import { remainingTicks } from './ActiveModifiers.js';
import { ALL_WEATHER_STATES } from '../weather/WeatherCycle.js';
import { t } from '../i18n/I18n.js';

/** The number or name a modifier's label shows, by kind. */
function labelValue(m: ActiveModifier): string {
  switch (m.kind) {
    case 'morale_drift': return `${m.magnitude > 0 ? '+' : ''}${m.magnitude}`;
    case 'recurring_charge': return `$${Math.round(m.magnitude).toLocaleString('en-US')}`;
    case 'forced_weather': return t(`hud.weather.${ALL_WEATHER_STATES[m.magnitude] ?? 'sunny'}`);
    case 'event_weight': return `${t(`ui.event.category.${m.category ?? 'union'}`)} ×${m.magnitude.toFixed(2)}`;
    case 'work_stoppage': case 'blast_ban': case 'haul_pause': case 'drill_ban': case 'out_of_service': return '';
    default: return `×${m.magnitude.toFixed(2)}`;
  }
}

/** "Work stoppage · Driller" style label for a modifier. */
function modifierLabel(m: ActiveModifier): string {
  const label = t(`ui.modifier.${m.kind}`, { value: labelValue(m) });
  return m.role === null ? label : `${label} (${t(`role.${m.role}`)})`;
}

/** Time left on a modifier, e.g. "12h", or the permanent marker. */
function modifierRemainingText(m: ActiveModifier, tick: number): string {
  const left = remainingTicks(m, tick);
  return left === null ? t('ui.modifier.permanent') : t('ui.modifier.remaining', { hours: left });
}

/** One line per modifier: label and time left. */
export function modifierSummary(m: ActiveModifier, tick: number): string {
  return `${modifierLabel(m)} · ${modifierRemainingText(m, tick)}`;
}
