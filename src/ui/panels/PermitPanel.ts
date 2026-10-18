// BlastSimulator2026 — Permits panel (#1924)
// Mine-grade ladder: current grade stamp, next-grade targets, fee, apply button, pending application.
// DOM contracts: [data-role="permit-stamp"], [data-target="<kind>"][data-met],
// [data-action="permit-apply"], [data-role="permit-apply-reason"], [data-role="permit-pending"].

import { PanelBase } from './PanelBase.js';
import { panelRoot } from '../dom.js';
import type { GameState } from '../../core/state/GameState.js';
import type { GameConsoleFn } from '../gameConsole.js';

export class PermitPanel extends PanelBase {
  constructor(_container: HTMLElement) {
    super(panelRoot('bs-permit-panel'));
  }

  setGameConsole(_fn: GameConsoleFn): void {
    // TODO: implement
  }

  update(_state: GameState): void {
    // TODO: implement
  }

  refreshLocale(): void {
    // TODO: implement
  }

  override dispose(): void {
    super.dispose();
  }
}
