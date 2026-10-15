// BlastSimulator2026 — Entity inspector (#1756, spec 6.18)
// One docked window for whatever is selected, replacing the one-line selection
// bar. The window owns the frame (header, status line, scrolling body, action
// strip); the per-kind sections, actions and refresh signature live in
// src/ui/panels/inspector/. Purely presentational: main.ts owns what each
// action does and what selecting an occupant link means.
//
// Refresh follows CrewPanel's pattern (spec 2.3): update() rebuilds the body
// and action strip only when the view's structural signature changes;
// otherwise drifting values are written in place and the action buttons keep
// their DOM nodes, so a click is never lost to a rebuild.

import { Vector3 } from 'three';
import { t } from '../../core/i18n/I18n.js';
import type { GameState } from '../../core/state/GameState.js';
import type { EntityPick } from '../scene/ScenePicking.js';
import { el, button, reasonLine, panelRoot, panelHeader, panelHeaderButton, panelBody, replaceChildrenKeepingScroll } from '../dom.js';
import { iconEl } from '../icons.js';
import { contentFor, type InspectorAction, type InspectorView, type InspectorLinks } from '../panels/inspector/InspectorContent.js';
import { shellLayoutRegistry } from './LayoutRegistry.js';
import { writeText } from '../panels/inspector/inspectorWidgets.js';
import { inspectorBounds } from '../panels/inspector/inspectorLayout.js';

export class Inspector {
  private readonly root: HTMLElement;
  private readonly iconChip: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly locateBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private onAction: ((action: InspectorAction, entity: EntityPick) => void) | null = null;
  private onSelect: ((entity: EntityPick) => void) | null = null;
  private onClose: (() => void) | null = null;
  private current: EntityPick | null = null;
  private lastState: GameState | null = null;
  private shownSignature: string | null = null;
  private shownIcon: string | null = null;

  private readonly links: InspectorLinks = {
    select: (kind, id) => this.onSelect?.({ kind, id, point: new Vector3(), distance: 0 }),
  };

  constructor(container: HTMLElement) {
    this.root = panelRoot('bs-inspector');
    // Height follows content up to the band the stylesheet allows; the inline 100% would override it.
    this.root.style.removeProperty('max-height');

    this.locateBtn = panelHeaderButton('locate', () => this.fire('locate'));
    this.locateBtn.dataset['action'] = 'locate';
    const parts = panelHeader({
      icon: 'build', accent: 'amber', titleColumn: true, extras: [this.locateBtn],
      onClose: () => { this.hide(); this.onClose?.(); },
    });
    this.iconChip = parts.header.firstElementChild as HTMLElement;
    this.titleEl = parts.titleEl;
    this.titleEl.style.letterSpacing = '.02em';
    this.subEl = el('div', { className: 'bsx-mono' });
    this.subEl.style.cssText = 'font-size:10px;color:var(--bsx-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    parts.titleSlot.appendChild(this.subEl);

    this.statusEl = el('div', { className: 'bsx-mono' });
    this.statusEl.style.cssText = 'flex:0 0 auto;padding:6px 12px;font-size:11px;color:var(--bsx-text-secondary);border-bottom:1px solid var(--bsx-hairline)';
    this.bodyEl = panelBody(10);
    this.bodyEl.dataset['scrollKey'] = 'inspector-body';
    this.actionsEl = el('div');
    this.actionsEl.style.cssText = 'flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;border-top:1px solid var(--bsx-hairline)';

    this.root.append(parts.header, this.statusEl, this.bodyEl, this.actionsEl);
    container.appendChild(this.root);
    shellLayoutRegistry.register({ id: 'inspector', layer: 'hud', bounds: inspectorBounds });
  }

  setActionHandler(cb: (action: InspectorAction, entity: EntityPick) => void): void { this.onAction = cb; }
  /** Called when a link inside the window (an occupant name) asks to select another entity. */
  setSelectHandler(cb: (entity: EntityPick) => void): void { this.onSelect = cb; }
  /** Called when the close button is used; the caller clears the selection and its outline. */
  setCloseHandler(cb: () => void): void { this.onClose = cb; }

