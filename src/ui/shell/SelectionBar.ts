// BlastSimulator2026 — Selection bar (redesign P2)
// Bottom-center action bar shown while a scene entity is selected, shifted right
// of the left column (#1423) when the viewport is too narrow to centre it. Purely
// presentational: renders the right button set for the selected kind and
// reports which one was clicked — main.ts owns what each action actually does.

import { t } from '../../core/i18n/I18n.js';
import { el, button } from '../dom.js';
import { iconEl } from '../icons.js';
import type { GameState } from '../../core/state/GameState.js';
import type { EntityPick } from '../scene/ScenePicking.js';
import { nextRampWidth } from '../../core/mining/RampWidening.js';
import type { RampWidth } from '../../core/config/balance.js';
import { describeRamp } from '../describeRamp.js';
import { holeNumericId } from '../../core/mining/DrillPlan.js';
import { LEFT_COL_RIGHT_EDGE_PX } from './LeftColumn.js';
import { shellLayoutRegistry, type Viewport, type Rect } from './LayoutRegistry.js';
import { resolveVehicleDriver } from '../../core/entities/Vehicle.js';
import { computeVehicleStatus } from '../../core/entities/VehicleStatus.js';
import { describeStatus } from '../fleetDetailSections.js';
import { getBuildingPeopleCapacity } from '../../core/entities/Building.js';

/** Minimum horizontal gap between the selection bar and the left column's right edge. */
export const SELECTION_BAR_LEFT_COL_GAP_PX = 8;
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
/**
 * Sub-text line max-width — bounds a building's occupant-name list (#1205)
 * to a single truncated line instead of wrapping and growing the bar past
 * its fixed declared height (selectionBarBounds() above never accounts for
 * multi-line sub-text).
 */
const SELECTION_BAR_SUB_MAX_WIDTH_PX = 220;
/** Identity block right padding (before its border), matching its inline style below. */
const SELECTION_BAR_IDENTITY_PADDING_RIGHT_PX = 12;
/** Identity block right border, matching its inline style below. */
const SELECTION_BAR_IDENTITY_BORDER_PX = 1;
/** Close button size, matching its inline style below. */
const SELECTION_BAR_CLOSE_BTN_PX = 26;
/** Gap between action buttons, matching its inline style below. */
const SELECTION_BAR_BUTTON_GAP_PX = 8;
/** Root row border, matching its `border:` inline style below — part of the painted box, so the declared bounds carry it. */
const SELECTION_BAR_BORDER_PX = 1;
/** `.bsx-btn` height (tokens.ts's shared button class) — the tallest child in the row. */
const SELECTION_BAR_CONTENT_HEIGHT_PX = 30;
/**
 * Worst-case per-button width, measured rather than estimated: at 1280x720 the
 * widest rendered action button is "Transporter" (fr) at 112px, with
 * "Move Here" (en) at 105 and "Désaffecter" (fr) at 110. 120 covers the
 * measured maximum with headroom.
 *
 * The earlier 150 was a guess, and a guess is not free: it made the declared
 * bar 789px wide against a real 612, which collided with the MiniMap's
 * declared region in the matrix test while the painted boxes were 79px apart
 * (#983). An envelope has to contain the real box, but padding it out by a
 * third turns the collision test into a source of false failures.
 */
const SELECTION_BAR_BUTTON_WIDTH_PX = 120;
/**
 * Widest action set across every entity kind buildActions() renders — the
 * employee and building cases (three buttons each). Bump this alongside any
 * new action added to that switch's widest branch.
 */
const SELECTION_BAR_MAX_ACTIONS = 3;

/** Declared envelope width: the widest action set (employee and building selection) so it covers every entity kind. */
const SELECTION_BAR_WIDTH_PX = (() => {
  const actionsWidth = SELECTION_BAR_MAX_ACTIONS * SELECTION_BAR_BUTTON_WIDTH_PX
    + (SELECTION_BAR_MAX_ACTIONS - 1) * SELECTION_BAR_BUTTON_GAP_PX;
  const identityWidth = SELECTION_BAR_IDENTITY_MIN_WIDTH_PX + SELECTION_BAR_IDENTITY_PADDING_RIGHT_PX + SELECTION_BAR_IDENTITY_BORDER_PX;
  return SELECTION_BAR_BORDER_PX * 2
    + SELECTION_BAR_PADDING_X_PX * 2
    + identityWidth
    + SELECTION_BAR_ROOT_GAP_PX * 2
    + actionsWidth
    + SELECTION_BAR_CLOSE_BTN_PX;
})();
/** Smallest centre-x that keeps the bar's left edge clear of the left column plus the gap. */
const SELECTION_BAR_MIN_CENTER_PX = LEFT_COL_RIGHT_EDGE_PX + SELECTION_BAR_LEFT_COL_GAP_PX + SELECTION_BAR_WIDTH_PX / 2;

