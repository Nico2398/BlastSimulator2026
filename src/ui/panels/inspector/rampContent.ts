/** Inspector content for ramp selections (#1769). */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { computeRampCost, rampGradeBoundsDegrees } from '../../../core/mining/Ramp.js';
import { nextRampWidth } from '../../../core/mining/RampWidening.js';
import { describeRampClimbability } from '../../../core/mining/RampGrade.js';
import { nextRampFlowSetting, rampFlowSetting } from '../../../core/mining/RampFlow.js';
import type { RampLeg } from '../../../core/mining/RampPath.js';
import { isProgressionSite, type BuiltRamp, type PlannedRamp } from '../../../core/state/GameState.js';
import { describeRamp } from '../../describeRamp.js';
import type { ActionSpec, InspectorLinks, KindContent } from './InspectorContent.js';
import { kindLabel, sectionOf, syncSection, valueRow } from './inspectorWidgets.js';
import { el } from '../../dom.js';

export interface WidenState {
  /** Cost of the next widening, null when the ramp is at maximum width. */
  cost: number | null;
  /** Why Widen is disabled, null when it is available. */
  disabledReason: string | null;
}

export function widenState(ramp: BuiltRamp, plannedRamps: readonly PlannedRamp[], cash: number): WidenState {
  const next = nextRampWidth(ramp.width);
  if (next === null) return { cost: null, disabledReason: null };
  const cost = computeRampCost(ramp.def.length, next - ramp.width);
  if (ramp.def.legs) return { cost, disabledReason: t('inspector.ramp.widen_multi_leg') };
  if (plannedRamps.some(p => p.widenOf === ramp.id)) return { cost, disabledReason: t('inspector.ramp.widen_in_progress') };
  if (plannedRamps.some(p => p.repairOf === ramp.id)) return { cost, disabledReason: t('inspector.ramp.repair_in_progress') };
  if (cash < cost) return { cost, disabledReason: t('inspector.ramp.widen_short_funds', { cost: formatMoney(cost) }) };
  return { cost, disabledReason: null };
}

/**
 * The Repair action for a built ramp a blast damaged (#2045): its cost, disabled with the reason when the cash
 * or the ramp's reach falls short; none when the ramp is intact or no terrain can be read.
 */
export function repairAction(ramp: BuiltRamp, plannedRamps: readonly PlannedRamp[], cash: number, links: InspectorLinks): ActionSpec | null {
  const base = { action: 'repair', labelKey: 'inspector.ramp.repair', icon: 'build', variant: 'ghost' } as const;
  if (plannedRamps.some(p => p.repairOf === ramp.id)) {
    return { ...base, label: t('inspector.action.repair'), disabled: true, title: t('inspector.ramp.repair_in_progress') };
  }
  const offer = links.rampRepairQuote?.(ramp.id);
  if (offer === undefined || (offer.kind === 'refused' && offer.errorKey === 'mining.repair_ramp.intact')) return null;
  if (offer.kind === 'refused') {
    return { ...base, label: t('inspector.action.repair'), disabled: true, title: t(offer.errorKey, offer.errorParams) };
  }
  const cost = formatMoney(offer.cost);
  const short = cash < offer.cost;
  return {
    ...base, label: t('inspector.ramp.repair', { cost }), disabled: short,
    ...(short ? { title: t('inspector.ramp.repair_short_funds', { cost }) } : {}),
  };
}

/** "2 · 12m south, 10m east": leg count, then each leg's length and heading. */
function legsText(legs: readonly RampLeg[]): string {
  const items = legs.map(l => t('inspector.ramp.leg_item', { length: l.length, direction: t(`inspector.ramp.dir_${l.direction}`) }));
  return `${legs.length} · ${items.join(', ')}`;
}

/** Design grade in whole degrees: the chosen one, else the straight line to the target depth. */
function designGradeText(def: BuiltRamp['def']): string {
  const grade = def.gradeDegrees ?? rampGradeBoundsDegrees(def.length, def.targetDepth).min;
  return t('shell.selection.ramp_grade', { grade: Math.round(grade) });
}

/**
 * The Traffic action: one press moves the ramp to the next setting, two-way, down only, up only, then two-way again
 * (`nextRampFlowSetting`); the hint says why a pit wants one ramp each way.
 */
export function trafficAction(ramp: BuiltRamp): ActionSpec {
  const next = nextRampFlowSetting(rampFlowSetting(ramp));
  return {
    action: 'traffic', labelKey: 'inspector.ramp.traffic_switch', icon: 'chevR', variant: 'ghost',
    label: t('inspector.ramp.traffic_switch', { next: t(`inspector.ramp.traffic_${next}`) }),
    title: t('inspector.ramp.traffic_hint'),
  };
}

function buildDimensions(ramp: BuiltRamp): HTMLElement {
  const meters = (n: number) => t('inspector.depth_value', { depth: n });
  const rows = [
    valueRow(t('inspector.ramp.traffic'), t(`inspector.ramp.traffic_${rampFlowSetting(ramp)}`)),
    valueRow(t('inspector.ramp.width'), meters(ramp.width)),
    valueRow(t('inspector.ramp.depth'), meters(Math.round(ramp.def.targetDepth * 10) / 10)),
    valueRow(t('inspector.ramp.length'), meters(ramp.def.length)),
  ];
  if (ramp.def.legs) {
    rows.push(
      valueRow(t('inspector.ramp.legs'), legsText(ramp.def.legs)),
      valueRow(t('inspector.ramp.grade'), designGradeText(ramp.def)),
    );
  }
  return sectionOf(t('inspector.section.details'), rows);
}

export const rampContent: KindContent = {
  view(entity, state, links) {
    const ramp = state.builtRamps.find(r => r.id === entity.id);
    if (!ramp) return null;
    const climb = describeRampClimbability(state.navGrid, ramp, isProgressionSite(state)) ?? undefined;
    const desc = describeRamp(ramp, climb);
    const widen = widenState(ramp, state.plannedRamps, state.cash);
    const actions: ActionSpec[] = widen.cost === null ? [] : [{
      action: 'widen', labelKey: 'inspector.ramp.widen', icon: 'up', variant: 'ghost',
      label: t('inspector.ramp.widen', { cost: formatMoney(widen.cost) }),
      disabled: widen.disabledReason !== null,
      ...(widen.disabledReason !== null ? { title: widen.disabledReason } : {}),
    }];
    const repair = repairAction(ramp, state.plannedRamps, state.cash, links);
    if (repair !== null) actions.push(repair);
    actions.push(trafficAction(ramp));
    return {
      title: desc.title,
      sub: `#${ramp.id} · ${kindLabel('ramp')}`,
      icon: 'layers',
      status: desc.sub,
      signature: `${ramp.id}:${rampFlowSetting(ramp)}:${ramp.width}:${ramp.def.legs?.map(l => `${l.direction}${l.length}`).join('/') ?? ''}:${ramp.def.gradeDegrees ?? ''}:${climb?.climbable ?? ''}:${widen.disabledReason ?? 'ready'}:${repair?.label ?? ''}:${repair?.disabled ?? ''}`,
      get sections() {
        const body = el('div', { className: 'bs-ramp-detail' });
        const section = buildDimensions(ramp);
        section.classList.add('bs-ramp-dimensions');
        body.append(section);
        return [body];
      },
      actions,
      sync: root => {
        const body = root.querySelector<HTMLElement>('.bs-ramp-detail');
        if (body) syncSection(body, 'bs-ramp-dimensions', () => buildDimensions(ramp));
      },
    };
  },
};
