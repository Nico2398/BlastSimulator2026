// BlastSimulator2026 — Selection bar (redesign P2)
// Bottom-center action bar shown while a scene entity is selected. Purely
// presentational: renders the right button set for the selected kind and
// reports which one was clicked — main.ts owns what each action actually does.

import { t } from '../../core/i18n/I18n.js';
import { el, button } from '../dom.js';
import { iconEl } from '../icons.js';
import type { GameState } from '../../core/state/GameState.js';
import type { EntityPick } from '../scene/ScenePicking.js';
import { holeNumericId } from '../../core/mining/DrillPlan.js';
import { shellLayoutRegistry, type Viewport, type Rect } from './LayoutRegistry.js';

/** Bottom offset of the bar, matching its `bottom:` inline style below. */
const SELECTION_BAR_BOTTOM_OFFSET_PX = 22;
/** Root row horizontal padding, matching its inline style below. */
const SELECTION_BAR_PADDING_X_PX = 14;
/** Root row vertical padding, matching its inline style below. */
const SELECTION_BAR_PADDING_Y_PX = 10;
/** Gap between the identity block, action buttons and close button, matching its inline style below. */
const SELECTION_BAR_ROOT_GAP_PX = 14;
/** Identity block min-width, matching its inline style below. */
const SELECTION_BAR_IDENTITY_MIN_WIDTH_PX = 110;
/** Identity block right padding (before its border), matching its inline style below. */
const SELECTION_BAR_IDENTITY_PADDING_RIGHT_PX = 12;
/** Identity block right border, matching its inline style below. */
const SELECTION_BAR_IDENTITY_BORDER_PX = 1;
/** Close button size, matching its inline style below. */
const SELECTION_BAR_CLOSE_BTN_PX = 26;
/** Gap between action buttons, matching its inline style below. */
const SELECTION_BAR_BUTTON_GAP_PX = 8;
/** `.bsx-btn` height (tokens.ts's shared button class) — the tallest child in the row. */
const SELECTION_BAR_CONTENT_HEIGHT_PX = 30;
/**
 * Worst-case per-button width: `.bsx-btn` padding (2×12) + border (2×1) +
 * icon (12) + icon/label gap (7) + the longest translated action label at
 * 600 weight / 10px / .1em letter-spacing — "Dispatch Here" (en) and
 * "Désaffecter" (fr) both land well under this, rounded up for headroom.
 */
const SELECTION_BAR_BUTTON_WIDTH_PX = 150;
/**
 * Widest action set across every entity kind buildActions() renders — the
 * vehicle case (follow, move_here, haul, unassign). Bump this alongside any
 * new action added to that switch's widest branch.
 */
const SELECTION_BAR_MAX_ACTIONS = 4;

/** Bottom-center bar, sized for the widest action set (vehicle selection) so the declared envelope covers every entity kind. */
function selectionBarBounds(viewport: Viewport): Rect {
  const actionsWidth = SELECTION_BAR_MAX_ACTIONS * SELECTION_BAR_BUTTON_WIDTH_PX
    + (SELECTION_BAR_MAX_ACTIONS - 1) * SELECTION_BAR_BUTTON_GAP_PX;
  const identityWidth = SELECTION_BAR_IDENTITY_MIN_WIDTH_PX + SELECTION_BAR_IDENTITY_PADDING_RIGHT_PX + SELECTION_BAR_IDENTITY_BORDER_PX;
  const width = SELECTION_BAR_PADDING_X_PX * 2
    + identityWidth
    + SELECTION_BAR_ROOT_GAP_PX * 2
    + actionsWidth
    + SELECTION_BAR_CLOSE_BTN_PX;
  const height = SELECTION_BAR_PADDING_Y_PX * 2 + SELECTION_BAR_CONTENT_HEIGHT_PX;
  return {
    x: (viewport.width - width) / 2,
    y: viewport.height - SELECTION_BAR_BOTTOM_OFFSET_PX - height,
    width,
    height,
  };
}

// 'move_here' (vehicle, drive to the hovered tile) is deliberately distinct
// from 'move' (building, relocate via the Build panel) — same English verb,
// two unrelated flows, so they never share an action name or a data-action.
export type SelectionAction =
  | 'detail' | 'dispatch_here' | 'train'
  | 'haul' | 'unassign' | 'follow' | 'move_here'
  | 'upgrade' | 'move' | 'demolish'
  | 'focus';

export class SelectionBar {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private onAction: ((action: SelectionAction, entity: EntityPick) => void) | null = null;
  private current: EntityPick | null = null;

