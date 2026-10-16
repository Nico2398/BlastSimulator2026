/** Section builders for the vehicle Inspector view (#1761). */
import { t } from '../../../core/i18n/I18n.js';
import { getVehicleDefByTier, getVehicleReservation, resolveVehicleDriver, vehicleFuelCostPerTick, type Vehicle } from '../../../core/entities/Vehicle.js';
import { computeVehicleJob, type VehicleJobTarget } from '../../../core/entities/VehicleStatus.js';
import { isVehicleUnderRepair, missingHp, repairPartsCost } from '../../../core/entities/VehicleRepair.js';
import { vehicleCargoByOre, vehicleCargoWarehouseId } from '../../../core/economy/VehicleCargo.js';
import { formatDollars, formatMoney } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import { el } from '../../dom.js';
import {
  buildingDisplayName, makeDriverBlock, makeHpGauge, makeLoadGauge, makeStatusChip, repairState, vehicleDisplayName,
} from '../../fleetDetailSections.js';
import { ACTION_LABEL_KEY } from '../../crewDetailSections.js';
import { buildBlockedOrderMessage } from '../../notify/NotificationCenter.js';
import type { InspectorLinks } from './InspectorContent.js';
import { entityLink, liveRow, sectionOf, valueRow } from './inspectorWidgets.js';

function tagged(node: HTMLElement, attr: string, value = ''): HTMLElement {
  node.setAttribute(attr, value);
  return node;
}

/** Status chip and HP current/max gauge. */
export function buildConditionSection(v: Vehicle, state: GameState): HTMLElement {
  const hp = makeHpGauge(v);
  const value = hp.querySelector('.bsx-gauge-value');
  if (value) {
    value.textContent = `${Math.round(v.hp)} / ${Math.round(getVehicleDefByTier(v.type, v.tier).maxHp)}`;
    value.setAttribute('data-live', 'hp');
  }
  hp.querySelector('.bsx-gauge-fill')?.setAttribute('data-live', 'hp-bar');
  const wrap = sectionOf(t('inspector.vehicle.condition'), [makeStatusChip(v, state.vehicles, resolveVehicleDriver(v, state.employees.employees)), hp]);
  return wrap;
}

/** Repair state; null while the vehicle is at full HP. */
export function buildRepairSection(v: Vehicle, state: GameState): HTMLElement | null {
  const { action, needsRepair } = repairState(v, state.pendingActions);
  if (!needsRepair) return null;
  const missing = missingHp(v);
  const status = isVehicleUnderRepair(state.pendingActions, v.id)
    ? t('inspector.vehicle.repair_active')
    : action ? t('inspector.vehicle.repair_queued') : t('inspector.vehicle.repair_none');
  const wrap = sectionOf(t('inspector.vehicle.repair'), [
    valueRow(t('inspector.status'), status),
    valueRow(t('inspector.vehicle.repair_missing'), t('inspector.vehicle.hp_value', { hp: Math.round(missing) })),
    valueRow(t('inspector.vehicle.repair_parts'), formatDollars(repairPartsCost(missing))),
  ]);
  return wrap;
}

function targetNode(target: VehicleJobTarget, state: GameState, links: InspectorLinks): HTMLElement {
  switch (target.kind) {
    case 'fragment': return entityLink(t('inspector.vehicle.target_fragment', { id: target.id }), 'fragment', target.id, links);
    case 'hole': return el('span', { text: t('inspector.vehicle.target_hole', { id: target.id }) });
    case 'building': {
      const b = state.buildings.buildings.find(x => x.id === target.id);
      return entityLink(b ? buildingDisplayName(b.type, b.tier) : `#${target.id}`, 'building', target.id, links);
    }
    case 'vehicle': {
      const other = state.vehicles.vehicles.find(x => x.id === target.id);
      return entityLink(other ? vehicleDisplayName(other.type, other.tier) : `#${target.id}`, 'vehicle', target.id, links);
    }
  }
}

