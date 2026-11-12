// BlastSimulator2026 — Central window kit (#2242)
// The building blocks every central management window shares: the window
// frame, its single scrolling body, titled sections, card grids, entity cards
// with a portrait, key-figure tiles and "have vs need" meters. A window has
// exactly one scroll area — its body — so nothing hides inside a nested list;
// long lists become grids that show most of their content at once.

import { el, explainable } from './dom.js';
import { portraitEl, type PortraitSize, type PortraitSpec } from './portraits.js';

/** Root of a central window: same contract as `panelRoot` (hidden until shown), sized by the stage instead of a fixed width. */
export function windowRoot(id: string): HTMLElement {
  const root = el('div', { className: 'bsx-root bsx-window', attrs: { id } });
  root.style.display = 'none';
  return root;
}

/** A window's one scrolling body. */
export function windowBody(className?: string): HTMLElement {
  const body = el('div', { className: className ? `bsx-window-body ${className}` : 'bsx-window-body' });
  // Inline, like panelBody: the body scrolls even before the window stylesheet is on the page.
  body.style.cssText = 'flex:1 1 auto;overflow-y:auto';
  // Keyed so a rebuild through replaceChildrenKeepingScroll carries the player's scroll over (#1592).
  body.dataset['scrollKey'] = 'window-body';
  return body;
}

interface WindowSectionOptions {
  /** Section heading. */
  title: string;
  /** Count or short figure beside the heading. */
  count?: string;
  /** Muted note at the end of the heading row. */
  note?: string;
  /** Controls at the end of the heading row. */
  actions?: HTMLElement[];
  children: (Node | null | undefined)[];
  /** Hook class for tests and scenarios. */
  className?: string;
}

/** A titled block of a window body. */
export function windowSection(opts: WindowSectionOptions): HTMLElement {
  const head = el('div', { className: 'bsx-wsection-head', children: [
    el('span', { className: 'bsx-wsection-title', text: opts.title }),
    opts.count !== undefined ? el('span', { className: 'bsx-wsection-count bsx-mono', text: opts.count }) : null,
    el('span', { className: 'bsx-wsection-rule' }),
    opts.note ? el('span', { className: 'bsx-wsection-note', text: opts.note }) : null,
    ...(opts.actions ?? []),
  ] });
  const cls = opts.className ? `bsx-wsection ${opts.className}` : 'bsx-wsection';
  return el('section', { className: cls, children: [head, ...opts.children] });
}

/** Responsive card grid: as many columns of at least `minPx` as the window affords. */
export function cardGrid(children: (Node | null | undefined)[], minPx: number, className?: string): HTMLElement {
  const grid = el('div', { className: className ? `bsx-grid ${className}` : 'bsx-grid', children });
  grid.style.setProperty('--bsx-grid-min', `${minPx}px`);
  return grid;
}

interface EntityCardOptions {
  portrait?: { spec: PortraitSpec; size: PortraitSize };
  title: string;
  /** Small mono suffix after the title (`#4`). */
  titleNote?: string;
  sub?: string;
  /** Right side of the title row (a status chip, a price). */
  aside?: HTMLElement | null;
  /** Lines under the title block. */
  lines?: (Node | null | undefined)[];
  /** Footer row (buttons). */
  footer?: (Node | null | undefined)[];
  className?: string;
  attrs?: Record<string, string>;
  /** Layout: portrait beside the text (default) or above it. */
  layout?: 'row' | 'column';
}

/** A grid card: portrait, title row, detail lines, optional footer. */
export function entityCard(opts: EntityCardOptions): HTMLElement {
  const titleRow = el('div', { className: 'bsx-ecard-titlerow', children: [
    el('div', { className: 'bsx-ecard-titles', children: [
      el('div', { className: 'bsx-ecard-title', children: [
        el('span', { className: 'bsx-ecard-name', text: opts.title }),
        opts.titleNote ? el('span', { className: 'bsx-ecard-note bsx-mono', text: opts.titleNote }) : null,
      ] }),
      opts.sub ? el('div', { className: 'bsx-ecard-sub', text: opts.sub }) : null,
    ] }),
    opts.aside ?? null,
  ] });
  const content = el('div', { className: 'bsx-ecard-content', children: [titleRow, ...(opts.lines ?? [])] });
  const main = el('div', { className: 'bsx-ecard-main', children: [
    opts.portrait ? portraitEl(opts.portrait.spec, opts.portrait.size) : null,
    content,
  ] });
  const footer = opts.footer && opts.footer.some(Boolean) ? el('div', { className: 'bsx-ecard-footer', children: opts.footer }) : null;
  const layout = opts.layout === 'column' ? ' bsx-ecard-column' : '';
  return el('div', {
    className: `bsx-ecard${layout}${opts.className ? ` ${opts.className}` : ''}`,
    ...(opts.attrs ? { attrs: opts.attrs } : {}),
    children: [main, footer],
  });
}

export type Tone = 'neutral' | 'positive' | 'warn' | 'critical' | 'info';

const TONE_VAR: Record<Tone, string> = {
  neutral: 'var(--bsx-text-secondary)',
  positive: 'var(--bsx-positive)',
  warn: 'var(--bsx-amber)',
  critical: 'var(--bsx-critical)',
  info: 'var(--bsx-info)',
};

function toneColor(tone: Tone): string {
  return TONE_VAR[tone];
}

interface KpiOptions {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  explain?: string;
  /** Hook for in-place refresh and tests. */
  key?: string;
}

/** A key-figure tile: small caps label, large value, muted sub line. */
export function kpiTile(opts: KpiOptions): HTMLElement {
  const value = el('div', { className: 'bsx-kpi-value bsx-mono', text: opts.value });
  value.style.color = toneColor(opts.tone ?? 'neutral');
  const tile = el('div', { className: 'bsx-kpi', children: [
    el('div', { className: 'bsx-kpi-label', text: opts.label }),
    value,
    opts.sub ? el('div', { className: 'bsx-kpi-sub', text: opts.sub }) : null,
  ] });
  if (opts.key) tile.dataset['kpi'] = opts.key;
  return explainable(tile, opts.explain);
}

/** A row of key-figure tiles. */
export function kpiRow(tiles: HTMLElement[]): HTMLElement {
  return el('div', { className: 'bsx-kpis', children: tiles });
}

/**
 * "What we have against what we need": a bar filled to have/need, its colour
 * the tone, with both figures spelled out. `need` 0 reads as fully met.
 */
export function haveNeedBar(have: number, need: number, tone: Tone): HTMLElement {
  const pct = need <= 0 ? 100 : Math.max(0, Math.min(100, (have / need) * 100));
  const fill = el('div', { className: 'bsx-hvn-fill' });
  fill.style.width = `${pct}%`;
  fill.style.background = toneColor(tone);
  return el('div', { className: 'bsx-hvn-track', children: [fill] });
}

/** A small pill with a coloured dot: an outlook or a coverage status. */
export function statusPill(label: string, tone: Tone, explain?: string): HTMLElement {
  const pill = el('span', { className: `bsx-pill bsx-pill-${tone}`, children: [el('span', { className: 'bsx-pill-dot' }), el('span', { text: label })] });
  return explainable(pill, explain);
}
