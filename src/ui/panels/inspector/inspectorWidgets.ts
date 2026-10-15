/** Small DOM pieces shared by the per-kind Inspector content modules (#1756). */
import { t } from '../../../core/i18n/I18n.js';
import { el, sectionHeader } from '../../dom.js';
import type { InspectorKind, InspectorLinks } from './InspectorContent.js';
import type { LinkFactory } from '../../crewDetailSections.js';

/** Set a node's text only when it differs, so a steady frame touches no DOM. */
export function writeText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** The value node of a `liveRow`; `setLive` finds it by `data-live`. */
export function liveValue(row: HTMLElement): HTMLElement {
  return row.lastElementChild as HTMLElement;
}

/** Label + value row whose value is rewritten in place by `setLive` (key = `data-live`). */
export function liveRow(label: string, key: string, text: string): HTMLElement {
  const row = el('div', { className: 'bsx-mono' });
  row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:11px';
  const labelEl = el('span', { text: label });
  labelEl.style.color = 'var(--bsx-text-muted)';
  const value = el('span', { text });
  value.dataset['live'] = key;
  row.append(labelEl, value);
  return row;
}

/** Write a live value in place; a no-op when unchanged so a steady frame touches no DOM. */
export function setLive(root: HTMLElement, key: string, text: string): HTMLElement | null {
  const node = root.querySelector<HTMLElement>(`[data-live="${key}"]`);
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

/** Keep the child `className` of `root` current: rebuilt via `build` when it changed; null removes it. */
export function syncSection(_root: HTMLElement, _className: string, _build: () => HTMLElement | null): void {
  throw new Error('not implemented');
}

/** A LinkFactory whose links select entities through `links`. */
export function linkFactory(_links: InspectorLinks): LinkFactory {
  throw new Error('not implemented');
}
