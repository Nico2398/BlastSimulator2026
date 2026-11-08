// BlastSimulator2026 — Explanation texts for the build menu, placed rows and building inspector (#2171)
//
// What a tier, a badge, a utilization figure, HP and the upkeep multiplier of a building mean,
// translated through t(); every number is read from the building defs or the live modifiers.
// Callers attach the text with explainable().

import { t } from '../core/i18n/I18n.js';
import { getBuildingDef, isSingleTierType, type Building, type BuildingTier, type BuildingType } from '../core/entities/Building.js';
import type { BuildingStatus } from '../core/entities/BuildingStatus.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import type { GameState } from '../core/state/GameState.js';

/** Which stored/occupied figure a placed row's utilization shows. */
type UtilizationKind = 'beds' | 'kg' | 'research';

const TIERS: readonly BuildingTier[] = [1, 2, 3];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Compares every tier of `type`: cost, max HP and upkeep per hour, one line per tier. */
export function tierCompareExplain(type: BuildingType): string {
  const tiers = isSingleTierType(type) ? TIERS.slice(0, 1) : TIERS;
  const lines = tiers.map((tier) => {
    const def = getBuildingDef(type, tier);
    return t('ui.explain.building_tier_line', {
      tier,
      cost: formatMoney(def.constructionCost),
      hp: def.maxHp,
      upkeep: formatMoney(round2(def.operatingCostPerTick)),
    });
  });
  return [t('ui.explain.building_tier_head'), ...lines].join('\n');
}

/** Translated `#id <tier name> (x,z)` title of a placed row. */
export function placedRowTitle(b: Pick<Building, 'id' | 'type' | 'tier' | 'x' | 'z'>): string {
  return t('ui.build.row.title', { id: b.id, name: t(`building.${b.type}.t${b.tier}.name`), x: b.x, z: b.z });
}

/** Why a row carries `badge`: the closing event and time left, or what the status means. */
export function badgeExplain(
  badge: 'out_of_service' | 'demolition_ordered' | 'upgrading',
  status: Pick<BuildingStatus, 'closureEventId' | 'closureTicksRemaining'>,
): string {
  if (badge !== 'out_of_service') return t(`ui.explain.building_badge_${badge}`);
  const event = status.closureEventId === null ? t('ui.explain.building_closed_unknown') : t(`event.${status.closureEventId}.title`);
  const time = status.closureTicksRemaining === null
    ? t('ui.modifier.permanent')
    : t('ui.modifier.remaining', { hours: status.closureTicksRemaining });
  return t('ui.explain.building_badge_out_of_service', { event, time });
}

/** What the utilization figure of a placed row counts. */
export function utilizationExplain(b: Building, kind: UtilizationKind): string {
  return t(`ui.explain.building_util_${kind}`, { capacity: Math.round(getBuildingDef(b.type, b.tier).capacity) });
}

/** What a building's HP means and what low HP leads to. */
export function buildingHpExplain(): string { return t('ui.explain.building_hp'); }

/** Base upkeep, or the surcharge factor with the event(s) causing it. */
export function upkeepExplain(state: Pick<GameState, 'events' | 'tickCount'>): string {
  const live = state.events.activeModifiers.filter(
    (m) => m.kind === 'upkeep_surcharge' && (m.endTick === null || m.endTick > state.tickCount),
  );
  if (live.length === 0) return t('ui.explain.building_upkeep_base');
  const sources = live.map((m) => t('ui.explain.building_upkeep_source', { event: t(`event.${m.sourceEventId}.title`), factor: round2(m.magnitude) })).join(', ');
  const factor = round2(live.reduce((product, m) => product * m.magnitude, 1));
  return t('ui.explain.building_upkeep_surcharged', { factor, sources });
}
