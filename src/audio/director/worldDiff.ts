// BlastSimulator2026 — World diff
// Turns "what the world looked like last time" and "what it looks like now" into
// the cues a player should hear. Pure: it reads a snapshot and a GameState and
// returns data; nothing here touches a player or a clock.
//
// A diff may span up to DIRECTOR_CONFIG.maxCoalescedTicks ticks (the 8x
// auto-tick runs eight in one command), so it never counts elements: each
// category yields at most one cue per diff.

import type { OneShotId } from '../SoundCatalog.js';
import type { GameState } from '../../core/state/GameState.js';
import { DIFF_CONFIG, DIRECTOR_CONFIG } from '../../core/config/audio/game.js';
import type { Cue } from './playCue.js';
import { listHas } from './scalar.js';
import type { WorldSnapshot } from './worldSnapshot.js';

export interface WorldDiff {
  readonly cues: readonly Cue[];
  /** A blast report appeared: the blast timeline owns every consequence of it. */
  readonly blastLanded: boolean;
  readonly levelEnd: 'win' | 'lose' | null;
  /** An event now awaits a decision: the ambience should step aside. */
  readonly eventAlert: boolean;
}

const SILENT: WorldDiff = { cues: [], blastLanded: false, levelEnd: null, eventAlert: false };

const CD = DIFF_CONFIG.cooldownsS;

/** Category flourish played a beat after the alert; other categories get the alert alone. */
const EVENT_FLOURISH: Readonly<Record<string, OneShotId>> = {
  union: 'event_union',
  lawsuit: 'event_lawsuit',
  mafia: 'event_mafia',
  politics: 'event_politics',
};

function buildingCues(prev: WorldSnapshot, state: GameState, blastLanded: boolean, out: Cue[]): void {
  const buildings = state.buildings.buildings;
  const built = buildings.find(b => !prev.buildings.has(b.id));
  if (built) {
    out.push({ sound: 'building_built', site: { entity: { kind: 'building', id: built.id }, point: { x: built.x, z: built.z } }, key: 'building_built', cooldownS: CD.built });
  }
  if (blastLanded) return;
  const present = new Set(buildings.map(b => b.id));
  for (const [id, spot] of prev.buildings) {
    if (present.has(id)) continue;
    out.push({ sound: 'building_demolished', site: { point: spot }, key: 'building_demolished', cooldownS: CD.demolished });
    break;
  }
}

function vehicleCues(prev: WorldSnapshot, state: GameState, blastLanded: boolean, out: Cue[]): void {
  const vehicles = state.vehicles.vehicles;
  const bought = vehicles.find(v => !prev.vehicles.has(v.id));
  if (bought) {
    out.push({ sound: 'vehicle_start', site: { entity: { kind: 'vehicle', id: bought.id }, point: { x: bought.x, z: bought.z } }, key: 'vehicle_start', cooldownS: CD.vehicleStart });
  }
  if (blastLanded) return;
  const present = new Set(vehicles.map(v => v.id));
  for (const [id, spot] of prev.vehicles) {
    if (present.has(id)) continue;
    out.push({ sound: 'vehicle_scrap', site: { point: spot }, key: 'vehicle_scrap', cooldownS: CD.vehicleScrap });
    break;
  }
}

/** One quiet chime when an action with no sound of its own finished; the others are heard as their result. */
function actionCue(prev: WorldSnapshot, state: GameState, out: Cue[]): void {
  const present = new Set(state.pendingActions.map(a => a.id));
  for (const [id, type] of prev.claimedActions) {
    if (present.has(id) || !listHas(DIFF_CONFIG.genericDoneActions, type)) continue;
    out.push({ sound: 'order_done', key: 'order_done', cooldownS: CD.orderDone });
    return;
  }
}

function holeCues(prev: WorldSnapshot, state: GameState, out: Cue[]): void {
  const drilled = state.drillHoles.find(h => !prev.holeIds.has(h.id));
  if (drilled) out.push({ sound: 'drill_done', site: { point: { x: drilled.x, z: drilled.z } }, key: 'drill_done', cooldownS: CD.drillDone });
  for (const hole of state.drillHoles) {
    if (state.chargesByHole[hole.id] === undefined || prev.chargedHoleIds.has(hole.id)) continue;
    out.push({ sound: 'charge_loaded', site: { point: { x: hole.x, z: hole.z } }, key: 'charge_loaded', cooldownS: CD.chargeLoaded });
    break;
  }
}

