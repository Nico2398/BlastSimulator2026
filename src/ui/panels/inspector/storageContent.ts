/** Inspector storage section for warehouse buildings (#1757). */
import { t } from '../../../core/i18n/I18n.js';
import { warehouseUsedKgMap, warehouseStockByOre } from '../../../core/economy/FreightWarehouses.js';
import { getBuildingDef, warehouseFreeKg, warehouseStockKg, type Building } from '../../../core/entities/Building.js';
import { secondaryBlastRadiusM } from '../../../core/entities/SecondaryBlast.js';
import type { GameState } from '../../../core/state/GameState.js';
import { getOre } from '../../../core/world/OreCatalog.js';
import { el } from '../../dom.js';
import { liveRow, liveValue, sectionOf, setLive } from './inspectorWidgets.js';

/** Rows at or below this mass are noise and stay hidden. */
const MIN_ROW_KG = 0.5;

/** A storage section plus its live-sync hook. */
export interface StorageContents {
  readonly section: HTMLElement;
  /** Names the row set: when it changes the section must be rebuilt, not synced in place. */
  readonly rowSignature: string;
  readonly sync: (root: HTMLElement) => void;
}

interface Row { key: string; label: string; text: string }

interface Model {
  rows: Row[];
  gauge: { text: string; fraction: number; aria: string } | null;
  /** Plain text lines rewritten in place (`data-live` = key). */
  lines: { key: string; text: string }[];
  note: string | null;
  stockAttrs: { stockKg: number; freeKg: number } | null;
  stockText: string;
}

const kgText = (kg: number): string => `${Math.round(kg).toLocaleString('en-US')} kg`;

const byKgDesc = (a: [string, number], b: [string, number]): number => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);

function gaugeOf(stored: number, capacity: number): NonNullable<Model['gauge']> {
  const params = { stored: Math.round(stored).toLocaleString('en-US'), capacity: Math.round(capacity).toLocaleString('en-US') };
  return {
    text: t('inspector.stock_capacity', params),
    fraction: capacity > 0 ? Math.min(1, Math.max(0, stored / capacity)) : 0,
    aria: t('inspector.stock_gauge_aria', params),
  };
}

function explosiveModel(b: Building, closed: boolean): Model {
  const stock = Object.entries(b.storedExplosives ?? {}).filter(([, kg]) => kg > MIN_ROW_KG);
  const stockKg = Math.round(warehouseStockKg(b));
  const freeKg = Math.round(warehouseFreeKg(b));
  const total = warehouseStockKg(b);
  return {
    rows: closed ? [] : stock.sort(([a], [c]) => (a < c ? -1 : 1))
      .map(([id, kg]) => ({ key: `stock-row-${id}`, label: t(`explosive.${id}.name`), text: kgText(kg) })),
    gauge: gaugeOf(total, getBuildingDef(b.type, b.tier).capacity),
    lines: !closed && total > MIN_ROW_KG
      ? [{ key: 'radius', text: t('inspector.detonation_radius', { radius: Math.round(secondaryBlastRadiusM(total)) }) }] : [],
    note: closed ? t('inspector.stock_unavailable') : null,
    stockAttrs: { stockKg, freeKg },
    stockText: t('inspector.warehouse_stock', { stock: stockKg, free: freeKg }),
  };
}

function oreLabel(oreId: string): string {
  const ore = getOre(oreId);
  return ore ? t(ore.nameKey) : oreId;
}

