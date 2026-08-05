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

export type SelectionAction =
  | 'detail' | 'dispatch_here' | 'train'
  | 'haul' | 'unassign' | 'follow'
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
      'position:fixed', 'left:50%', 'bottom:22px', 'transform:translateX(-50%)',
      'z-index:var(--bsx-z-panel)', 'align-items:center', 'gap:14px',
      'padding:10px 14px', 'border-radius:var(--bsx-r-panel)', 'background:rgba(18,22,28,.96)',
      'border:1px solid var(--bsx-hairline-strong)', 'box-shadow:0 10px 30px rgba(0,0,0,.45)',
      'pointer-events:all',
    ].join(';');
    this.root.style.display = 'none'; // set separately — jsdom's cssText parser can drop this declaration when it shares a cssText string with a var(...) value

    const identity = el('div');
    identity.style.cssText = 'display:flex;flex-direction:column;gap:1px;padding-right:12px;border-right:1px solid var(--bsx-hairline);min-width:110px';
    this.titleEl = el('div');
    this.titleEl.style.cssText = 'font:600 12px/1.2 var(--bsx-font-ui);color:var(--bsx-text-primary)';
    this.subEl = el('div', { className: 'bsx-mono' });
    this.subEl.style.cssText = 'font-size:10px;color:var(--bsx-text-muted)';
    identity.append(this.titleEl, this.subEl);

    this.actionsEl = el('div');
    this.actionsEl.style.cssText = 'display:flex;align-items:center;gap:8px';

    const closeBtn = el('button');
    closeBtn.style.cssText = 'width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--bsx-text-muted);cursor:pointer;pointer-events:all';
    closeBtn.appendChild(iconEl('x', 13));
    closeBtn.addEventListener('click', () => this.hide());

    this.root.append(identity, this.actionsEl, closeBtn);
    container.appendChild(this.root);
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
  }
}
