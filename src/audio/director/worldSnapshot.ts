// BlastSimulator2026 — World snapshot
// The few fields of GameState the audio director compares between two looks at
// the world. Small on purpose: built after every command and tick, so it keeps
// ids and positions, never the entities themselves.

import type { ActionType, GameState } from '../../core/state/GameState.js';
import { DIFF_CONFIG } from '../../core/config/audio/game.js';
import { listHas } from './scalar.js';

export interface Spot {
  readonly x: number;
  readonly z: number;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly buildings: ReadonlyMap<number, Spot>;
  readonly vehicles: ReadonlyMap<number, Spot>;
  /** Player-meaningful actions someone has claimed (walking to them or working them), by id. */
  readonly claimedActions: ReadonlyMap<number, ActionType>;
  readonly holeIds: ReadonlySet<string>;
  readonly chargedHoleIds: ReadonlySet<string>;
  readonly surveyCount: number;
  readonly transactionCount: number;
  /** "eventId@firedAtTick" of the event awaiting a decision. */
  readonly pendingEventKey: string | null;
  /** Identity of the last blast report: a new object is a blast that has landed. */
  readonly blastReport: object | null;
  readonly levelEndReason: GameState['levelEndReason'];
  /** Total charge loaded across all holes (kg): the mass the next blast will fire. */
  readonly chargeKg: number;
}

function spots(items: readonly { id: number; x: number; z: number }[]): Map<number, Spot> {
  return new Map(items.map(item => [item.id, { x: item.x, z: item.z }]));
}

export function takeSnapshot(state: GameState): WorldSnapshot {
  const claimedActions = new Map<number, ActionType>();
  for (const action of state.pendingActions) {
    if (action.status !== 'queued' && !listHas(DIFF_CONFIG.noiseActions, action.type)) claimedActions.set(action.id, action.type);
  }
  const pending = state.events.pendingEvent;
  return {
    tick: state.tickCount,
    buildings: spots(state.buildings.buildings),
    vehicles: spots(state.vehicles.vehicles),
    claimedActions,
    holeIds: new Set(state.drillHoles.map(h => h.id)),
    chargedHoleIds: new Set(Object.keys(state.chargesByHole)),
    surveyCount: state.surveyResults.length,
    transactionCount: state.finances.transactions.length,
    pendingEventKey: pending ? `${pending.eventId}@${pending.firedAtTick}` : null,
    blastReport: state.lastBlastReport,
    levelEndReason: state.levelEndReason,
    chargeKg: Object.values(state.chargesByHole).reduce((sum, charge) => sum + charge.amountKg, 0),
  };
}
