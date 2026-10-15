/** Inspector content for building selections (#1756, #1758). */
import { t } from '../../../core/i18n/I18n.js';
import {
  getBuildingDef, getBuildingPeopleCapacity,
  type Building,
} from '../../../core/entities/Building.js';
import { computeBuildingStatus, type BuildingStatus } from '../../../core/entities/BuildingStatus.js';
import { factorFor } from '../../../core/events/ActiveModifiers.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import { buildingActionRules, REASON_CASH, type BuildingActionRules } from '../../buildingActionRules.js';
import { el } from '../../dom.js';
import type { ActionSpec, InspectorLinks, InspectorView, KindContent } from './InspectorContent.js';
import { storageContents } from './storageContent.js';
import { fractionOf } from '../../../core/math/Fraction.js';
import { entityLink, kindLabel, liveRow, sectionOf, setLive } from './inspectorWidgets.js';

/** Lifecycle status line: operating, closed by an event, demolition ordered, rebuilding or under construction. */
function statusText(status: BuildingStatus): string {
  const percent = status.progress === null ? null : Math.round(status.progress * 100);
  switch (status.kind) {
    case 'operating': return t('inspector.operating');
    case 'demolition_ordered': return t('inspector.status.demolition_ordered');
    case 'out_of_service':
      return t('inspector.status.out_of_service', {
        event: status.closureEventId === null ? '' : t(`event.${status.closureEventId}.title`),
        time: status.closureTicksRemaining === null
          ? t('ui.modifier.permanent')
          : t('ui.modifier.remaining', { hours: status.closureTicksRemaining }),
      });
    case 'rebuilding':
    case 'under_construction': {
      const key = status.kind === 'rebuilding' ? 'inspector.status.rebuilding' : 'inspector.status.under_construction';
      return percent === null
        ? t(`${key}_waiting`, { tier: status.targetTier ?? 1 })
        : t(key, { tier: status.targetTier ?? 1, percent });
    }
  }
}

/** Upkeep $/h (1 tick = 1 hour), with the live surcharge factor named only when it is not 1. */
function upkeepText(state: GameState, b: Building): string {
  const factor = factorFor(state.events.activeModifiers, 'upkeep_surcharge', state.tickCount);
  const perHour = getBuildingDef(b.type, b.tier).operatingCostPerTick * factor;
  const money = t('inspector.upkeep_value', { cost: formatMoney(Math.round(perHour * 100) / 100) });
  return factor === 1 ? money : t('inspector.upkeep_surcharged', { value: money, factor: Math.round(factor * 100) / 100 });
}

function reasonText(key: string | null, cost: number, cash: number, params?: Record<string, string | number>): string | undefined {
  if (key === null) return undefined;
  if (key === REASON_CASH && !params) return t(key, { need: formatMoney(cost), have: formatMoney(cash) });
  return t(key, params);
}

function withCost(action: ActionSpec['action'], labelKey: string, icon: string, cost: number, reason: string | undefined, variant: ActionSpec['variant'] = 'ghost'): ActionSpec {
  return {
    action, labelKey, icon, variant,
    label: `${t(labelKey)} · ${formatMoney(cost)}`,
    disabled: reason !== undefined,
    ...(reason !== undefined ? { title: reason } : {}),
  };
}

/** Upgrade (or Research when the next tier is locked), Move, Demolish — each with cost and a visible reason when refused. */
function standingActions(state: GameState, rules: BuildingActionRules): ActionSpec[] {
  const { upgrade, research, move, demolish } = rules;
  const actions: ActionSpec[] = [];
  if (upgrade.kind === 'locked' && research) {
    const queuedText = research.queued
      ? t('ui.build.research_progress', { percent: Math.round(research.queued.fraction * 100), remaining: research.queued.remaining })
      : undefined;
    const cashReason = state.cash < research.cost ? reasonText(REASON_CASH, research.cost, state.cash) : undefined;
    const reason = queuedText ?? cashReason;
    actions.push({
      action: 'research', labelKey: 'inspector.action.research', icon: 'up', variant: 'ghost',
      label: research.queued
        ? queuedText!
        : t('inspector.action.research_cost', { cost: formatMoney(research.cost), duration: research.duration }),
      disabled: reason !== undefined,
      ...(reason !== undefined ? { title: reason } : {}),
    });
  } else {
    const reason = reasonText(upgrade.reasonKey, upgrade.cost ?? 0, state.cash, upgrade.reasonParams);
    actions.push(upgrade.cost === null
      ? { action: 'upgrade', labelKey: 'inspector.action.upgrade', icon: 'up', variant: 'ghost', disabled: true, ...(reason ? { title: reason } : {}) }
      : { ...withCost('upgrade', 'inspector.action.upgrade', 'up', upgrade.cost, reason), ...(reason === undefined ? { title: t('inspector.tip.upgrade') } : {}) });
  }
  actions.push(
    withCost('move', 'inspector.action.move', 'drive', move.cost, reasonText(move.disabledReasonKey, move.cost, state.cash)),
    withCost('demolish', 'inspector.action.demolish', 'trash', demolish.cost, reasonText(demolish.disabledReasonKey, demolish.cost, state.cash), 'danger'),
  );
  return actions;
}