/** Current job: task, target and destination links, live ETA, and why a queued order waits. */
export function buildJobSection(v: Vehicle, state: GameState, links: InspectorLinks): HTMLElement {
  const occupant = resolveVehicleDriver(v, state.employees.employees);
  const job = computeVehicleJob(v, state.vehicles, state.pendingActions, occupant, vehicleCargoWarehouseId(v, state.logistics.fragments));
  const rows: HTMLElement[] = [];
  rows.push(valueRow(t('inspector.vehicle.task'),
    job.actionType ? t(ACTION_LABEL_KEY[job.actionType]) : t('inspector.vehicle.job_none')));
  if (job.target) rows.push(valueRow(t('inspector.vehicle.target'), targetNode(job.target, state, links)));
  if (job.destination) {
    const { x, z, buildingId } = job.destination;
    const building = buildingId === null ? undefined : state.buildings.buildings.find(b => b.id === buildingId);
    rows.push(valueRow(t('inspector.vehicle.destination'), building
      ? entityLink(buildingDisplayName(building.type, building.tier), 'building', building.id, links)
      : t('inspector.vehicle.tile', { x: Math.round(x), z: Math.round(z) })));
  }
  if (job.etaTicks !== null) rows.push(liveRow(t('inspector.vehicle.eta'), 'eta', t('inspector.vehicle.eta_value', { n: Math.ceil(job.etaTicks) })));
  if (job.blockedReason !== null) {
    const order = state.pendingActions.find(a => a.id === job.blockedOrderId);
    rows.push(valueRow(t('inspector.vehicle.waiting'), order ? buildBlockedOrderMessage(order) : t('inspector.vehicle.job_none')));
  }
  const wrap = sectionOf(t('inspector.vehicle.job'), rows);
  return wrap;
}

/** Cargo of a hauler: load gauge, kg per ore, barren and fragment count; null for every other role. */
export function buildCargoSection(v: Vehicle, state: GameState): HTMLElement | null {
  const load = makeLoadGauge(v);
  if (!load) return null;
  const cargo = vehicleCargoByOre(v, state.logistics.fragments);
  const rows: HTMLElement[] = [load];
  for (const [oreId, kg] of Object.entries(cargo.byOre).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push(tagged(valueRow(t(`ore.${oreId}.name`), t('inspector.vehicle.kg', { kg: formatMoney(kg) })), 'data-cargo-ore', oreId));
  }
  if (cargo.totalKg > 0) {
    rows.push(tagged(valueRow(t('inspector.vehicle.barren'), t('inspector.vehicle.kg', { kg: formatMoney(cargo.barrenKg) })), 'data-cargo-barren'));
  }
  rows.push(valueRow(t('inspector.vehicle.fragments'), String(cargo.fragmentCount)));
  const wrap = sectionOf(t('inspector.vehicle.cargo'), rows);
  return wrap;
}

/** Driver row (name link, walking to board, unmanned, or no licensed driver with a Train button). */
export function buildDriverSection(v: Vehicle, state: GameState, links: InspectorLinks): HTMLElement {
  const rows = makeDriverBlock(v, state, {
    select: id => links.select('employee', id),
    onGoToCrew: () => links.navigate?.('crew'),
  });
  const wrap = sectionOf(t('inspector.vehicle.driver'), rows);
  return wrap;
}

/** Speed, capacity and work rate of this tier. */
export function buildSpecsSection(v: Vehicle): HTMLElement {
  const def = getVehicleDefByTier(v.type, v.tier);
  const rows = [
    valueRow(t('inspector.vehicle.speed'), t('inspector.vehicle.speed_value', { n: Math.round(def.speed * 100) / 100 })),
    ...(def.capacity > 0 ? [valueRow(t('inspector.vehicle.capacity'), t('inspector.vehicle.kg', { kg: formatMoney(def.capacity) }))] : []),
    valueRow(t('inspector.vehicle.work_rate'), String(Math.round(def.workRate * 100) / 100)),
  ];
  const wrap = sectionOf(t('inspector.vehicle.specs'), rows);
  return wrap;
}

/** Running cost $/h: maintenance always, fuel while the vehicle holds a reservation. */
export function buildCostSection(v: Vehicle, state: GameState): HTMLElement {
  const def = getVehicleDefByTier(v.type, v.tier);
  const fuel = vehicleFuelCostPerTick(state.vehicles, v);
  const rows = [valueRow(t('inspector.vehicle.maintenance'), t('inspector.upkeep_value', { cost: formatDollars(def.maintenanceCostPerTick) }))];
  if (getVehicleReservation(state.vehicles, v.id) !== null) {
    rows.push(valueRow(t('inspector.vehicle.fuel'), t('inspector.upkeep_value', { cost: formatDollars(fuel) })));
  }
  const wrap = sectionOf(t('inspector.vehicle.cost'), rows);
  return wrap;
}
