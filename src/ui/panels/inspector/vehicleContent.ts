/** Inspector content for vehicle selections (#1756, #1761). */
import { t } from '../../../core/i18n/I18n.js';
import { resolveVehicleDriver } from '../../../core/entities/Vehicle.js';
import { computeVehicleStatus } from '../../../core/entities/VehicleStatus.js';
import { formatDollars } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import { describeStatus, vehicleDriverState } from '../../fleetDetailSections.js';
import { upgradeDisabledReason, upgradeState } from './vehicleDetailParts.js';
import { el } from '../../dom.js';
import type { ActionSpec, InspectorLinks, KindContent } from './InspectorContent.js';
import { kindLabel, syncSection } from './inspectorWidgets.js';
import {
  buildConditionSection, buildCostSection, buildDriverSection, buildCargoSection, buildJobSection, buildRepairSection, buildSpecsSection,
} from './vehicleSections.js';
import type { Vehicle } from '../../../core/entities/Vehicle.js';

/** Every section in display order; a null build removes an optional section. */
function sectionBuilders(v: Vehicle, state: GameState, links: InspectorLinks): Array<[string, () => HTMLElement | null]> {
  return [
    ['bs-vehicle-condition', () => buildConditionSection(v, state)],
    ['bs-vehicle-repair', () => buildRepairSection(v, state)],
    ['bs-vehicle-job', () => buildJobSection(v, state, links)],
    ['bs-vehicle-cargo', () => buildCargoSection(v, state)],
    ['bs-vehicle-driver', () => buildDriverSection(v, state, links)],
    ['bs-vehicle-specs', () => buildSpecsSection(v)],
    ['bs-vehicle-cost', () => buildCostSection(v, state)],
  ];
}

/** Move Here, Upgrade (cost; disabled with the reason) and Scrap. */
function actionsFor(v: Vehicle, cash: number): ActionSpec[] {
  const upgrade = upgradeState(v, cash);
  const { cost } = upgrade;
  const reason = upgradeDisabledReason(upgrade) ?? undefined;
  return [
    { action: 'move_here', labelKey: 'inspector.action.move_here', icon: 'locate', variant: 'ghost' },
    {
      action: 'upgrade_vehicle', labelKey: 'inspector.action.upgrade_vehicle', icon: 'up', variant: 'ghost',
      label: cost === null ? t('inspector.action.upgrade_vehicle') : `${t('inspector.action.upgrade_vehicle')} · ${formatDollars(cost)}`,
      disabled: reason !== undefined, ...(reason !== undefined ? { title: reason } : {}),
    },
    { action: 'scrap_vehicle', labelKey: 'ui.fleet.scrap', icon: 'trash', variant: 'danger' },
  ];
}

export const vehicleContent: KindContent = {
  view(entity, state, links) {
    const v = state.vehicles.vehicles.find(x => x.id === entity.id);
    if (!v) return null;
    const status = describeStatus(computeVehicleStatus(v, state.vehicles, resolveVehicleDriver(v, state.employees.employees)));
    const build = (): HTMLElement => {
      const body = el('div', { className: 'bs-vehicle-detail' });
      body.style.cssText = 'display:flex;flex-direction:column;gap:11px';
      for (const [className, make] of sectionBuilders(v, state, links)) {
        const node = make();
        if (node) { node.classList.add(className); body.append(node); }
      }
      return body;
    };
    return {
      title: t(`vehicle_type.${v.type}`),
      sub: `#${v.id} · ${kindLabel('vehicle')} · ${t('inspector.tier', { tier: v.tier })}`,
      icon: 'vehicle',
      status,
      signature: `${v.type}:${v.tier}:${vehicleDriverState(v, state.employees.employees).kind}`,
      get sections() { return [build()]; },
      actions: actionsFor(v, state.cash),
      sync: root => {
        const body = root.querySelector<HTMLElement>('.bs-vehicle-detail');
        if (!body) return;
        for (const [className, make] of sectionBuilders(v, state, links)) syncSection(body, className, make);
      },
    };
  },
};
