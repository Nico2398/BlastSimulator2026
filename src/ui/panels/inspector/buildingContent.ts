/** Inspector content for building selections (#1756). */
import { t } from '../../../core/i18n/I18n.js';
import { getBuildingPeopleCapacity, warehouseStockKg, warehouseFreeKg } from '../../../core/entities/Building.js';
import { el } from '../../dom.js';
import type { ActionSpec, KindContent } from './InspectorContent.js';
import { entityLink, kindLabel, liveRow, sectionOf, setLive } from './inspectorWidgets.js';

function buildingActions(disabled: boolean): ActionSpec[] {
  return [
    { action: 'upgrade', labelKey: 'inspector.action.upgrade', icon: 'up', variant: 'ghost', disabled },
    { action: 'move', labelKey: 'inspector.action.move', icon: 'drive', variant: 'ghost', disabled },
    { action: 'demolish', labelKey: 'inspector.action.demolish', icon: 'trash', variant: 'danger', disabled },
  ];
}

export const buildingContent: KindContent = {
  view(entity, state, links) {
    const b = state.buildings.buildings.find(x => x.id === entity.id);
    // An upgrade in progress keeps its id on the reserved site while the old building is gone (#1392).
    const site = b ? undefined : state.plannedBuildings.find(pb => pb.buildingId === entity.id);
    if (site) {
      return {
        title: t(`building.${site.type}.t${site.tier}.name`),
        sub: `#${site.buildingId} · ${kindLabel('building')} · ${t('inspector.rebuilding')}`,
        icon: 'build',
        status: t('inspector.rebuilding'),
        signature: `site:${site.type}:${site.tier}`,
        sections: [],
        actions: buildingActions(true),
        sync: () => {},
      };
    }
    if (!b) return null;

    const hp = String(Math.round(b.hp));
    const capacity = getBuildingPeopleCapacity(b.type, b.tier);
    const isExplosiveWarehouse = b.type === 'explosive_warehouse';
    const stockKg = isExplosiveWarehouse ? Math.round(warehouseStockKg(b)) : 0;
    const freeKg = isExplosiveWarehouse ? Math.round(warehouseFreeKg(b)) : 0;
    const stockText = t('inspector.warehouse_stock', { stock: stockKg, free: freeKg });
    const occupants = b.occupantIds
      .map(id => ({ id, name: state.employees.employees.find(e => e.id === id)?.name }))
      .filter((o): o is { id: number; name: string } => o.name !== undefined);

    return {
      title: t(`building.${b.type}.t${b.tier}.name`),
      sub: `#${b.id} · ${kindLabel('building')} · ${t('inspector.tier', { tier: b.tier })}`,
      icon: 'build',
      status: t('inspector.operating'),
      signature: `${b.type}:${b.tier}:${capacity}:${b.occupantIds.join(',')}:${occupants.map(o => o.name).join('|')}`,
      get sections() {
        const rows: HTMLElement[] = [liveRow(t('inspector.hp'), 'hp', hp)];
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
        if (isExplosiveWarehouse) {
          const row = liveRow(t('inspector.stock'), 'stock', stockText);
          const value = row.querySelector<HTMLElement>('[data-live="stock"]')!;
          value.dataset['info'] = 'warehouse-stock';
          value.dataset['stockKg'] = String(stockKg);
          value.dataset['freeKg'] = String(freeKg);
          rows.push(row);
        }
        return [sectionOf(t('inspector.section.details'), rows)];
      },
      actions: buildingActions(false),
      sync(root) {
        setLive(root, 'hp', hp);
        setLive(root, 'occupancy', t('building.occupancy', { inside: b.occupantIds.length, capacity }));
        const stock = setLive(root, 'stock', stockText);
        if (stock) { stock.dataset['stockKg'] = String(stockKg); stock.dataset['freeKg'] = String(freeKg); }
      },
    };
  },
};
