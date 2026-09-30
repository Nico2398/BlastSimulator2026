// BlastSimulator2026 — Effects of the player's answer to a traffic jam (#1208)

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { TrafficJam } from './TrafficJams.js';

/** What a jam effect handler may touch. */
export interface JamWorld {
  state: GameState;
  grid: VoxelGrid | null;
}

export interface JamEffectOutcome {
  effects: string[];
  cashChange: number;
  /** '_alt' when the handler could not do what was asked and the fallback result text applies. */
  resultKeySuffix: '' | '_alt';
}

export type JamEffectHandler = (jam: TrafficJam, world: JamWorld) => JamEffectOutcome;

const noop: JamEffectHandler = () => ({ effects: [], cashChange: 0, resultKeySuffix: '' });

/** Handlers keyed by the event option's effect id. */
export const TRAFFIC_JAM_EFFECTS: Readonly<Record<string, JamEffectHandler>> = {
  reroute_vehicles: noop,
  widen_ramp: noop,
  ignore_jam: noop,
};
