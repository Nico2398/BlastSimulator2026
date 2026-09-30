// BlastSimulator2026 — Effects of the player's answer to a traffic jam (#1208)

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { TrafficJam } from './TrafficJams.js';
import { respreadLegDestination } from '../engine/Locomotion.js';
import { nextRampWidth, orderRampWiden } from '../mining/RampWidening.js';
import { clampScore } from '../scores/ScoreManager.js';
import {
  TRAFFIC_JAM_IGNORE_SILENCE_TICKS,
  TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY,
  TRAFFIC_JAM_REROUTE_SILENCE_TICKS,
  TRAFFIC_JAM_WIDEN_SILENCE_TICKS,
} from '../config/balance.js';

/** What a jam effect handler may touch. */
export interface JamWorld {
  state: GameState;
  grid: VoxelGrid | null;
}

interface JamEffectOutcome {
  effects: string[];
  cashChange: number;
  /** '_alt' when the handler could not do what was asked and the fallback result text applies. */
  resultKeySuffix: '' | '_alt';
}

type JamEffectHandler = (jam: TrafficJam, world: JamWorld, tick: number) => JamEffectOutcome;

function silence(world: JamWorld, jam: TrafficJam, tick: number, ticks: number): void {
  world.state.events.jamSilencedUntil[jam.key] = tick + ticks;
}

const rerouteVehicles: JamEffectHandler = (jam, world, tick) => {
  const ids = new Set(jam.agentIds);
  for (const emp of world.state.employees.employees) {
    if (!ids.has(emp.id)) continue;
    emp.vehicleWaitingTicks = 0;
    emp.isMoveStuck = false;
    respreadLegDestination(world.state, emp);
  }
  silence(world, jam, tick, TRAFFIC_JAM_REROUTE_SILENCE_TICKS);
  return { effects: [], cashChange: 0, resultKeySuffix: '' };
};

/** Orders the ramp one width wider; charges through orderRampWiden alone, so cashChange stays 0. */
const widenRamp: JamEffectHandler = (jam, world, tick) => {
  const { state, grid } = world;
  const ramp = jam.rampId === null ? undefined : state.builtRamps.find(r => r.id === jam.rampId);
  const toWidth = ramp ? nextRampWidth(ramp.width) : null;
  if (!ramp || toWidth === null || !grid || state.plannedRamps.some(p => p.widenOf === ramp.id)) {
    return { effects: [], cashChange: 0, resultKeySuffix: '_alt' };
  }
  const ordered = orderRampWiden(state, grid, ramp.id, toWidth);
  if (!ordered.success) return { effects: [], cashChange: 0, resultKeySuffix: '_alt' };
  silence(world, jam, tick, TRAFFIC_JAM_WIDEN_SILENCE_TICKS);
  return { effects: [`Lost $${ordered.data.cost}`], cashChange: 0, resultKeySuffix: '' };
};

const ignoreJam: JamEffectHandler = (jam, world, tick) => {
  const scores = world.state.scores;
  scores.wellBeing = clampScore(scores.wellBeing - TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY);
  silence(world, jam, tick, TRAFFIC_JAM_IGNORE_SILENCE_TICKS);
  return { effects: [], cashChange: 0, resultKeySuffix: '' };
};

/** Handlers keyed by the event option's effect id. */
export const TRAFFIC_JAM_EFFECTS: Readonly<Record<string, JamEffectHandler>> = {
  reroute_vehicles: rerouteVehicles,
  widen_ramp: widenRamp,
  ignore_jam: ignoreJam,
};