  constructor(container: HTMLElement) {
    this.root = el('div', { className: 'bsx-root', attrs: { id: 'bs-selection-bar' } });
    this.root.style.cssText = [
      'position:fixed', 'left:50%', `bottom:${SELECTION_BAR_BOTTOM_OFFSET_PX}px`, 'transform:translateX(-50%)',
      'z-index:var(--bsx-z-panel)', 'align-items:center', `gap:${SELECTION_BAR_ROOT_GAP_PX}px`,
      `padding:${SELECTION_BAR_PADDING_Y_PX}px ${SELECTION_BAR_PADDING_X_PX}px`, 'border-radius:var(--bsx-r-panel)', 'background:rgba(18,22,28,.96)',
      'border:1px solid var(--bsx-hairline-strong)', 'box-shadow:0 10px 30px rgba(0,0,0,.45)',
      'pointer-events:all',
    ].join(';');
    this.root.style.display = 'none'; // set separately — jsdom's cssText parser can drop this declaration when it shares a cssText string with a var(...) value

    const identity = el('div');
    identity.style.cssText = `display:flex;flex-direction:column;gap:1px;padding-right:${SELECTION_BAR_IDENTITY_PADDING_RIGHT_PX}px;border-right:${SELECTION_BAR_IDENTITY_BORDER_PX}px solid var(--bsx-hairline);min-width:${SELECTION_BAR_IDENTITY_MIN_WIDTH_PX}px`;
    this.titleEl = el('div');
    this.titleEl.style.cssText = 'font:600 12px/1.2 var(--bsx-font-ui);color:var(--bsx-text-primary)';
    this.subEl = el('div', { className: 'bsx-mono' });
    this.subEl.style.cssText = 'font-size:10px;color:var(--bsx-text-muted)';
    identity.append(this.titleEl, this.subEl);

    this.actionsEl = el('div');
    this.actionsEl.style.cssText = `display:flex;align-items:center;gap:${SELECTION_BAR_BUTTON_GAP_PX}px`;

    const closeBtn = el('button');
    closeBtn.style.cssText = `width:${SELECTION_BAR_CLOSE_BTN_PX}px;height:${SELECTION_BAR_CLOSE_BTN_PX}px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--bsx-text-muted);cursor:pointer;pointer-events:all`;
    closeBtn.appendChild(iconEl('x', 13));
    closeBtn.addEventListener('click', () => this.hide());

    this.root.append(identity, this.actionsEl, closeBtn);
    container.appendChild(this.root);

    shellLayoutRegistry.register({ id: 'selection-bar', layer: 'hud', bounds: selectionBarBounds });
  }

  setActionHandler(cb: (action: SelectionAction, entity: EntityPick) => void): void {
    this.onAction = cb;
  }

  /** True while a selection is shown — closeBtn/Esc both funnel through hide(), which also clears the picking selection via the handler's caller. */
  get visible(): boolean { return this.root.style.display !== 'none'; }

  show(entity: EntityPick, state: GameState): void {
    this.current = entity;
    const identity = this.describe(entity, state);
    if (!identity) { this.hide(); return; }
    this.titleEl.textContent = identity.title;
    this.subEl.textContent = identity.sub;
    this.actionsEl.replaceChildren(...this.buildActions(entity));
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.current = null;
  }

  private describe(entity: EntityPick, state: GameState): { title: string; sub: string } | null {
    switch (entity.kind) {
      case 'building': {
        const b = state.buildings.buildings.find(x => x.id === entity.id);
        if (!b) return null;
        return { title: t(`building.${b.type}.t${b.tier}.name`), sub: `#${b.id} · HP ${Math.round(b.hp)}` };
      }
      case 'vehicle': {
        const v = state.vehicles.vehicles.find(x => x.id === entity.id);
        if (!v) return null;
        return { title: t(`vehicle_type.${v.type}`), sub: `#${v.id} · ${t(`vehicle_state.${v.state}`)}` };
      }
      case 'employee': {
        const e = state.employees.employees.find(x => x.id === entity.id);
        if (!e) return null;
        return { title: e.name, sub: t(`role.${e.role}`) };
      }
      case 'fragment':
        return { title: t('shell.hovertag.fragment', { id: entity.id }), sub: '' };
      case 'hole': {
        const hole = state.drillHoles.find(h => holeNumericId(h.id) === entity.id);
        if (!hole) return null;
        const delay = state.sequenceDelays[hole.id];
        return { title: hole.id, sub: delay !== undefined ? `${hole.depth}m · +${delay}ms` : `${hole.depth}m` };
      }
    }
  }

  private buildActions(entity: EntityPick): HTMLElement[] {
    const fire = (action: SelectionAction) => { if (this.current) this.onAction?.(action, this.current); };
    switch (entity.kind) {
      case 'employee':
        return [
          button('ghost', t('shell.selection.detail'), { icon: 'person', dataAction: 'detail', onClick: () => fire('detail') }),
          button('ghost', t('shell.selection.dispatch_here'), { icon: 'locate', dataAction: 'dispatch_here', onClick: () => fire('dispatch_here') }),
          button('ghost', t('shell.selection.train'), { icon: 'training', dataAction: 'train', onClick: () => fire('train') }),
        ];
      case 'vehicle':
        return [
          button('ghost', t('shell.selection.follow'), { icon: 'eye', dataAction: 'follow', onClick: () => fire('follow') }),
          button('ghost', t('shell.selection.move_here'), { icon: 'locate', dataAction: 'move_here', onClick: () => fire('move_here') }),
          button('ghost', t('shell.selection.haul'), { icon: 'ore', dataAction: 'haul', onClick: () => fire('haul') }),
          button('danger', t('shell.selection.unassign'), { icon: 'x', dataAction: 'unassign', onClick: () => fire('unassign') }),
        ];
      case 'building':
        return [
          button('ghost', t('shell.selection.upgrade'), { icon: 'up', dataAction: 'upgrade', onClick: () => fire('upgrade') }),
          button('ghost', t('shell.selection.move'), { icon: 'drive', dataAction: 'move', onClick: () => fire('move') }),
          button('danger', t('shell.selection.demolish'), { icon: 'trash', dataAction: 'demolish', onClick: () => fire('demolish') }),
        ];
      case 'fragment':
        return [
          button('ghost', t('shell.selection.focus'), { icon: 'locate', dataAction: 'focus', onClick: () => fire('focus') }),
        ];
      case 'hole':
        return [
          button('ghost', t('shell.selection.focus'), { icon: 'locate', dataAction: 'focus', onClick: () => fire('focus') }),
        ];
    }
  }

  refreshLocale(): void {
    if (this.current) {
      // Re-render is cheap and state-driven from the caller on the next
      // show() anyway; a language switch while the bar is open is rare
      // enough that just hiding it (rather than caching state) is fine.
      this.hide();
    }
  }

  dispose(): void {
    this.root.remove();
    shellLayoutRegistry.unregister('selection-bar');
  }
}
