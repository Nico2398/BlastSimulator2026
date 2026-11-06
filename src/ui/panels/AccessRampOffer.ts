// BlastSimulator2026 — "Dig access ramp" offer card (#2144)
// One card shared by the blast report and the Operations panel: previews the proposed ramp with cost and length,
// orders it on one click through the console, or hands it to the manual ramp tool to adjust.

import type { GameState } from '../../core/state/GameState.js';
import type { AccessRampProposal } from '../../core/mining/CraterAccessProposal.js';
import type { GameConsoleFn } from '../gameConsole.js';

export class AccessRampOffer {
  /** `prefix` namespaces the buttons' data-action: `<prefix>-dig-ramp`, `<prefix>-adjust-ramp`. */
  constructor(readonly prefix: 'report' | 'ops') {}
  readonly root: HTMLElement = document.createElement('div');
  setProposalProvider(_fn: () => AccessRampProposal | null): void { throw new Error('not implemented'); }
  setGameConsole(_fn: GameConsoleFn): void { throw new Error('not implemented'); }
  setAdjustHandler(_fn: (proposal: Extract<AccessRampProposal, { ok: true }>) => void): void { throw new Error('not implemented'); }
  /** Re-reads the proposal (once per game tick) and rebuilds the card; hidden while there is nothing stranded. */
  refresh(_state: GameState): void { throw new Error('not implemented'); }
}
