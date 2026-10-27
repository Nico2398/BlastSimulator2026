// BlastSimulator2026 — Unit tests: the ladder drops holes buried under rubble nobody can haul (#2091)

import { describe, it, expect } from 'vitest';
import { holesBuriedForGood } from '../../../scripts/shared/probe-strategies.js';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

function frag(id: number, x: number, z: number): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: 0.3, mass: 1000, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 }, shapeSeed: id, origin: { x, y: 0, z },
  };
}

function order(id: number, type: PendingAction['type'], payload: Record<string, unknown>, blockedReason: PendingAction['blockedReason'] = null): PendingAction {
  return {
    id, type, requiredSkill: null, requiredVehicleRole: null, targetX: 0, targetZ: 0, targetY: 0, payload,
    targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0, blockedReason,
  } as PendingAction;
}

/** A progression site with hole h1 at (10, 10) buried under fragment 501, and h2 at (20, 20) drilled clear. */
function site(haulBlocked: PendingAction['blockedReason']): GameState {
  const state = createGame({ seed: 42 });
  state.grade = createGradeState();
  state.plannedDrillHoles.push({ id: 'h1', x: 10, z: 10, depth: 6, diameter: 0.089 });
  addBlastFragments(state.logistics, [frag(501, 10, 10)], null);
  state.pendingActions.push(
    order(1, 'drill_hole', { holeId: 'h1', x: 10, z: 10 }, 'buried_under_rubble'),
    order(2, 'haul_debris', { fragmentId: 501 }, haulBlocked),
  );
  return state;
}

describe('holesBuriedForGood (#2091)', () => {
  it('lists a buried hole whose burying rubble no crew can reach', () => {
    expect(holesBuriedForGood(site('debris_out_of_reach'))).toEqual(['h1']);
  });

  it('lists nothing while a crew can still haul the burying rubble', () => {
    expect(holesBuriedForGood(site(null))).toEqual([]);
  });

  it('lists nothing when no hole is buried', () => {
    const state = site('debris_out_of_reach');
    state.pendingActions = state.pendingActions.filter(a => a.type !== 'drill_hole');
    expect(holesBuriedForGood(state)).toEqual([]);
  });
});