/**
 * Inline `left` of the bar (its centre, given translateX(-50%)): viewport centre,
 * pushed right when that would cover the left column. Exported because jsdom's
 * CSS parser drops max(), so tests read this string instead of the style property.
 */
export function selectionBarLeftCss(): string {
  return `max(50%, ${SELECTION_BAR_MIN_CENTER_PX}px)`;
}

/** Bottom-center bar, sized for the widest action set; shifted right at narrow viewports so it never covers the left column. */
function selectionBarBounds(viewport: Viewport): Rect {
  const width = SELECTION_BAR_WIDTH_PX;
  const height = SELECTION_BAR_BORDER_PX * 2 + SELECTION_BAR_PADDING_Y_PX * 2 + SELECTION_BAR_CONTENT_HEIGHT_PX;
  return {
    x: Math.max((viewport.width - width) / 2, LEFT_COL_RIGHT_EDGE_PX + SELECTION_BAR_LEFT_COL_GAP_PX),
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
  | 'follow' | 'move_here'
  | 'upgrade' | 'move' | 'demolish'
  | 'focus' | 'widen';

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
      'position:fixed', `bottom:${SELECTION_BAR_BOTTOM_OFFSET_PX}px`, 'transform:translateX(-50%)',
      'z-index:var(--bsx-z-panel)', 'align-items:center', `gap:${SELECTION_BAR_ROOT_GAP_PX}px`,
      `padding:${SELECTION_BAR_PADDING_Y_PX}px ${SELECTION_BAR_PADDING_X_PX}px`, 'border-radius:var(--bsx-r-panel)', 'background:rgba(18,22,28,.96)',
      'border:1px solid var(--bsx-hairline-strong)', 'box-shadow:0 10px 30px rgba(0,0,0,.45)',
      'pointer-events:all',
    ].join(';');
    // Set via the style property for the same jsdom reason as display below; mirrors selectionBarBounds().
    this.root.style.left = selectionBarLeftCss();
    this.root.style.display = 'none'; // set separately — jsdom's cssText parser can drop this declaration when it shares a cssText string with a var(...) value

    const identity = el('div');
    identity.style.cssText = `display:flex;flex-direction:column;gap:1px;padding-right:${SELECTION_BAR_IDENTITY_PADDING_RIGHT_PX}px;border-right:${SELECTION_BAR_IDENTITY_BORDER_PX}px solid var(--bsx-hairline);min-width:${SELECTION_BAR_IDENTITY_MIN_WIDTH_PX}px`;
    this.titleEl = el('div');
    this.titleEl.style.cssText = 'font:600 12px/1.2 var(--bsx-font-ui);color:var(--bsx-text-primary)';
    this.subEl = el('div', { className: 'bsx-mono' });
    this.subEl.style.cssText = `font-size:10px;color:var(--bsx-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${SELECTION_BAR_SUB_MAX_WIDTH_PX}px`;
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
    const ramp = entity.kind === 'ramp' ? state.builtRamps.find(r => r.id === entity.id) : undefined;
    this.actionsEl.replaceChildren(...this.buildActions(entity, ramp ? nextRampWidth(ramp.width) : null));
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
        let sub = `#${b.id} · HP ${Math.round(b.hp)}`;
        const capacity = getBuildingPeopleCapacity(b.type, b.tier);
        if (capacity > 0) {
          sub += ` · ${t('building.occupancy', { inside: b.occupantIds.length, capacity })}`;
          if (b.occupantIds.length > 0) {
            const names = b.occupantIds
              .map(id => state.employees.employees.find(e => e.id === id)?.name)
              .filter((name): name is string => name !== undefined)
              .join(', ');
            if (names) sub += ` · ${t('shell.selection.building_occupants', { names })}`;
          }
        }
        return { title: t(`building.${b.type}.t${b.tier}.name`), sub };
      }
      case 'vehicle': {
        const v = state.vehicles.vehicles.find(x => x.id === entity.id);
        if (!v) return null;
        const status = computeVehicleStatus(v, state.vehicles, resolveVehicleDriver(v, state.employees.employees));
        return { title: t(`vehicle_type.${v.type}`), sub: `#${v.id} · ${describeStatus(status)}` };
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
      case 'ramp': {
        const ramp = state.builtRamps.find(r => r.id === entity.id);
        if (!ramp) return null;
        return describeRamp(ramp);
      }
    }
  }

  private buildActions(entity: EntityPick, nextWidth: RampWidth | null): HTMLElement[] {
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
      case 'ramp': // a terrain feature: widening only, never demolish/upgrade/move
        return nextWidth === null ? [] : [
          button('ghost', t('shell.selection.widen'), { icon: 'up', dataAction: 'widen', onClick: () => fire('widen') }),
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
