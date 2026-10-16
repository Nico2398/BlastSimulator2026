/** Small DOM pieces shared by the per-kind Inspector content modules (#1756). */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { el, sectionHeader } from '../../dom.js';
import type { InspectorKind, InspectorLinks } from './InspectorContent.js';
import type { LinkFactory } from '../../crewDetailSections.js';
import { ALLOWED_CLASS, HIGHLIGHT_CLASS } from '../../tutorialGuide.js';

/** Set a node's text only when it differs, so a steady frame touches no DOM. */
export function writeText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** The value node of a `liveRow`; `setLive` finds it by `data-live`. */
export function liveValue(row: HTMLElement): HTMLElement {
  return row.lastElementChild as HTMLElement;
}

/** Set a data attribute on a node and return it, so a row can be tagged inline. */
export function tagged(node: HTMLElement, attr: string, value = ''): HTMLElement {
  node.setAttribute(attr, value);
  return node;
}

/** Localized mass in kilograms. */
export function kgText(kg: number): string {
  return t('inspector.vehicle.kg', { kg: formatMoney(kg) });
}

/** Vertical stack of a kind's sections inside the Inspector body. */
export function detailBody(className: string): HTMLElement {
  const body = el('div', { className });
  body.style.cssText = 'display:flex;flex-direction:column;gap:11px';
  return body;
}

/** Plain label + value row (value may be a node, e.g. a link). */
export function valueRow(label: string, value: string | HTMLElement): HTMLElement {
  const row = el('div', { className: 'bsx-mono' });
  row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:11px';
  const labelEl = el('span', { text: label });
  labelEl.style.color = 'var(--bsx-text-muted)';
  row.append(labelEl, typeof value === 'string' ? el('span', { text: value }) : value);
  return row;
}


/** Label + value row whose value is rewritten in place by `setLive` (key = `data-live`). */
export function liveRow(label: string, key: string, text: string): HTMLElement {
  const value = el('span', { text });
  value.dataset['live'] = key;
  return valueRow(label, value);
}

/** The descendant of `root` tagged `data-live="key"`, or null. */
export function findLive(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-live="${key}"]`);
}

/** Tag `node` as live under `key` and return it. */
export function markLive(node: HTMLElement, key: string): HTMLElement {
  node.dataset['live'] = key;
  return node;
}

/** A static 11px note line, sized like the rows around it. */
export function noteLine(text: string): HTMLElement {
  const line = el('div', { text, className: 'bsx-mono' });
  line.style.fontSize = '11px';
  return line;
}

/** A small monospace text line rewritten in place under `data-live` = key. */
export function liveLine(key: string, text: string): HTMLElement {
  const line = el('div', { text, className: 'bsx-mono' });
  line.style.fontSize = '11px';
  return markLive(line, key);
}

/** A building section plus its live-sync hook. */
export interface InspectorSection {
  readonly section: HTMLElement;
  /** Names the row set: when it changes the section must be rebuilt, not synced in place. */
  readonly rowSignature: string;
  readonly sync: (root: HTMLElement) => void;
}

/** Write a live value in place; a no-op when unchanged so a steady frame touches no DOM. */
export function setLive(root: HTMLElement, key: string, text: string): HTMLElement | null {
  const node = findLive(root, key);
  if (node) writeText(node, text);
  return node;
}

/** A button-styled-as-link that selects another entity (occupant, driver...). Its text is exactly `name`. */
export function entityLink(name: string, kind: InspectorKind, id: number, links: InspectorLinks): HTMLElement {
  const link = el('button', { text: name });
  link.dataset['selectKind'] = kind;
  link.dataset['selectId'] = String(id);
  link.style.cssText = 'border:0;background:transparent;padding:0;color:var(--bsx-info);cursor:pointer;text-decoration:underline;font:inherit';
  link.addEventListener('click', () => links.select(kind, id));
  return link;
}

/** Localized kind name for the header sub-line. */
export function kindLabel(kind: InspectorKind): string {
  return t(`inspector.kind.${kind}`);
}

/** A section's body: a vertical stack of rows under a section header. */
export function sectionOf(label: string, rows: (HTMLElement | null)[]): HTMLElement {
  const wrap = el('div', { children: [sectionHeader(label), ...rows] });
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  return wrap;
}

/**
 * A node's markup without the tutorial rails' marks. The guide adds them to live
 * nodes between passes; counting them as content change would replace the section
 * on every sync and strip the marks (the control goes inert until the next pass).
 */
function contentHtml(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  // Live values are written in place by syncSection; they are not structure.
  for (const live of Array.from(clone.querySelectorAll('[data-live]'))) {
    live.textContent = '';
    live.removeAttribute('style');
  }
  for (const cls of [ALLOWED_CLASS, HIGHLIGHT_CLASS]) {
    for (const marked of [clone, ...Array.from(clone.querySelectorAll(`.${cls}`))]) {
      marked.classList.remove(cls);
      if (marked.getAttribute('class') === '') marked.removeAttribute('class');
    }
  }
  return clone.outerHTML;
}

/** Keep the child `className` of `root` current: rebuilt via `build` when it changed; null removes it. */
export function syncSection(root: HTMLElement, className: string, build: () => HTMLElement | null): void {
  const current = Array.from(root.children).find(c => c.classList.contains(className));
  const next = build();
  if (!next) { current?.remove(); return; }
  next.classList.add(className);
  if (!current) root.append(next);
  else if (contentHtml(current) !== contentHtml(next)) current.replaceWith(next);
  else {
    for (const live of Array.from(next.querySelectorAll<HTMLElement>('[data-live]'))) {
      const key = live.dataset['live'];
      if (key === undefined) continue;
      const node = setLive(current as HTMLElement, key, live.textContent ?? '');
      const style = live.getAttribute('style');
      if (node && style !== null && node.getAttribute('style') !== style) node.setAttribute('style', style);
    }
  }
}

/** A LinkFactory whose links select entities through `links`. */
export function linkFactory(links: InspectorLinks): LinkFactory {
  return (kind, id, label) => entityLink(label, kind, id, links);
}
