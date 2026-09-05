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
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
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

export interface ScrollBoundedSectionOptions {
  /** Vertical gap between children, in px. Default 8, matching ChargeHoleList/Sequence. */
  gap?: number;
  /** Extra hook class, e.g. for a stable selector. */
  className?: string;
}

/**
 * A bounded, independently-scrollable section for content whose length is
 * unbounded (Work Queue, Incidents), so it never pushes fixed-height
 * siblings arbitrarily far down a panel's body.
 */
export function scrollBoundedSection(
  children: (Node | null | undefined)[],
  maxHeightPx: number,
  opts?: ScrollBoundedSectionOptions,
): HTMLElement {
  const section = el('div', { children });
  if (opts?.className) section.className = opts.className;
  section.style.cssText = [
    'overflow-y:auto', `max-height:${maxHeightPx}px`, 'flex-shrink:0',
    'display:flex', 'flex-direction:column', `gap:${opts?.gap ?? 8}px`,
  ].join(';');
  return section;
}

// ── Panel chrome ──
//
// Every slide-out panel (Build, Blast, Contracts, Crew, Finances, Fleet,
// Operations, Shady, Survey) wears the same shell: a 372px rounded card, a
// 46px header carrying an accent-tinted icon chip, a title and trailing icon
// buttons, and a scrolling body. Only the id, the icon, the accent and the
// body's gap differ, so the shell is built here and the panels supply those.

/** Accent tint of a panel's header icon chip. */
type PanelAccent = 'amber' | 'info' | 'critical' | 'ore';

const PANEL_ACCENT: Record<PanelAccent, string> = {
  amber: 'background:rgba(255,176,46,.14);color:var(--bsx-amber)',
  info: 'background:rgba(85,168,255,.14);color:var(--bsx-info)',
  critical: 'background:rgba(255,91,76,.14);color:var(--bsx-critical-text)',
  ore: 'background:rgba(169,140,255,.14);color:var(--bsx-ore)',
};

const TRAILING_BTN_STYLE =
  'width:28px;height:28px;display:flex;align-items:center;justify-content:center;'
  + 'border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;'
  + 'color:var(--bsx-text-muted);cursor:pointer';

/**
 * A panel's root element: the rounded card itself, hidden until `show()`.
 * `display` is set on its own line rather than inside the cssText string —
 * jsdom's parser drops a declaration that shares cssText with a `var(...)`
 * value (see SelectionBar.ts).
 */
export function panelRoot(id: string): HTMLElement {
  const root = el('div', { className: 'bsx-root', attrs: { id } });
  root.style.cssText = [
    'flex-direction:column', 'width:372px', 'max-height:100%',
    'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
    'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
  ].join(';');
  root.style.display = 'none';
  return root;
}

/** A 28×28 icon button for a panel header's trailing controls. */
export function panelHeaderButton(icon: IconName, onClick?: () => void): HTMLButtonElement {
  const btn = el('button', { children: [iconEl(icon, 12)] });
  btn.style.cssText = TRAILING_BTN_STYLE;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

interface PanelHeaderOptions {
  icon: IconName;
  accent: PanelAccent;
  /**
   * Wrap the title in a flex column, for a panel that hangs a subtitle under
   * it (BlastWorkshop). The column is returned as `titleSlot`.
   */
  titleColumn?: boolean;
  /** Trailing controls placed before the close button, e.g. an overlay toggle. */
  extras?: HTMLElement[];
  onClose?: () => void;
}

interface PanelHeaderParts {
  header: HTMLElement;
  /** The title line — bind its text through the panel's own LocaleTextRegistry. */
  titleEl: HTMLElement;
  /** What the header actually holds: the title column when asked for, else the title itself. */
  titleSlot: HTMLElement;
  closeBtn: HTMLButtonElement;
}

/** A panel's header row: accent icon chip, title, trailing controls, close button. */
export function panelHeader(opts: PanelHeaderOptions): PanelHeaderParts {
  const header = el('div');
  header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';

  const iconChip = el('div', { children: [iconEl(opts.icon, 15)] });
  iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;' + PANEL_ACCENT[opts.accent];

  const titleEl = el('div', {
    attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' },
  });
  let titleSlot = titleEl;
  if (opts.titleColumn) {
    titleSlot = el('div', { children: [titleEl] });
    titleSlot.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
  }

  const closeBtn = panelHeaderButton('x', opts.onClose);
  const trailing = [...(opts.extras ?? []), closeBtn];
  // The first trailing control carries the margin that pushes the whole
  // group to the right — the ones after it sit against their neighbour.
  trailing[0]!.style.cssText = 'margin-left:auto;' + trailing[0]!.style.cssText;

  header.append(iconChip, titleSlot, ...trailing);
  return { header, titleEl, titleSlot, closeBtn };
}

/** A panel's scrolling body. `gap` is the vertical rhythm between its cards. */
export function panelBody(gap: number, className?: string): HTMLElement {
  const body = className ? el('div', { className }) : el('div');
  body.style.cssText = `flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:${gap}px`;
  return body;
}
