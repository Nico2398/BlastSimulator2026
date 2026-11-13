// BlastSimulator2026 — Contract outlook views (#2243)
// The top of the Contracts window: one line per material the active
// contracts want — what is in hand, what is due, how fast it comes in against
// how fast it is needed, and whether that is enough — and every deadline on
// one timeline. Pure presentation over core/economy/ContractForecast.ts.

import { t } from '../../core/i18n/I18n.js';
import { wholeKg } from '../../core/economy/formatMoney.js';
import { getOre } from '../../core/world/OreCatalog.js';
import type { Contract } from '../../core/economy/Contract.js';
import { RUBBLE_MATERIAL_ID } from '../../core/economy/OreCollectionLog.js';
import { contractHoursLeft, contractMaterialKey, type ContractOutlook, type MaterialOutlook } from '../../core/economy/ContractForecast.js';
import { el } from '../dom.js';
import { statusPill, windowSection, type Tone } from '../windowKit.js';

const OUTLOOK_TONE: Record<ContractOutlook, Tone> = { covered: 'positive', on_track: 'positive', at_risk: 'warn', will_miss: 'critical' };
const OUTLOOK_COLOR: Record<ContractOutlook, string> = {
  covered: 'var(--bsx-positive)', on_track: 'var(--bsx-positive)', at_risk: 'var(--bsx-amber)', will_miss: 'var(--bsx-critical)',
};
/** Barren rock has no ore colour; it reads as stone. */
const RUBBLE_COLOR = '#8a94a2';
/** Timeline axis: at least a day, labelled on the first step that keeps it to a handful of ticks. */
const TIMELINE_MIN_HOURS = 24;
const TIMELINE_STEPS_HOURS = [12, 24, 48, 96, 168, 336] as const;
const TIMELINE_MAX_TICKS = 8;
/** From this mass up, a figure reads in tonnes so it fits its cell. */
const TONNES_FROM_KG = 10_000;

/** A mass short enough for a table cell: kilograms, tonnes once it is large. */
function massText(kg: number): string {
  if (kg < TONNES_FROM_KG) return t('ui.outlook.kg', { kg: wholeKg(kg) });
  const tonnes = kg / 1000;
  return t('ui.outlook.tonnes', { t: (tonnes < 100 ? Math.round(tonnes * 10) / 10 : Math.round(tonnes)).toLocaleString('en-US') });
}

export function materialName(materialId: string): string {
  return materialId === RUBBLE_MATERIAL_ID ? t('ui.contracts.material_rubble') : t(getOre(materialId)?.nameKey ?? materialId);
}

function materialColor(materialId: string): string {
  return materialId === RUBBLE_MATERIAL_ID ? RUBBLE_COLOR : (getOre(materialId)?.color ?? RUBBLE_COLOR);
}

/** Kg per hour, one decimal below 10 so a slow trickle does not read as zero. */
export function rateText(kgPerHour: number): string {
  const v = kgPerHour < 10 ? Math.round(kgPerHour * 10) / 10 : Math.round(kgPerHour);
  return t('ui.outlook.rate', { kg: v.toLocaleString('en-US') });
}

/** The outlook as a coloured pill; `label` overrides the state's own wording (an offer reads "fits", not "on track"). */
export function outlookPill(outlook: ContractOutlook, explain?: string, label?: string): HTMLElement {
  const pill = statusPill(label ?? t(`ui.outlook.state_${outlook}`), OUTLOOK_TONE[outlook], explain);
  pill.classList.add('bs-contract-outlook');
  pill.dataset['outlook'] = outlook;
  return pill;
}

/** Supply against demand on one bar: stock, then in transit, then what the current pace brings by the last deadline; a tick marks the demand. */
function supplyBar(line: MaterialOutlook): HTMLElement {
  const color = materialColor(line.materialId);
  const gathered = line.rateKgPerHour * line.horizonHours;
  const supply = line.stockKg + line.inTransitKg + gathered;
  const scale = Math.max(1, line.demandKg, supply) * 1.06;
  const pct = (kg: number): string => `${(kg / scale) * 100}%`;
  const seg = (from: number, kg: number, background: string, cls: string): HTMLElement => {
    const s = el('span', { className: cls });
    s.style.left = pct(from);
    s.style.width = pct(kg);
    s.style.background = background;
    return s;
  };
  const bar = el('div', { className: 'bsx-outlook-supply', children: [
    seg(0, line.stockKg, color, 'bs-outlook-stock'),
    seg(line.stockKg, line.inTransitKg, `color-mix(in srgb, ${color} 60%, transparent)`, 'bs-outlook-transit'),
    seg(line.stockKg + line.inTransitKg, gathered, `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} 45%, transparent) 0 4px, transparent 4px 7px)`, 'bs-outlook-gathered'),
  ] });
  if (supply < line.demandKg) bar.appendChild(seg(supply, line.demandKg - supply, 'rgba(255,91,76,.28)', 'bs-outlook-shortfall'));
  const mark = el('span', { className: 'bsx-outlook-demand-mark' });
  mark.style.left = `calc(${pct(line.demandKg)} - 1px)`;
  bar.appendChild(mark);
  return bar;
}

