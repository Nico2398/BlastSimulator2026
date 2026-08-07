// BlastSimulator2026 — Shared DOM factory helpers (redesign P0)
//
// Small, typed builders for the recurring pieces of every new panel: buttons
// in the eight-state inventory, chips, gauges with a threshold tick,
// progress bars, steppers, section headers, cards, and empty states. Plain
// functions returning HTMLElement — no framework, matches the rest of
// src/ui/. Panels compose these instead of hand-rolling inline styles.

import { iconEl, type IconName } from './icons.js';

export interface ElOptions {
  className?: string | string[];
  text?: string;
  attrs?: Record<string, string>;
  children?: (Node | null | undefined)[];
}

/** Generic element factory: tag + class(es) + text + attrs + children, in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) {
    node.className = Array.isArray(opts.className) ? opts.className.join(' ') : opts.className;
  }
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.children) {
    for (const child of opts.children) if (child) node.appendChild(child);
  }
  return node;
}

export type ButtonVariant = 'ghost' | 'primary' | 'danger' | 'danger-solid' | 'locked' | 'warn';

export interface ButtonOptions {
  icon?: IconName;
  iconSize?: number;
  sub?: string;
  disabled?: boolean;
  title?: string;
  dataAction?: string;
  onClick?: () => void;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  ghost: 'bsx-btn',
  primary: 'bsx-btn bsx-btn-primary',
  danger: 'bsx-btn bsx-btn-danger',
  'danger-solid': 'bsx-btn bsx-btn-danger-solid',
  locked: 'bsx-btn bsx-btn-locked',
  warn: 'bsx-btn bsx-btn-warn',
};

/** Button covering the design's 8-state inventory (default/hover/active are CSS; disabled/locked/warn/danger are variants). */
export function button(variant: ButtonVariant, label: string, opts: ButtonOptions = {}): HTMLButtonElement {
  const btn = el('button', { className: VARIANT_CLASS[variant] });
  if (opts.icon) btn.appendChild(iconEl(opts.icon, opts.iconSize ?? 12));
  const labelSpan = el('span', { text: label });
  btn.appendChild(labelSpan);
  if (opts.sub) {
    btn.appendChild(el('span', {
      text: opts.sub,
      attrs: { style: 'margin-left:auto;font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' },
    }));
  }
  if (opts.disabled) btn.disabled = true;
  if (opts.title) btn.title = opts.title;
  if (opts.dataAction) btn.dataset['action'] = opts.dataAction;
  if (opts.onClick) btn.addEventListener('click', opts.onClick);
  return btn;
}

/** Reason line shown under a disabled/warned control (design tone: name the fix, not the rule). */
export function reasonLine(text: string, critical = false): HTMLElement {
  const wrap = el('div', { className: critical ? 'bsx-reason critical' : 'bsx-reason' });
  wrap.appendChild(iconEl('warn', 11));
  wrap.appendChild(el('span', { text }));
  return wrap;
}

export type ChipTone = 'neutral' | 'positive' | 'critical' | 'warn' | 'info' | 'ore' | 'locked';

/** Status chip (IN ZONE, TUBED, WET, STUCK, UNION, …). */
export function chip(label: string, tone: ChipTone = 'neutral'): HTMLElement {
  return el('span', { className: `bsx-chip bsx-chip-${tone}`, text: label });
}

/** Section header: micro-label + hairline rule, optional trailing note. */
export function sectionHeader(label: string, note?: string): HTMLElement {
  const wrap = el('div', { className: 'bsx-section' });
  wrap.appendChild(el('span', { className: 'bsx-section-label', text: label }));
  wrap.appendChild(el('span', { className: 'bsx-section-rule' }));
  if (note) wrap.appendChild(el('span', { className: 'bsx-section-note', text: note }));
  return wrap;
}

/** Gauge row: label, track+fill, optional threshold tick, numeric readout. */
export function gauge(label: string, value: number, color: string, opts: { thresholdPct?: number; labelWidth?: number } = {}): HTMLElement {
  const row = el('div', { className: 'bsx-gauge-row' });
  const labelEl = el('span', { className: 'bsx-gauge-label', text: label });
  if (opts.labelWidth) labelEl.style.width = `${opts.labelWidth}px`;
  const track = el('div', { className: 'bsx-gauge-track' });
  const fill = el('div', { className: 'bsx-gauge-fill' });
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  fill.style.background = color;
  track.appendChild(fill);
  if (opts.thresholdPct !== undefined) {
    const tick = el('div', { className: 'bsx-gauge-tick' });
    tick.style.left = `${opts.thresholdPct}%`;
    track.appendChild(tick);
  }
  const valueEl = el('span', { className: 'bsx-gauge-value bsx-mono', text: String(Math.round(value)) });
  valueEl.style.color = color;
  row.append(labelEl, track, valueEl);
  return row;
}

/** Progress bar (contract urgency, research progress). */
export function progressBar(pct: number, color: string): HTMLElement {
  const track = el('div', { className: 'bsx-progress' });
  const fill = el('div', { className: 'bsx-progress-fill' });
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  fill.style.background = color;
  track.appendChild(fill);
  return track;
}

/** Stepper: -/value/+ control. Caller owns the value; onDec/onInc mutate and re-render. */
export function stepper(displayValue: string, onDec: () => void, onInc: () => void): HTMLElement {
  const wrap = el('div', { className: 'bsx-stepper' });
  const dec = el('button', { className: 'bsx-stepper-btn' });
  dec.appendChild(iconEl('minus', 9));
  dec.addEventListener('click', onDec);
  const value = el('span', { className: 'bsx-stepper-value', text: displayValue });
  const inc = el('button', { className: 'bsx-stepper-btn' });
  inc.appendChild(iconEl('plus', 9));
  inc.addEventListener('click', onInc);
  wrap.append(dec, value, inc);
  return wrap;
}

/** Card: bordered container with a vertical gap, matching design cards. */
export function card(children: (Node | null | undefined)[], extraClass?: string): HTMLElement {
  return el('div', { className: extraClass ? `bsx-card ${extraClass}` : 'bsx-card', children });
}

/** Empty-state block: never "No data" — copy is the caller's job, this just carries the tone. */
export function emptyState(text: string): HTMLElement {
  return el('div', { className: 'bsx-empty', text });
}

/**
 * Paint a toggle button's active/inactive visual state: amber border+text+wash
 * when active, muted/transparent when not. Shared by every hand-rolled
 * toggle button that isn't built through `button()` (MiniMap layer toggle,
 * ToolRail panel selection, SurveyPanel overlay toggle).
 */
export function paintToggleButton(btn: HTMLElement, active: boolean, inactiveBorderColor = 'transparent'): void {
  btn.style.borderColor = active ? 'var(--bsx-amber)' : inactiveBorderColor;
  btn.style.color = active ? 'var(--bsx-amber)' : 'var(--bsx-text-muted)';
  btn.style.background = active ? 'rgba(255,176,46,.12)' : 'transparent';
}

/** Stat grid (blast report, pre-flight): N equal columns, each a key/value cell. */
export function statGrid(items: { key: string; value: string; color?: string }[], columns: number): HTMLElement {
  const grid = el('div', { className: 'bsx-stat-grid' });
  grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  for (const item of items) {
    const cell = el('div', { className: 'bsx-stat-cell' });
    cell.appendChild(el('span', { className: 'bsx-stat-key', text: item.key }));
    const valueEl = el('span', { className: 'bsx-stat-value', text: item.value });
    if (item.color) valueEl.style.color = item.color;
    cell.appendChild(valueEl);
    grid.appendChild(cell);
  }
  return grid;
}
