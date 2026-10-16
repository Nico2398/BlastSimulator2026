/** Inspector content for hole selections (#1769). Facts only: charging and editing live in the Blast Workshop. */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { holeNumericId, type DrillHole } from '../../../core/mining/DrillPlan.js';
import { hasTubing } from '../../../core/mining/Tubing.js';
import type { HoleCharge } from '../../../core/mining/ChargePlan.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import { isHoleFlooded } from '../../../core/weather/WeatherEffects.js';
import type { GameState } from '../../../core/state/GameState.js';
import { el } from '../../dom.js';
import type { KindContent } from './InspectorContent.js';
import { kindLabel, noteLine, sectionOf, syncSection, valueRow } from './inspectorWidgets.js';

type ChargeKind = 'charged' | 'ordered' | 'none';
type GroundKind = 'dry' | 'wet' | 'tubed';

function tagged(node: HTMLElement, attr: string, value = ''): HTMLElement {
  node.setAttribute(attr, value);
  return node;
}

/** The charge that applies and whether it is loaded: a loaded charge wins over an ordered one. */
function chargeOf(holeId: string, state: GameState): { kind: ChargeKind; charge: HoleCharge | null } {
  const loaded = state.chargesByHole[holeId];
  if (loaded) return { kind: 'charged', charge: loaded };
  const planned = state.plannedChargesByHole[holeId];
  if (planned) return { kind: 'ordered', charge: planned };
  return { kind: 'none', charge: null };
}

/** Tubed beats wet beats dry. */
function groundOf(holeId: string, state: GameState): GroundKind {
  if (hasTubing(state.tubingState, holeId)) return 'tubed';
  return isHoleFlooded(state.holeWater[holeId]?.level ?? 0) ? 'wet' : 'dry';
}

function explosiveName(explosiveId: string): string {
  const def = getExplosive(explosiveId);
  return def ? t(def.nameKey) : explosiveId;
}

function buildChargeSection(holeId: string, state: GameState): HTMLElement {
  const { kind, charge } = chargeOf(holeId, state);
  const rows: HTMLElement[] = [];
  if (!charge) {
    rows.push(noteLine(t('inspector.hole.uncharged')));
  } else {
    if (kind === 'ordered') rows.push(noteLine(t('inspector.hole.charge_ordered')));
    rows.push(valueRow(t('inspector.hole.explosive'), explosiveName(charge.explosiveId)));
    rows.push(valueRow(t('inspector.hole.charge_kg'), t('inspector.vehicle.kg', { kg: formatMoney(charge.amountKg) })));
    if ((charge.fromStockKg ?? 0) > 0) {
      rows.push(tagged(valueRow(t('inspector.hole.from_stock'), t('inspector.vehicle.kg', { kg: formatMoney(charge.fromStockKg ?? 0) })), 'data-hole-from-stock'));
    }
    rows.push(valueRow(t('inspector.hole.stemming'), t('inspector.depth_value', { depth: charge.stemmingM })));
  }
  const section = sectionOf(t('inspector.hole.section.charge'), rows);
  section.setAttribute('data-hole-charge', kind);
  return section;
}

function buildFactsSection(hole: DrillHole, ordered: boolean, state: GameState): HTMLElement {
  const ground = groundOf(hole.id, state);
  const rows = [
    valueRow(t('inspector.depth'), t('inspector.depth_value', { depth: hole.depth })),
    valueRow(t('inspector.hole.diameter'), t('inspector.depth_value', { depth: hole.diameter })),
    tagged(valueRow(t('inspector.hole.state'), t(ordered ? 'inspector.hole.state_ordered' : 'inspector.hole.state_drilled')),
      'data-hole-state', ordered ? 'ordered' : 'drilled'),
    tagged(valueRow(t('inspector.hole.ground'), t(`inspector.hole.ground_${ground}`)), 'data-hole-ground', ground),
    noteLine(t('inspector.hole.workshop_note')),
  ];
  return sectionOf(t('inspector.section.details'), rows);
}

export const holeContent: KindContent = {
  view(entity, state) {
    const drilled = state.drillHoles.find(h => holeNumericId(h.id) === entity.id);
    const hole = drilled ?? state.plannedDrillHoles.find(h => holeNumericId(h.id) === entity.id);
    if (!hole) return null;
    const ordered = !drilled;
    const builders: Array<[string, () => HTMLElement]> = [
      ['bs-hole-facts', () => buildFactsSection(hole, ordered, state)],
      ['bs-hole-charge', () => buildChargeSection(hole.id, state)],
    ];
    return {
      title: hole.id,
      sub: `#${entity.id} · ${kindLabel('hole')}`,
      icon: 'hole',
      status: t(ordered ? 'inspector.hole.state_ordered' : 'inspector.hole.state_drilled'),
      signature: `${hole.id}:${ordered ? 'ordered' : 'drilled'}:${chargeOf(hole.id, state).kind}`,
      get sections() {
        const body = el('div', { className: 'bs-hole-detail' });
        body.style.cssText = 'display:flex;flex-direction:column;gap:11px';
        for (const [className, make] of builders) {
          const node = make();
          node.classList.add(className);
          body.append(node);
        }
        return [body];
      },
      actions: [],
      sync: root => {
        const body = root.querySelector<HTMLElement>('.bs-hole-detail');
        if (!body) return;
        for (const [className, make] of builders) syncSection(body, className, make);
      },
    };
  },
};
