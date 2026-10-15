/** Inspector storage section for warehouse buildings (#1757). */
import { t } from '../../../core/i18n/I18n.js';
import { warehouseReservedKg, warehouseStockByOre } from '../../../core/economy/FreightWarehouses.js';
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
  /** Hook data carried by the gauge value (`data-info="warehouse-stock"`). */
  stockAttrs: { stockKg: number; freeKg: number } | null;
}

const kgNumber = (kg: number): string => Math.round(kg).toLocaleString('en-US');

const kgText = (kg: number): string => `${kgNumber(kg)} kg`;

const byKgDesc = (a: [string, number], b: [string, number]): number => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);

function gaugeOf(stored: number, capacity: number): NonNullable<Model['gauge']> {
  const params = { stored: kgNumber(stored), capacity: kgNumber(capacity) };
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
    lines: [
      { key: 'free', text: t('inspector.free_kg', { kg: kgText(freeKg) }) },
      ...(!closed && total > MIN_ROW_KG
        ? [{ key: 'radius', text: t('inspector.detonation_radius', { radius: Math.round(secondaryBlastRadiusM(total)) }) }] : []),
    ],
    note: closed ? t('inspector.stock_unavailable') : null,
    stockAttrs: { stockKg, freeKg },
  };
}

function oreLabel(oreId: string): string {
  const ore = getOre(oreId);
  return ore ? t(ore.nameKey) : oreId;
}

function freightModel(b: Building, state: GameState): Model {
  const { storedKg, oreKg, barrenKg } = warehouseStockByOre(state.logistics, b.id);
  const capacity = getBuildingDef(b.type, b.tier).capacity;
  const reservedKg = warehouseReservedKg(state.logistics, b.id);
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
  };
}

function spoilModel(b: Building): Model {
  return {
    rows: [{ key: 'spoil', label: t('inspector.spoil'), text: kgText(b.storedSpoilKg ?? 0) }],
    gauge: null,
    lines: [],
    note: t('inspector.spoil_no_cap'),
    stockAttrs: null,
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

function lineOf(key: string, text: string): HTMLElement {
  const line = el('div', { text, className: 'bsx-mono' });
  line.style.fontSize = '11px';
  line.dataset['live'] = key;
  return line;
}

function noteOf(text: string): HTMLElement {
  const note = el('div', { text });
  note.dataset['live'] = 'note';
  return note;
}

function applyStockAttrs(node: HTMLElement, a: { stockKg: number; freeKg: number }): void {
  node.dataset['info'] = 'warehouse-stock';
  node.dataset['stockKg'] = String(a.stockKg);
  node.dataset['freeKg'] = String(a.freeKg);
}

function buildSection(m: Model): HTMLElement {
  const rows: HTMLElement[] = [];
  if (m.gauge) {
    const row = liveRow(t('inspector.stock'), 'gauge', m.gauge.text);
    if (m.stockAttrs) applyStockAttrs(liveValue(row), m.stockAttrs);
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
  for (const l of m.lines) rows.push(lineOf(l.key, l.text));
  if (m.note !== null) rows.push(noteOf(m.note));
  return sectionOf(t('inspector.section.contents'), rows);
}

/** The element holding a live key: the parent row for a value span, else the node itself. */
function entryOf(root: HTMLElement, key: string): HTMLElement | null {
  const node = root.querySelector<HTMLElement>(`[data-live="${key}"]`);
  return node && node.tagName === 'SPAN' ? node.parentElement : node;
}

/**
 * Bring the tracked entries (rows, lines, note) of `root` in line with `wanted`: rewrite text in
 * place, drop vanished entries, add new ones before the first entry that follows them in order.

 * Add/remove stay in place because the row set can change between a view and the panel noticing
 * the new `rowSignature`; sync must keep the DOM correct until the rebuild.
 */
function reconcile(root: HTMLElement, container: HTMLElement, shown: Set<string>, wanted: { key: string; text: string; make: () => HTMLElement }[]): void {
  const wantedKeys = new Set(wanted.map(w => w.key));
  for (const key of shown) {
    if (wantedKeys.has(key)) continue;
    entryOf(root, key)?.remove();
    shown.delete(key);
  }
  for (const w of wanted) {
    if (setLive(root, w.key, w.text)) continue;
    const made = w.make();
    const after = wanted.slice(wanted.indexOf(w) + 1).find(n => shown.has(n.key));
    const anchorEl = after ? entryOf(root, after.key) : null;
    if (anchorEl) anchorEl.before(made);
    else container.append(made);
    shown.add(w.key);
  }
}

/** Storage section for a building, or null when the building stores nothing. */
export function storageContents(b: Building, state: GameState, closed: boolean): StorageContents | null {
  const m = modelOf(b, state, closed);
  if (!m) return null;
  const shown = new Set<string>([...m.rows.map(r => r.key), ...m.lines.map(l => l.key), ...(m.note !== null ? ['note'] : [])]);
  const section = buildSection(m);
  return {
    section,
    rowSignature: [...m.rows.map(r => r.key), ...m.lines.map(l => l.key), m.note !== null ? 'note' : ''].join(','),
    sync(root) {
      const cur = modelOf(b, state, closed);
      if (!cur) return;
      if (cur.gauge) {
        const node = setLive(root, 'gauge', cur.gauge.text);
        if (node && cur.stockAttrs) applyStockAttrs(node, cur.stockAttrs);
        const fill = root.querySelector<HTMLElement>('[data-live="gauge-bar"]');
        if (fill) fill.style.width = `${Math.round(cur.gauge.fraction * 100)}%`;
      }
      reconcile(root, section, shown, [
        ...cur.rows.map(r => ({ key: r.key, text: r.text, make: () => liveRow(r.label, r.key, r.text) })),
        ...cur.lines.map(l => ({ key: l.key, text: l.text, make: () => lineOf(l.key, l.text) })),
        ...(cur.note !== null ? [{ key: 'note', text: cur.note, make: () => noteOf(cur.note as string) }] : []),
      ]);
    },
  };
}
