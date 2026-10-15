/** Inspector window: replaces SelectionBar (#1756). Stub. */
import type { GameState } from '../../core/state/GameState.js';
import type { EntityPick } from '../scene/ScenePicking.js';

export type InspectorAction =
  | 'detail' | 'dispatch_here' | 'train' | 'move_here' | 'upgrade_vehicle'
  | 'upgrade' | 'move' | 'demolish' | 'widen' | 'locate';

export class Inspector {
  constructor(container: HTMLElement) {
    void container;
  }

  setActionHandler(cb: (action: InspectorAction, entity: EntityPick) => void): void { void cb; }
  setSelectHandler(cb: (entity: EntityPick) => void): void { void cb; }
  setCloseHandler(cb: () => void): void { void cb; }

  get open(): boolean { return false; }
  get target(): { kind: EntityPick['kind']; id: number } | null { return null; }

  show(entity: EntityPick, state: GameState): void { void entity; void state; }
  update(state: GameState): void { void state; }
  hide(): void {}
  refreshLocale(): void {}
  dispose(): void {}
}
