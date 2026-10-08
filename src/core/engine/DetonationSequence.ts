// BlastSimulator2026 — Detonation sequence (#1362): arm, evacuate, fire.
// DETONATE arms the sequence: the danger zone is evacuated, late entrants are
// re-ordered out on an interval, and the caller fires once the zone is clear.

import type { GameState } from '../state/GameState.js';
import { computeDangerZone, defineZone, isDangerZoneClear, isInZone } from '../entities/Zone.js';
import { evacuateZone } from './Evacuation.js';
import { t } from '../i18n/I18n.js';
import { BLAST_DANGER_MARGIN_M, DETONATION_REEVACUATE_INTERVAL_TICKS } from '../config/balance.js';

/** Armed-detonation record held on GameState while the site is being cleared. */
export interface PendingDetonation {
  armedTick: number;
  strandedEmployeeIds: number[];
  strandedVehicleIds: number[];
  lastEvacuationTick: number;
}

export type DetonationPhase =
  | { kind: 'idle' }
  | { kind: 'evacuating'; remaining: number }
  | { kind: 'stranded'; names: string[] }
  | { kind: 'ready' };

type DetonationResult<T> = { success: true; data: T } | { success: false; error: string };

/** Order the zone evacuated; returns the ids that could not be moved. */
function orderEvacuation(state: GameState): { employees: number[]; vehicles: number[] } | null {
  const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
  if (zone === null) return null;
  defineZone(state.zone, zone);
  const result = evacuateZone(state, state.zone.activeZone!);
  return { employees: result.strandedEmployeeIds, vehicles: result.strandedVehicleIds };
}

/** Arm the detonation and order the danger zone evacuated. */
export function armDetonation(state: GameState): DetonationResult<PendingDetonation> {
  if (state.pendingDetonation !== null) {
    return { success: false, error: t('mining.blast.detonation_already_armed') };
  }
  const planned = state.plannedChargesByHole;
  const charged = state.drillHoles.some(h => state.chargesByHole[h.id] !== undefined || planned[h.id] !== undefined);
  if (!charged) return { success: false, error: t('mining.blast.no_charged_holes') };
  const stranded = orderEvacuation(state);
  if (stranded === null) return { success: false, error: t('mining.blast.no_charged_holes') };
  const pending: PendingDetonation = {
    armedTick: state.tickCount,
    strandedEmployeeIds: stranded.employees,
    strandedVehicleIds: stranded.vehicles,
    lastEvacuationTick: state.tickCount,
  };
  state.pendingDetonation = pending;
  return { success: true, data: pending };
}

/** Cancel an armed detonation. True when one was armed. */
export function cancelDetonation(state: GameState): boolean {
  const wasArmed = state.pendingDetonation !== null;
  state.pendingDetonation = null;
  return wasArmed;
}

/** Pure read of the current phase. */
export function detonationPhase(state: GameState): DetonationPhase {
  const pending = state.pendingDetonation;
  if (pending === null) return { kind: 'idle' };
  if (isDangerZoneClear(state.drillHoles, state.vehicles, state.employees)) return { kind: 'ready' };

  const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
  if (zone === null) return { kind: 'ready' };
  const strandedEmps = new Set(pending.strandedEmployeeIds);
  const strandedVehs = new Set(pending.strandedVehicleIds);
  let remaining = 0;
  const names: string[] = [];
  for (const emp of state.employees.employees) {
    if (!emp.alive || !isInZone(emp.x, emp.z, zone)) continue;
    if (strandedEmps.has(emp.id)) names.push(emp.name);
    else remaining++;
  }
  for (const v of state.vehicles.vehicles) {
    if (!isInZone(v.x, v.z, zone)) continue;
    if (strandedVehs.has(v.id)) names.push(t(`vehicle_type.${v.type}`));
    else remaining++;
  }
  if (remaining === 0 && names.length > 0) return { kind: 'stranded', names };
  return { kind: 'evacuating', remaining: remaining + names.length };
}

/** Advance the sequence one tick and return the resulting phase. */
export function tickDetonation(state: GameState): DetonationPhase {
  const pending = state.pendingDetonation;
  if (pending === null) return { kind: 'idle' };
  if (state.drillHoles.length === 0) {
    state.pendingDetonation = null;
    return { kind: 'idle' };
  }
  if (state.tickCount - pending.lastEvacuationTick >= DETONATION_REEVACUATE_INTERVAL_TICKS
    && !isDangerZoneClear(state.drillHoles, state.vehicles, state.employees)) {
    const stranded = orderEvacuation(state);
    if (stranded !== null) {
      pending.lastEvacuationTick = state.tickCount;
      pending.strandedEmployeeIds = [...new Set([...pending.strandedEmployeeIds, ...stranded.employees])];
      pending.strandedVehicleIds = [...new Set([...pending.strandedVehicleIds, ...stranded.vehicles])];
    }
  }
  return detonationPhase(state);
}