function surveyCue(prev: WorldSnapshot, state: GameState, out: Cue[]): void {
  if (state.surveyResults.length <= prev.surveyCount) return;
  const survey = state.surveyResults[state.surveyResults.length - 1];
  if (survey) out.push({ sound: 'survey_done', site: { point: { x: survey.centerX, z: survey.centerZ } }, key: 'survey_done', cooldownS: CD.surveyDone });
}

/** Coins for sales, contracts and bonuses, scaled by how much came in; upkeep and refunds are silent. */
function incomeCue(prev: WorldSnapshot, state: GameState, out: Cue[]): void {
  const transactions = state.finances.transactions;
  if (transactions.length <= prev.transactionCount) return;
  let total = 0;
  for (let i = prev.transactionCount; i < transactions.length; i++) {
    const transaction = transactions[i];
    if (transaction && transaction.type === 'income' && listHas(DIFF_CONFIG.incomeCategories, transaction.category)) total += transaction.amount;
  }
  const income = DIFF_CONFIG.income;
  if (total < income.minAmount) return;
  if (total >= income.tillAmount) out.push({ sound: 'cash_till', key: 'cash_till', cooldownS: income.bigCooldownS });
  else if (total >= income.bigAmount) out.push({ sound: 'coins_big', key: 'coins_big', cooldownS: income.bigCooldownS });
  else out.push({ sound: 'coins_small', key: 'coins_small', cooldownS: income.smallCooldownS });
}

function accidentCues(prev: WorldSnapshot, state: GameState, out: Cue[]): void {
  const fresh = state.damage.accidents.slice(prev.accidentCount);
  const hurt = fresh.find(a => a.type === 'injury' || a.type === 'death');
  if (!hurt) return;
  const worker = state.employees.employees.find(e => e.id === hurt.entityId);
  if (worker) {
    out.push({ sound: 'worker_collapse', site: { entity: { kind: 'employee', id: worker.id }, point: { x: worker.x, z: worker.z } }, key: 'worker_collapse', cooldownS: CD.collapse });
  }
  if (fresh.some(a => a.type === 'death')) out.push({ sound: 'notify_bad', key: 'notify_bad', cooldownS: CD.notifyBad });
}

function eventCues(prev: WorldSnapshot, state: GameState, categoryOf: (eventId: string) => string | undefined, out: Cue[]): boolean {
  const pending = state.events.pendingEvent;
  if (!pending) return false;
  if (`${pending.eventId}@${pending.firedAtTick}` === prev.pendingEventKey) return false;
  out.push({ sound: 'notify_alert', key: 'notify_alert', cooldownS: CD.eventAlert });
  const category = categoryOf(pending.eventId);
  const flourish = category === undefined ? undefined : EVENT_FLOURISH[category];
  if (flourish) out.push({ sound: flourish, key: flourish, cooldownS: CD.eventAlert, delayS: DIFF_CONFIG.eventAlert.flourishDelayS });
  return true;
}

function levelEndOf(prev: WorldSnapshot, state: GameState): 'win' | 'lose' | null {
  const reason = state.levelEndReason;
  if (reason === null || prev.levelEndReason !== null) return null;
  return reason === 'completed' ? 'win' : 'lose';
}

/**
 * What changed between `prev` and `state`, as cues. A jump of more than the
 * coalescing window (a load, a console skip, a restore) is not play: it yields
 * nothing so the caller just re-baselines.
 */
export function diffWorld(prev: WorldSnapshot, state: GameState, categoryOf: (eventId: string) => string | undefined): WorldDiff {
  const ticked = state.tickCount !== prev.tick;
  if (ticked && (state.tickCount < prev.tick || state.tickCount - prev.tick > DIRECTOR_CONFIG.maxCoalescedTicks)) return SILENT;

  const report = state.lastBlastReport;
  const blastLanded = report !== null && report !== prev.blastReport;
  const cues: Cue[] = [];
  buildingCues(prev, state, blastLanded, cues);
  vehicleCues(prev, state, blastLanded, cues);
  // An action that vanishes between commands was cancelled, not finished.
  if (ticked) actionCue(prev, state, cues);
  holeCues(prev, state, cues);
  surveyCue(prev, state, cues);
  incomeCue(prev, state, cues);
  if (!blastLanded) accidentCues(prev, state, cues);
  const eventAlert = eventCues(prev, state, categoryOf, cues);
  return { cues, blastLanded, levelEnd: levelEndOf(prev, state), eventAlert };
}