  get open(): boolean { return this.root.style.display !== 'none'; }
  get target(): { kind: EntityPick['kind']; id: number } | null {
    return this.current ? { kind: this.current.kind, id: this.current.id } : null;
  }

  show(entity: EntityPick, state: GameState): void {
    this.current = entity;
    this.lastState = state;
    this.shownSignature = null;
    this.render(state);
  }

  /** Per-frame refresh: structure rebuilds on a signature change, values are written in place. */
  update(state: GameState): void {
    if (!this.current) return;
    this.lastState = state;
    this.render(state);
  }

  hide(): void {
    this.root.style.display = 'none';
    this.current = null;
    this.shownSignature = null;
  }

  /** Re-render in the new language; the window stays open on the same entity. */
  refreshLocale(): void {
    if (!this.current || !this.lastState) return;
    this.shownSignature = null;
    this.render(this.lastState);
  }

  dispose(): void {
    this.root.remove();
    shellLayoutRegistry.unregister('inspector');
  }

  private fire(action: InspectorAction): void {
    if (this.current) this.onAction?.(action, this.current);
  }

  private render(state: GameState): void {
    const entity = this.current;
    if (!entity) return;
    const view = contentFor(entity.kind).view(entity, state, this.links);
    if (!view) { this.hide(); return; }

    this.root.dataset['kind'] = entity.kind;
    this.root.dataset['id'] = String(entity.id);
    this.locateBtn.title = t('inspector.locate');
    this.locateBtn.setAttribute('aria-label', t('inspector.locate'));
    writeText(this.titleEl, view.title);
    writeText(this.subEl, view.sub);
    writeText(this.statusEl, view.status);
    if (this.shownIcon !== view.icon) {
      this.iconChip.replaceChildren(iconEl(view.icon, 15));
      this.shownIcon = view.icon;
    }

    const signature = `${view.signature}|${view.actions.map(a => a.action).join(',')}`;
    if (signature !== this.shownSignature) {
      this.shownSignature = signature;
      this.rebuild(view);
    } else {
      view.sync(this.bodyEl);
      this.syncDisabled(view);
    }
    this.root.style.display = 'flex';
  }

  private rebuild(view: InspectorView): void {
    replaceChildrenKeepingScroll(this.bodyEl, view.sections);
    this.actionsEl.replaceChildren(...view.actions.map(a => button(a.variant, a.label ?? t(a.labelKey), {
      icon: a.icon, dataAction: a.action, disabled: a.disabled === true, onClick: () => this.fire(a.action),
      ...(a.title !== undefined ? { title: a.title } : {}),
    })));
    this.syncReasons(view);
  }

  /** Flip each action button's label, tooltip and disabled state in place, keeping the node. */
  private syncDisabled(view: InspectorView): void {
    for (const a of view.actions) {
      const btn = this.actionsEl.querySelector<HTMLButtonElement>(`button[data-action="${a.action}"]`);
      if (!btn) continue;
      if (btn.disabled !== (a.disabled === true)) btn.disabled = a.disabled === true;
      const label = btn.lastElementChild as HTMLElement | null;
      if (label) writeText(label, a.label ?? t(a.labelKey));
      const title = a.title ?? '';
      if (btn.title !== title) btn.title = title;
    }
    this.syncReasons(view);
  }

  /** One inline reason line under the strip per disabled action that names why (the tooltip alone is invisible to touch). */
  private syncReasons(view: InspectorView): void {
    const wanted = view.actions.filter(a => a.disabled === true && a.title !== undefined);
    const shown = Array.from(this.actionsEl.querySelectorAll<HTMLElement>('[data-reason]'));
    const unchanged = shown.length === wanted.length
      && wanted.every((a, i) => shown[i]!.dataset['reason'] === a.action && shown[i]!.textContent === a.title);
    if (unchanged) return;
    for (const node of shown) node.remove();
    for (const a of wanted) {
      const line = reasonLine(a.title!);
      line.dataset['reason'] = a.action;
      line.style.flex = '1 1 100%';
      this.actionsEl.append(line);
    }
  }
}
