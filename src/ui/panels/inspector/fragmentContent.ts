/** Inspector content for fragment selections (#1769). */
import { t } from '../../../core/i18n/I18n.js';
import { fragmentOreKg } from '../../../core/economy/FragmentOre.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { isBarrenFragment } from '../../../core/economy/SpoilHeaps.js';
import type { TrackedFragment } from '../../../core/economy/Logistics.js';
import type { GameState } from '../../../core/state/GameState.js';
import { buildingDisplayName, vehicleDisplayName } from '../../fleetDetailSections.js';
import { el } from '../../dom.js';
import type { InspectorLinks, KindContent } from './InspectorContent.js';
import { entityLink, kindLabel, sectionOf, syncSection, valueRow } from './inspectorWidgets.js';

/** Ore rows below this mass are noise. */
const MIN_ORE_ROW_KG = 0.5;

function kgText(kg: number): string {
  return t('inspector.vehicle.kg', { kg: formatMoney(kg) });
}

function tagged(node: HTMLElement, attr: string, value = ''): HTMLElement {
  node.setAttribute(attr, value);
  return node;
}

/** Localized rock name, the raw id when the catalog has no entry. */
function rockName(rockId: string): string {
  const key = `rock.${rockId}.name`;
  const name = t(key);
  return name === key ? rockId : name;
}

function buildRockSection(tracked: TrackedFragment): HTMLElement {
  const f = tracked.fragment;
  const { byOre } = fragmentOreKg(f);
  const rows: HTMLElement[] = [
    valueRow(t('inspector.fragment.mass'), kgText(f.mass)),
    valueRow(t('inspector.fragment.rock'), rockName(f.rockId)),
  ];
  const ores = Object.entries(byOre).filter(([, kg]) => kg >= MIN_ORE_ROW_KG).sort(([, a], [, b]) => b - a);
  for (const [oreId, kg] of ores) {
    rows.push(tagged(valueRow(t(`ore.${oreId}.name`), kgText(kg)), 'data-fragment-ore', oreId));
  }
  if (isBarrenFragment(f.oreDensities)) {
    rows.push(tagged(el('div', { text: t('inspector.fragment.barren'), className: 'bsx-mono' }), 'data-fragment-barren'));
  }
  const section = sectionOf(t('inspector.fragment.section.rock'), rows);
  section.classList.add('bs-fragment-rock');
  return section;
}

function buildingLink(buildingId: number, state: GameState, links: InspectorLinks): HTMLElement | string {
  const b = state.buildings.buildings.find(x => x.id === buildingId);
  return b ? entityLink(buildingDisplayName(b.type, b.tier), 'building', b.id, links) : `#${buildingId}`;
}

function vehicleNode(vehicleId: string | null, state: GameState, links: InspectorLinks): HTMLElement | string {
  const v = state.vehicles.vehicles.find(x => String(x.id) === vehicleId);
  return v ? entityLink(vehicleDisplayName(v.type, v.tier), 'vehicle', v.id, links) : (vehicleId ?? '');
}

function buildLocationSection(tracked: TrackedFragment, state: GameState, links: InspectorLinks): HTMLElement {
  const rows: HTMLElement[] = [];
  switch (tracked.state) {
    case 'on_ground':
      rows.push(el('div', { text: t('inspector.fragment.on_ground'), className: 'bsx-mono' }));
      break;
    case 'in_transit':
      rows.push(valueRow(t('inspector.fragment.in_transit'), vehicleNode(tracked.vehicleId, state, links)));
      if (tracked.warehouseId !== null && state.buildings.buildings.some(b => b.id === tracked.warehouseId)) {
        rows.push(valueRow(t('inspector.fragment.bound_for'), buildingLink(tracked.warehouseId, state, links)));
      }
      break;
    case 'stored':
      rows.push(valueRow(t('inspector.fragment.stored'),
        tracked.warehouseId === null ? '' : buildingLink(tracked.warehouseId, state, links)));
      break;
  }
  const section = sectionOf(t('inspector.fragment.section.location'), rows);
  section.classList.add('bs-fragment-location');
  return section;
}

function locationText(tracked: TrackedFragment): string {
  return t(`inspector.fragment.${tracked.state}`);
}

export const fragmentContent: KindContent = {
  view(entity, state, links) {
    const tracked = state.logistics.fragments.find(x => x.fragment.id === entity.id);
    if (!tracked) return null;
    const sections = (): Array<[string, () => HTMLElement]> => {
      const current = state.logistics.fragments.find(x => x.fragment.id === entity.id) ?? tracked;
      return [
        ['bs-fragment-rock', () => buildRockSection(current)],
        ['bs-fragment-location', () => buildLocationSection(current, state, links)],
      ];
    };
    return {
      title: t('shell.hovertag.fragment', { id: entity.id }),
      sub: `#${entity.id} · ${kindLabel('fragment')}`,
      icon: 'rock',
      status: locationText(tracked),
      signature: `${tracked.state}:${tracked.vehicleId ?? ''}:${tracked.warehouseId ?? ''}`,
      get sections() {
        const body = el('div', { className: 'bs-fragment-detail' });
        body.style.cssText = 'display:flex;flex-direction:column;gap:11px';
        for (const [, make] of sections()) body.append(make());
        return [body];
      },
      actions: [],
      sync: root => {
        const body = root.querySelector<HTMLElement>('.bs-fragment-detail');
        if (!body) return;
        for (const [className, make] of sections()) syncSection(body, className, make);
      },
    };
  },
};
