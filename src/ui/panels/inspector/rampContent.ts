/** Inspector content for ramp selections (#1769). */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { computeRampCost } from '../../../core/mining/Ramp.js';
import { nextRampWidth } from '../../../core/mining/RampWidening.js';
import type { BuiltRamp, PlannedRamp } from '../../../core/state/GameState.js';
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
  if (plannedRamps.some(p => p.widenOf === ramp.id)) return { cost, disabledReason: t('inspector.ramp.widen_in_progress') };
  if (cash < cost) return { cost, disabledReason: t('inspector.ramp.widen_short_funds', { cost: formatMoney(cost) }) };
  return { cost, disabledReason: null };
}

function buildDimensions(ramp: BuiltRamp): HTMLElement {
  const meters = (n: number) => t('inspector.depth_value', { depth: n });
  return sectionOf(t('inspector.section.details'), [
    valueRow(t('inspector.ramp.width'), meters(ramp.width)),
    valueRow(t('inspector.ramp.depth'), meters(ramp.def.targetDepth)),
    valueRow(t('inspector.ramp.length'), meters(ramp.def.length)),
  ]);
}

export const rampContent: KindContent = {
  view(entity, state) {
    const ramp = state.builtRamps.find(r => r.id === entity.id);
    if (!ramp) return null;
    const desc = describeRamp(ramp);
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
      signature: `${ramp.id}:${ramp.width}`,
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