function siteActions(): ActionSpec[] {
  const title = t('inspector.reason.under_construction');
  return [
    { action: 'upgrade', labelKey: 'inspector.action.upgrade', icon: 'up', variant: 'ghost', disabled: true, title },
    { action: 'move', labelKey: 'inspector.action.move', icon: 'drive', variant: 'ghost', disabled: true, title },
    { action: 'demolish', labelKey: 'inspector.action.demolish', icon: 'trash', variant: 'danger', disabled: true, title },
  ];
}

/** HP row with a fill bar; `sync` rewrites both in place. */
function hpRow(text: string, fraction: number): HTMLElement {
  const row = liveRow(t('inspector.hp'), 'hp', text);
  const bar = el('div');
  bar.style.cssText = 'height:4px;border-radius:2px;background:var(--bsx-well)';
  const fill = el('div');
  fill.dataset['live'] = 'hp-bar';
  fill.style.cssText = `height:100%;border-radius:2px;background:var(--bsx-positive);width:${Math.round(fraction * 100)}%`;
  bar.append(fill);
  const wrap = el('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px';
  wrap.append(row, bar);
  return wrap;
}

function siteView(state: GameState, id: number, status: BuildingStatus, links: InspectorLinks): InspectorView | null {
  const site = state.plannedBuildings.find(pb => pb.buildingId === id);
  if (!site) return null;
  const builder = status.builderId === null ? undefined : state.employees.employees.find(e => e.id === status.builderId);
  const text = statusText(status);
  return {
    title: t(`building.${site.type}.t${site.tier}.name`),
    sub: `#${site.buildingId} · ${kindLabel('building')} · ${t('inspector.tier', { tier: site.tier })}`,
    icon: 'build',
    status: text,
    signature: `site:${site.type}:${site.tier}:${status.kind}:${builder?.id ?? ''}:${builder?.name ?? ''}`,
    get sections() {
      const rows: HTMLElement[] = [liveRow(t('inspector.status'), 'status', text)];
      if (builder) {
        const row = el('div', { text: `${t('inspector.builder')}: ` });
        row.style.cssText = 'font-size:11px';
        row.append(entityLink(builder.name, 'employee', builder.id, links));
        rows.push(row);
      }
      rows.push(liveRow(t('inspector.position'), 'position', `(${site.x}, ${site.z})`));
      return [sectionOf(t('inspector.section.details'), rows)];
    },
    actions: siteActions(),
    sync: root => { setLive(root, 'status', text); },
  };
}

export const buildingContent: KindContent = {
  view(entity, state, links) {
    const status = computeBuildingStatus(state, entity.id);
    if (!status) return null;
    const b = state.buildings.buildings.find(x => x.id === entity.id);
    if (!b) return siteView(state, entity.id, status, links);

    const def = getBuildingDef(b.type, b.tier);
    const hp = `${Math.round(b.hp)} / ${def.maxHp}`;
    const hpFraction = fractionOf(b.hp, def.maxHp);
    const text = statusText(status);
    const upkeep = upkeepText(state, b);
    const capacity = getBuildingPeopleCapacity(b.type, b.tier);
    const storage = storageContents(b, state, status.kind === 'out_of_service');
    const occupants = b.occupantIds
      .map(id => ({ id, name: state.employees.employees.find(e => e.id === id)?.name }))
      .filter((o): o is { id: number; name: string } => o.name !== undefined);
    const effects = Object.entries(def.scoreEffects).filter(([, v]) => v !== 0 && v !== undefined);

    return {
      title: t(`building.${b.type}.t${b.tier}.name`),
      sub: `#${b.id} · ${kindLabel('building')} · ${t('inspector.tier', { tier: b.tier })}`,
      icon: 'build',
      status: text,
      signature: `${b.type}:${b.tier}:${status.kind}:${capacity}:${b.occupantIds.join(',')}:${occupants.map(o => o.name).join('|')}:${storage?.rowSignature ?? ''}`,
      get sections() {
        const rows: HTMLElement[] = [
          liveRow(t('inspector.status'), 'status', text),
          hpRow(hp, hpFraction),
          liveRow(t('inspector.upkeep'), 'upkeep', upkeep),
        ];
        for (const [id, value] of effects) {
          const amount = value as number;
          rows.push(liveRow(t(`score.${id}`), `score-${id}`, `${amount > 0 ? '+' : ''}${amount}`));
        }
        rows.push(liveRow(t('inspector.position'), 'position', `(${b.x}, ${b.z})`));
        if (capacity > 0) {
          rows.push(liveRow(t('inspector.occupancy'), 'occupancy', t('building.occupancy', { inside: b.occupantIds.length, capacity })));
          if (occupants.length > 0) {
            const inside = el('div', { text: t('inspector.inside') });
            inside.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;font-size:11px';
            occupants.forEach((o, i) => {
              if (i > 0) inside.append(', ');
              inside.append(entityLink(o.name, 'employee', o.id, links));
            });
            rows.push(inside);
          }
        }
        const details = sectionOf(t('inspector.section.details'), rows);
        return storage ? [details, storage.section] : [details];
      },
      actions: standingActions(state, buildingActionRules(state, b)),
      sync(root) {
        setLive(root, 'status', text);
        setLive(root, 'hp', hp);
        const fill = root.querySelector<HTMLElement>('[data-live="hp-bar"]');
        if (fill) fill.style.width = `${Math.round(hpFraction * 100)}%`;
        setLive(root, 'upkeep', upkeep);
        setLive(root, 'occupancy', t('building.occupancy', { inside: b.occupantIds.length, capacity }));
        storage?.sync(root);
      },
    };
  },
};
