/** Inspector content for vehicle selections (#1756). */
import { t } from '../../../core/i18n/I18n.js';
import { resolveVehicleDriver } from '../../../core/entities/Vehicle.js';
import { computeVehicleStatus } from '../../../core/entities/VehicleStatus.js';
import { canAffordVehicleUpgrade } from '../../../core/entities/VehicleUpgrade.js';
import { describeStatus } from '../../fleetDetailSections.js';
import type { KindContent } from './InspectorContent.js';
import { kindLabel, liveRow, sectionOf, setLive } from './inspectorWidgets.js';

export const vehicleContent: KindContent = {
  view(entity, state) {
    const v = state.vehicles.vehicles.find(x => x.id === entity.id);
    if (!v) return null;
    const status = describeStatus(computeVehicleStatus(v, state.vehicles, resolveVehicleDriver(v, state.employees.employees)));
    const upgradable = canAffordVehicleUpgrade(v, state.cash);
    return {
      title: t(`vehicle_type.${v.type}`),
      sub: `#${v.id} · ${kindLabel('vehicle')} · ${t('inspector.tier', { tier: v.tier })}`,
      icon: 'vehicle',
      status,
      signature: `${v.type}:${v.tier}`,
      get sections() { return [sectionOf(t('inspector.section.details'), [liveRow(t('inspector.status'), 'status', status)])]; },
      actions: [
        { action: 'move_here', labelKey: 'inspector.action.move_here', icon: 'locate', variant: 'ghost' },
        { action: 'upgrade_vehicle', labelKey: 'inspector.action.upgrade_vehicle', icon: 'up', variant: 'ghost', disabled: !upgradable },
      ],
      sync: root => { setLive(root, 'status', status); },
    };
  },
};
