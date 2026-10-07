// BlastSimulator2026 — Mafia gameplay mechanics
// Actions: arrange "accidents", frame employees, smuggling.
// Each has cost, success probability, exposure risk.

import type { Random } from '../math/Random.js';
import { queueFollowUp, type EventSystemState } from './EventSystem.js';
import type { CorruptionState } from '../economy/Corruption.js';
import type { GameState } from '../state/GameState.js';
import type { EmployeeState } from '../entities/Employee.js';
import { killEmployee } from '../entities/Employee.js';
import { releaseEmployeeFromWorld, fireEmployeeFromWorld } from '../engine/TaskCancellation.js';
import {
  ACCIDENT_EXPOSURE,
  ACCIDENT_FAILURE_EXPOSURE_EXTRA,
  FRAMING_START_EXPOSURE,
  FRAMING_DETECTED_EXPOSURE,
  SMUGGLING_EXPOSURE_PER_TICK,
  INVESTIGATION_EXPOSURE_JUMP,
  INVESTIGATION_FOLLOWUP_EVENT_ID,
  EXPOSURE_CLEAN_GRACE_TICKS,
  EXPOSURE_DECAY_PER_TICK,
  SMUGGLING_EXPOSED_FINE,
  SMUGGLING_EXPOSED_EXPOSURE_JUMP,
} from '../config/balance.js';

// ── Config ──

const ACCIDENT_COST = 10000;
const ACCIDENT_SUCCESS_RATE = 0.7;
const FRAME_COST = 5000;
const FRAME_SUCCESS_RATE = 0.6;
const FRAME_EVIDENCE_TICKS = 10;
const SMUGGLE_BASE_INCOME = 8000;
const SMUGGLE_EXPOSURE_RISK = 0.15;

// ── Exposure tracking ──

export interface MafiaState {
  exposureRisk: number; // 0-1, accumulates
  smugglingActive: boolean;
  smugglingIncome: number;
  pendingFrames: PendingFrame[];
  /** Tick of the last mafia action or smuggling activity; drives exposure decay (#1411). */
  lastActivityTick: number;
}

export interface PendingFrame {
  employeeId: number;
  startTick: number;
  readyTick: number;
}

export function createMafiaState(): MafiaState {
  return {
    exposureRisk: 0,
    smugglingActive: false,
    smugglingIncome: 0,
    pendingFrames: [],
    lastActivityTick: 0,
  };
}

// ── Actions ──

export interface MafiaActionResult {
  success: boolean;
  cost: number;
  exposureIncrease: number;
  outcomeKey: string;
  outcomeParams?: Record<string, string | number>;
  investigationTriggered: boolean;
}

/** Add (or, if negative, remove) exposure, clamped to 0-1; returns the delta actually applied. */
export function applyExposure(mafia: MafiaState, nominal: number): number {
  const before = mafia.exposureRisk;
  mafia.exposureRisk = Math.min(1, Math.max(0, before + nominal));
  return mafia.exposureRisk - before;
}

/**
 * Arrange an "accident" for a troublesome employee.
 * Success: employee removed. Failure: investigation event.
 */
export function arrangeAccident(
  mafia: MafiaState,
  state: GameState,
  _corruption: CorruptionState,
  targetId: number,
  rng: Random,
): MafiaActionResult {
  const employees = state.employees;
  const emp = employees.employees.find(e => e.id === targetId);
  if (!emp || !emp.alive) {
    return { success: false, cost: 0, exposureIncrease: 0,
      outcomeKey: 'mafia.target_not_found', investigationTriggered: false };
  }

  mafia.lastActivityTick = state.tickCount;
  const succeeded = rng.chance(ACCIDENT_SUCCESS_RATE);

  if (succeeded) {
    const exposureIncrease = applyExposure(mafia, ACCIDENT_EXPOSURE);
    killEmployee(employees, targetId);
    releaseEmployeeFromWorld(state, targetId);
    return {
      success: true, cost: ACCIDENT_COST, exposureIncrease,
      outcomeKey: 'mafia.accident_success', outcomeParams: { name: emp.name },
      investigationTriggered: false,
    };
  }

  const exposureIncrease = applyExposure(mafia, ACCIDENT_EXPOSURE + ACCIDENT_FAILURE_EXPOSURE_EXTRA);
  return {
    success: false, cost: ACCIDENT_COST, exposureIncrease,
    outcomeKey: 'mafia.accident_failed', outcomeParams: { name: emp.name },
    investigationTriggered: true,
  };
}

/**
 * Frame an employee for a crime to justify firing (even unionized).
 * Requires planting evidence (cost + time).
 */
