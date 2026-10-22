/** Inspector content for ramp selections (#1769). */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { computeRampCost, rampGradeBoundsDegrees } from '../../../core/mining/Ramp.js';
import { nextRampWidth } from '../../../core/mining/RampWidening.js';
import { describeRampClimbability } from '../../../core/mining/RampGrade.js';
import type { RampLeg } from '../../../core/mining/RampPath.js';
import { isProgressionSite, type BuiltRamp, type PlannedRamp } from '../../../core/state/GameState.js';
import { describeRamp } from '../../describeRamp.js';
import type { ActionSpec, KindContent } from './InspectorContent.js';
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
  if (cash < cost) return { cost, disabledReason: t('inspector.ramp.widen_short_funds', { cost: formatMoney(cost) }) };
  return { cost, disabledReason: null };
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

function buildDimensions(ramp: BuiltRamp): HTMLElement {
  const meters = (n: number) => t('inspector.depth_value', { depth: n });
  const rows = [
    valueRow(t('inspector.ramp.width'), meters(ramp.width)),
    valueRow(t('inspector.ramp.depth'), meters(ramp.def.targetDepth)),
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
  view(entity, state) {
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
    return {
      title: desc.title,
      sub: `#${ramp.id} · ${kindLabel('ramp')}`,
      icon: 'layers',
      status: desc.sub,
      signature: `${ramp.id}:${ramp.width}:${ramp.def.legs?.map(l => `${l.direction}${l.length}`).join('/') ?? ''}:${ramp.def.gradeDegrees ?? ''}:${climb?.climbable ?? ''}:${widen.disabledReason ?? 'ready'}`,
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