function cell(big: string, small: string, bigColor?: string): HTMLElement {
  const b = el('span', { className: 'bsx-outlook-big', text: big });
  if (bigColor) b.style.color = bigColor;
  // The small line may still clip in a narrow window; its full text stays a hover away.
  return el('div', { className: 'bsx-outlook-cell', children: [b, el('span', { className: 'bsx-outlook-small', text: small, attrs: { title: small } })] });
}

/** Why a material reads the way it does, in numbers. */
export function lineExplain(line: MaterialOutlook): string {
  return t('ui.outlook.explain_line', {
    stock: wholeKg(line.stockKg), transit: wholeKg(line.inTransitKg), rate: rateText(line.rateKgPerHour),
    hours: Math.round(line.horizonHours), demand: wholeKg(line.demandKg),
  });
}

function outlookRow(line: MaterialOutlook): HTMLElement {
  const inHand = line.stockKg + line.inTransitKg;
  const pace = line.rateKgPerHour >= line.neededRateKgPerHour ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';
  const swatch = el('span', { className: 'bsx-outlook-swatch' });
  swatch.style.background = materialColor(line.materialId);
  const handNote = [
    line.inTransitKg > 0 ? t('ui.outlook.in_transit', { mass: massText(line.inTransitKg) }) : '',
    line.onGroundKg > 0 ? t('ui.outlook.on_ground', { mass: massText(line.onGroundKg) }) : '',
  ].filter(Boolean).join(' · ') || t('ui.outlook.in_storage');
  const next = line.contracts[0];
  const spare = line.spareKg >= 0
    ? t('ui.outlook.spare', { mass: massText(line.spareKg) })
    : t('ui.outlook.short', { mass: massText(-line.spareKg) });
  return el('div', {
    className: 'bsx-outlook-row',
    attrs: { 'data-outlook-material': line.materialId, 'data-outlook': line.outlook },
    children: [
      el('div', { className: 'bsx-outlook-cell', children: [
        el('span', { className: 'bsx-outlook-material', children: [swatch, el('span', { text: materialName(line.materialId) })] }),
        el('span', { className: 'bsx-outlook-small', text: t('ui.outlook.contracts', { count: line.contracts.length }) }),
      ] }),
      supplyBar(line),
      cell(massText(inHand), handNote),
      cell(massText(line.demandKg), next ? t('ui.outlook.next_due', { hours: Math.round(next.hoursLeft) }) : ''),
      cell(rateText(line.rateKgPerHour), line.neededRateKgPerHour > 0 ? t('ui.outlook.need_rate', { rate: rateText(line.neededRateKgPerHour) }) : t('ui.outlook.need_none'), line.neededRateKgPerHour > 0 ? pace : undefined),
      el('div', { className: 'bsx-outlook-cell', attrs: { style: 'align-items:flex-start' }, children: [
        outlookPill(line.outlook, lineExplain(line)),
        el('span', { className: 'bsx-outlook-small', text: spare, attrs: { style: `color:${line.spareKg >= 0 ? 'var(--bsx-text-micro)' : 'var(--bsx-critical-text)'}` } }),
      ] }),
    ],
  });
}

function legend(): HTMLElement {
  const item = (cls: string, text: string): HTMLElement => el('span', { children: [el('i', { className: cls }), document.createTextNode(text)] });
  const stock = item('bs-legend-stock', t('ui.outlook.legend_stock'));
  const transit = item('bs-legend-transit', t('ui.outlook.legend_transit'));
  const gathered = item('bs-legend-gathered', t('ui.outlook.legend_gathered'));
  const demand = item('bs-legend-demand', t('ui.outlook.legend_demand'));
  (stock.firstChild as HTMLElement).style.background = 'var(--bsx-text-secondary)';
  (transit.firstChild as HTMLElement).style.background = 'rgba(201,209,219,.55)';
  (gathered.firstChild as HTMLElement).style.background = 'repeating-linear-gradient(135deg, rgba(201,209,219,.5) 0 3px, transparent 3px 5px)';
  (demand.firstChild as HTMLElement).style.cssText = 'width:2px;height:11px;background:var(--bsx-text-primary)';
  return el('div', { className: 'bsx-outlook-legend', children: [stock, transit, gathered, demand] });
}

/**
 * The per-material overview. With nothing running it says so and points at
 * the offers, so the section never disappears from under the player.
 */