export function startFraming(
  mafia: MafiaState,
  employees: EmployeeState,
  targetId: number,
  currentTick: number,
): MafiaActionResult {
  const emp = employees.employees.find(e => e.id === targetId);
  if (!emp || !emp.alive) {
    return { success: false, cost: 0, exposureIncrease: 0,
      outcomeKey: 'mafia.target_not_found', investigationTriggered: false };
  }

  mafia.pendingFrames.push({
    employeeId: targetId,
    startTick: currentTick,
    readyTick: currentTick + FRAME_EVIDENCE_TICKS,
  });

  mafia.lastActivityTick = currentTick;
  const exposureIncrease = applyExposure(mafia, FRAMING_START_EXPOSURE);

  return {
    success: true, cost: FRAME_COST, exposureIncrease,
    outcomeKey: 'mafia.frame_started', outcomeParams: { name: emp.name, ticks: FRAME_EVIDENCE_TICKS },
    investigationTriggered: false,
  };
}

/**
 * Complete a framing. Can fire even unionized employees.
 * Probabilistic: may be detected.
 */
export function completeFrame(
  mafia: MafiaState,
  state: GameState,
  targetId: number,
  currentTick: number,
  rng: Random,
): MafiaActionResult {
  const frameIdx = mafia.pendingFrames.findIndex(
    f => f.employeeId === targetId && currentTick >= f.readyTick,
  );
  if (frameIdx < 0) {
    return { success: false, cost: 0, exposureIncrease: 0,
      outcomeKey: 'mafia.frame_no_ready', investigationTriggered: false };
  }

  mafia.pendingFrames.splice(frameIdx, 1);
  mafia.lastActivityTick = currentTick;

  if (rng.chance(FRAME_SUCCESS_RATE)) {
    fireEmployeeFromWorld(state, targetId, { force: true });
    return {
      success: true, cost: 0, exposureIncrease: 0,
      outcomeKey: 'mafia.frame_success',
      investigationTriggered: false,
    };
  }

  const exposureIncrease = applyExposure(mafia, FRAMING_DETECTED_EXPOSURE);
  return {
    success: false, cost: 0, exposureIncrease,
    outcomeKey: 'mafia.frame_detected',
    investigationTriggered: true,
  };
}

/**
 * Start/stop smuggling operation. Generates income but increases exposure.
 */
export function toggleSmuggling(mafia: MafiaState): { active: boolean; incomePerTick: number } {
  mafia.smugglingActive = !mafia.smugglingActive;
  mafia.smugglingIncome = mafia.smugglingActive ? SMUGGLE_BASE_INCOME : 0;
  return { active: mafia.smugglingActive, incomePerTick: mafia.smugglingIncome };
}

/**
 * Process smuggling per tick. Returns income earned and whether exposure triggered.
 */
export function processSmuggling(
  mafia: MafiaState,
  rng: Random,
  tick: number,
): { income: number; exposed: boolean } {
  if (!mafia.smugglingActive) return { income: 0, exposed: false };

  mafia.lastActivityTick = tick;
  applyExposure(mafia, SMUGGLING_EXPOSURE_PER_TICK);
  const exposed = rng.chance(SMUGGLE_EXPOSURE_RISK * mafia.exposureRisk);

  return { income: mafia.smugglingIncome, exposed };
}

/**
 * Smuggling got caught (#1411): exposure jumps, the operation ends and activity is stamped
 * so decay does not start right after the spike. Returns the fine the caller must charge.
 */
export function applySmugglingExposure(mafia: MafiaState, tick: number): { fine: number } {
  applyExposure(mafia, SMUGGLING_EXPOSED_EXPOSURE_JUMP);
  mafia.smugglingActive = false;
  mafia.smugglingIncome = 0;
  mafia.lastActivityTick = tick;
  return { fine: SMUGGLING_EXPOSED_FINE };
}

/**
 * Check if exposure has reached critical level (leads to criminal charges).
 */
export function isExposed(mafia: MafiaState, rng: Random): boolean {
  return rng.chance(mafia.exposureRisk * 0.05); // 5% of exposure risk per check
}

export { ACCIDENT_COST, ACCIDENT_SUCCESS_RATE, FRAME_COST, FRAME_SUCCESS_RATE, FRAME_EVIDENCE_TICKS, SMUGGLE_BASE_INCOME };

/** Botched action triggers a police investigation: bumps exposure, queues follow-up event. Returns exposure added (#1411). */
export function applyInvestigation(mafia: MafiaState, events: EventSystemState, tick?: number): number {
  const added = applyExposure(mafia, INVESTIGATION_EXPOSURE_JUMP);
  if (tick !== undefined) mafia.lastActivityTick = tick;
  // One pending investigation is enough: repeated botches still raise exposure, not the queue.
  if (!events.followUpQueue.includes(INVESTIGATION_FOLLOWUP_EVENT_ID)) {
    queueFollowUp(events, INVESTIGATION_FOLLOWUP_EVENT_ID);
  }
  return added;
}

/** Decay exposure risk after a clean grace period without activity (#1411). */
export function decayExposure(mafia: MafiaState, tick: number): void {
  if (mafia.smugglingActive) return;
  if (tick - (mafia.lastActivityTick ?? 0) < EXPOSURE_CLEAN_GRACE_TICKS) return;
  mafia.exposureRisk = Math.max(0, mafia.exposureRisk - EXPOSURE_DECAY_PER_TICK);
}