function freightModel(b: Building, state: GameState): Model {
  const { storedKg, oreKg, barrenKg } = warehouseStockByOre(state.logistics, b.id);
  const capacity = getBuildingDef(b.type, b.tier).capacity;
  const reservedKg = Math.max(0, (warehouseUsedKgMap(state.logistics).get(b.id) ?? 0) - storedKg);
  const rows: Row[] = [];
  if (reservedKg > MIN_ROW_KG) rows.push({ key: 'reserved', label: t('inspector.reserved_in_transit'), text: kgText(reservedKg) });
  for (const [id, kg] of Object.entries(oreKg).filter(([, kg]) => kg > MIN_ROW_KG).sort(byKgDesc)) {
    rows.push({ key: `ore-row-${id}`, label: oreLabel(id), text: kgText(kg) });
  }
  if (barrenKg > MIN_ROW_KG) rows.push({ key: 'barren', label: t('inspector.barren'), text: kgText(barrenKg) });
  return {
    rows,
    gauge: gaugeOf(storedKg, capacity),
    lines: [{ key: 'free', text: t('inspector.free_kg', { kg: kgText(Math.max(0, capacity - storedKg - reservedKg)) }) }],
    note: storedKg > MIN_ROW_KG ? null : t('inspector.stock_empty'),
    stockAttrs: null,
    stockText: '',
  };
}

function spoilModel(b: Building): Model {
  return {
    rows: [{ key: 'spoil', label: t('inspector.spoil'), text: kgText(b.storedSpoilKg ?? 0) }],
    gauge: null,
    lines: [],
    note: t('inspector.spoil_no_cap'),
    stockAttrs: null,
    stockText: '',
  };
}

function modelOf(b: Building, state: GameState, closed: boolean): Model | null {
  switch (b.type) {
    case 'explosive_warehouse': return explosiveModel(b, closed);
    case 'freight_warehouse': return freightModel(b, state);
    case 'spoil_heap': return spoilModel(b);
    default: return null;
  }
}

function buildSection(m: Model): HTMLElement {
  const rows: HTMLElement[] = [];
  if (m.stockAttrs) {
    const row = liveRow(t('inspector.stock'), 'stock', m.stockText);
    const value = liveValue(row);
    value.dataset['info'] = 'warehouse-stock';
    value.dataset['stockKg'] = String(m.stockAttrs.stockKg);
    value.dataset['freeKg'] = String(m.stockAttrs.freeKg);
    rows.push(row);
  }
  if (m.gauge) {
    const row = liveRow(t('inspector.stock'), 'gauge', m.gauge.text);
    const bar = el('div');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', m.gauge.aria);
    bar.style.cssText = 'height:4px;border-radius:2px;background:var(--bsx-well)';
    const fill = el('div');
    fill.dataset['live'] = 'gauge-bar';
    fill.style.cssText = `height:100%;border-radius:2px;background:var(--bsx-positive);width:${Math.round(m.gauge.fraction * 100)}%`;
    bar.append(fill);
    rows.push(row, bar);
  }
  for (const r of m.rows) rows.push(liveRow(r.label, r.key, r.text));
  for (const l of m.lines) {
    const line = el('div', { text: l.text, className: 'bsx-mono' });
    line.style.fontSize = '11px';
    line.dataset['live'] = l.key;
    rows.push(line);
  }
  if (m.note !== null) rows.push(el('div', { text: m.note }));
  return sectionOf(t('inspector.section.contents'), rows);
}

/** Storage section for a building, or null when the building stores nothing. */
export function storageContents(b: Building, state: GameState, closed: boolean): StorageContents | null {
  const m = modelOf(b, state, closed);
  if (!m) return null;
  return {
    section: buildSection(m),
    rowSignature: [...m.rows.map(r => r.key), ...m.lines.map(l => l.key), m.note !== null ? 'note' : ''].join(','),
    sync(root) {
      if (m.stockAttrs) {
        const node = setLive(root, 'stock', m.stockText);
        if (node) { node.dataset['stockKg'] = String(m.stockAttrs.stockKg); node.dataset['freeKg'] = String(m.stockAttrs.freeKg); }
      }
      if (m.gauge) {
        setLive(root, 'gauge', m.gauge.text);
        const fill = root.querySelector<HTMLElement>('[data-live="gauge-bar"]');
        if (fill) fill.style.width = `${Math.round(m.gauge.fraction * 100)}%`;
      }
      for (const r of m.rows) setLive(root, r.key, r.text);
      for (const l of m.lines) setLive(root, l.key, l.text);
    },
  };
}