export function makeOutlookSection(lines: readonly MaterialOutlook[]): HTMLElement {
  const worst = lines.filter(l => l.outlook === 'will_miss' || l.outlook === 'at_risk').length;
  const head = el('div', { className: 'bsx-outlook-row bsx-outlook-head', children: [
    el('span', { text: t('ui.outlook.col_material') }), el('span', { text: t('ui.outlook.col_supply') }),
    el('span', { text: t('ui.outlook.col_in_hand') }), el('span', { text: t('ui.outlook.col_due') }),
    el('span', { text: t('ui.outlook.col_rate') }), el('span', { text: t('ui.outlook.col_outlook') }),
  ] });
  const body = lines.length === 0
    ? [el('div', { className: 'bsx-empty', text: t('ui.outlook.none') })]
    : [head, ...lines.map(outlookRow), legend()];
  const count = worst > 0 ? t('ui.outlook.at_risk_count', { count: worst }) : t('ui.outlook.all_on_track');
  return windowSection({
    title: t('ui.outlook.title'),
    ...(lines.length > 0 ? { count } : {}),
    note: t('ui.outlook.note'),
    className: 'bs-contract-outlook-section',
    children: [el('div', { className: 'bsx-outlook', children: body })],
  });
}

/** Every active contract's deadline on one axis, coloured by its outlook, filled by what is delivered. */
export function makeTimelineSection(active: readonly Contract[], tick: number, lines: readonly MaterialOutlook[]): HTMLElement | null {
  const running = active.filter(c => !c.completed && !c.expired);
  if (running.length === 0) return null;
  const outlookOf = new Map<number, ContractOutlook>();
  for (const line of lines) for (const f of line.contracts) outlookOf.set(f.contractId, f.outlook);
  const hours = (c: Contract): number => contractHoursLeft(c, tick);
  const ordered = [...running].sort((a, b) => hours(a) - hours(b) || a.id - b.id);
  const maxHours = Math.max(TIMELINE_MIN_HOURS, ...ordered.map(hours));
  const step = TIMELINE_STEPS_HOURS.find(s => maxHours / s <= TIMELINE_MAX_TICKS) ?? TIMELINE_STEPS_HOURS[TIMELINE_STEPS_HOURS.length - 1]!;
  const axisHours = Math.ceil(maxHours / step) * step;
  const rows = ordered.map(c => {
    const outlook = outlookOf.get(c.id) ?? 'covered';
    const bar = el('div', { className: 'bsx-timeline-bar' });
    bar.style.width = `${Math.max(1.5, (hours(c) / axisHours) * 100)}%`;
    bar.style.background = OUTLOOK_COLOR[outlook];
    const done = el('div', { className: 'bsx-timeline-done' });
    done.style.width = `${c.quantityKg > 0 ? Math.min(100, (c.deliveredKg / c.quantityKg) * 100) : 0}%`;
    bar.appendChild(done);
    return el('div', {
      className: 'bsx-timeline-row',
      attrs: { 'data-timeline-contract': String(c.id), 'data-outlook': outlook },
      children: [
        el('span', { className: 'bsx-timeline-label', text: t('ui.outlook.timeline_label', { material: materialName(contractMaterialKey(c)), id: c.id, kg: wholeKg(Math.max(0, c.quantityKg - c.deliveredKg)) }) }),
        el('div', { className: 'bsx-timeline-track', children: [bar] }),
        el('span', { className: 'bsx-timeline-hours', text: t('ui.outlook.hours_left', { hours: Math.round(hours(c)) }) }),
      ],
    });
  });
  const ticks = el('div', { className: 'bsx-timeline-ticks' });
  for (let h = 0; h <= axisHours; h += step) {
    const tickEl = el('span', { text: h === 0 ? t('ui.outlook.now') : `${h}h` });
    tickEl.style.left = `${(h / axisHours) * 100}%`;
    ticks.appendChild(tickEl);
  }
  const axis = el('div', { className: 'bsx-timeline-axis', children: [el('span'), ticks, el('span')] });
  return windowSection({
    title: t('ui.outlook.timeline_title'),
    note: t('ui.outlook.timeline_note'),
    className: 'bs-contract-timeline',
    children: [el('div', { className: 'bsx-timeline', children: [...rows, axis] })],
  });
}

/** What the two sections show, rounded so a value drifting by a gram does not rebuild them. */
export function outlookSignature(lines: readonly MaterialOutlook[], active: readonly Contract[], tick: number): string {
  const l = lines.map(x => [x.materialId, Math.round(x.stockKg), Math.round(x.inTransitKg), Math.round(x.onGroundKg), Math.round(x.demandKg),
    Math.round(x.rateKgPerHour * 10), Math.round(x.neededRateKgPerHour * 10), x.outlook, x.contracts.map(c => `${c.contractId}:${c.outlook}`).join(',')].join(':'));
  const a = active.map(c => `${c.id}:${Math.round(contractHoursLeft(c, tick))}:${Math.round(c.deliveredKg)}`);
  return `${l.join('|')}#${a.join('|')}`;
}
