// BlastSimulator2026 — Outcome chips describing declarative event effects (#1414)

import type { EventEffect } from './EventSystem.js';
import type { EventEffectSpec } from './EventEffectCatalog.js';
import { formatMoney } from '../economy/formatMoney.js';
import { t } from '../i18n/I18n.js';
import { EVENT_EFFECT_JOIN_DEFAULT_ROLE } from '../config/balance.js';

/** One chip per spec; textKey is an i18n key, params carry the numbers to interpolate. */
export interface EventEffectChip extends EventEffect {
  params?: Record<string, string | number>;
}

/** Param name -> i18n namespace its raw value (a role, weather, category, ...) is looked up under. */
const PARAM_NAMESPACE: Readonly<Record<string, string>> = {
  role: 'role',
  weather: 'hud.weather',
  category: 'ui.event.category',
  what: 'ui.event.effect.what',
  pick: 'ui.event.effect.pick',
};

/** Params holding a dollar amount; shown rounded and grouped, with the currency sign in the template. */
const MONEY_PARAMS: ReadonlySet<string> = new Set(['amount', 'perDay']);

/** Specs whose role field narrows who they hit; absent means everyone. */
const SCOPED_TYPES: ReadonlySet<EventEffectSpec['type']> = new Set(['work_stoppage', 'work_rate', 'salary']);

function chipOf(spec: EventEffectSpec): EventEffectChip {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k !== 'type' && (typeof v === 'number' || typeof v === 'string')) params[k] = v;
  }
  if (SCOPED_TYPES.has(spec.type)) params['scope'] = 'role' in spec && spec.role ? spec.role : 'all';
  if (spec.type === 'employee_joins') params['role'] = spec.role ?? EVENT_EFFECT_JOIN_DEFAULT_ROLE;
  const permanent = spec.type === 'salary' && spec.days === null;
  return {
    kind: 'other', key: spec.type, delta: 0,
    textKey: `ui.event.effect.${spec.type}${permanent ? '_permanent' : ''}`,
    params,
  };
}

export function effectChips(specs: readonly EventEffectSpec[] | undefined): EventEffectChip[] {
  return (specs ?? []).map(chipOf);
}

/** The player-facing sentence of an effect chip, with role/weather/category/... values localized. Undefined without a textKey. */
export function effectChipText(effect: EventEffect): string | undefined {
  if (!effect.textKey) return undefined;
  const raw = (effect as EventEffectChip).params;
  if (!raw) return t(effect.textKey);
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'scope') params[k] = v === 'all' ? t('ui.event.effect.scope_all') : t(`role.${v}`);
    else if (MONEY_PARAMS.has(k) && typeof v === 'number') params[k] = formatMoney(v);
    else params[k] = typeof v === 'string' && PARAM_NAMESPACE[k] ? t(`${PARAM_NAMESPACE[k]}.${v}`) : v;
  }
  return t(effect.textKey, params);
}
