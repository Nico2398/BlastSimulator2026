// BlastSimulator2026 — Mafia gameplay mechanics
// Actions: arrange "accidents", frame employees, smuggling.
// Each has cost, success probability, exposure risk.

import type { Random } from '../math/Random.js';
import type { CorruptionState } from '../economy/Corruption.js';
import type { EmployeeState } from '../entities/Employee.js';
import { killEmployee } from '../entities/Employee.js';

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
  };
}

// ── Actions ──

export interface MafiaActionResult {
  success: boolean;
  cost: number;
  exposureIncrease: number;
  message: string;
  investigationTriggered: boolean;
}

/**
 * Arrange an "accident" for a troublesome employee.
 * Success: employee removed. Failure: investigation event.
 */
export function arrangeAccident(
  mafia: MafiaState,
  employees: EmployeeState,
  _corruption: CorruptionState,
  targetId: number,
  rng: Random,
): MafiaActionResult {
  const emp = employees.employees.find(e => e.id === targetId);
  if (!emp || !emp.alive) {
    return { success: false, cost: 0, exposureIncrease: 0,
      message: 'Target not found', investigationTriggered: false };
  }

  const exposureIncrease = 0.1;
  mafia.exposureRisk = Math.min(1, mafia.exposureRisk + exposureIncrease);

  if (rng.chance(ACCIDENT_SUCCESS_RATE)) {
    killEmployee(employees, targetId);
    return {
      success: true, cost: ACCIDENT_COST, exposureIncrease,
      message: `A tragic "accident" befell ${emp.name}. Very unfortunate.`,
      investigationTriggered: false,
    };
  }

  return {
    success: false, cost: ACCIDENT_COST, exposureIncrease: exposureIncrease + 0.1,
    message: `The "accident" was botched. ${emp.name} is suspicious. Police may investigate.`,
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
      message: 'Target not found', investigationTriggered: false };
  }

  mafia.pendingFrames.push({
    employeeId: targetId,
    startTick: currentTick,
    readyTick: currentTick + FRAME_EVIDENCE_TICKS,
  });

  const exposureIncrease = 0.05;
  mafia.exposureRisk = Math.min(1, mafia.exposureRisk + exposureIncrease);

  return {
    success: true, cost: FRAME_COST, exposureIncrease,
    message: `Evidence is being planted against ${emp.name}. Ready in ${FRAME_EVIDENCE_TICKS} ticks.`,
    investigationTriggered: false,
  };
}

/**
 * Complete a framing. Can fire even unionized employees.
 * Probabilistic: may be detected.
 */
export function completeFrame(
  mafia: MafiaState,
  employees: EmployeeState,
  targetId: number,
  currentTick: number,
  rng: Random,
): MafiaActionResult {
  const frameIdx = mafia.pendingFrames.findIndex(
    f => f.employeeId === targetId && currentTick >= f.readyTick,
  );
  if (frameIdx < 0) {
    return { success: false, cost: 0, exposureIncrease: 0,
      message: 'No ready frame for this employee', investigationTriggered: false };
  }

  mafia.pendingFrames.splice(frameIdx, 1);

  if (rng.chance(FRAME_SUCCESS_RATE)) {
    const idx = employees.employees.findIndex(e => e.id === targetId);
    if (idx >= 0) employees.employees.splice(idx, 1);
    return {
      success: true, cost: 0, exposureIncrease: 0,
      message: 'Evidence was convincing. Employee terminated for cause.',
      investigationTriggered: false,
    };
  }

  const exposureIncrease = 0.15;
  mafia.exposureRisk = Math.min(1, mafia.exposureRisk + exposureIncrease);
  return {
    success: false, cost: 0, exposureIncrease,
    message: 'The frame was detected! Internal affairs is investigating.',
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
): { income: number; exposed: boolean } {
  if (!mafia.smugglingActive) return { income: 0, exposed: false };

  mafia.exposureRisk = Math.min(1, mafia.exposureRisk + 0.02);
  const exposed = rng.chance(SMUGGLE_EXPOSURE_RISK * mafia.exposureRisk);

  return { income: mafia.smugglingIncome, exposed };
}

/**
 * Check if exposure has reached critical level (leads to criminal charges).
 */
export function isExposed(mafia: MafiaState, rng: Random): boolean {
  return rng.chance(mafia.exposureRisk * 0.05); // 5% of exposure risk per check
}

export { ACCIDENT_COST, FRAME_COST, SMUGGLE_BASE_INCOME };
