// BlastSimulator2026 — Crater access sync (#2082)
// Per-tick step: orders one ramp down to the most stranded crater floor. Core never plans a ramp
// otherwise, so a blast that deepens the pit past the built ramp would strand its rubble and holes for good.
// Holes and patterns are never touched here: they stay queued until access exists.

import {
  CRATER_ACCESS_CASH_RESERVE_TICKS, CRATER_ACCESS_CLUSTER_GAP_CELLS, CRATER_ACCESS_MIN_STRANDED_ORDERS,
  CRATER_ACCESS_RECHECK_TICKS, RAMP_DEFAULT_WIDTH,
} from '../config/balance.js';
import { isProgressionSite, type GameState } from '../state/GameState.js';
import { getOperatingCostPerHour } from '../economy/OperatingFinance.js';
import { slowestVehicleTierSlopeRatio } from '../nav/ClimbLimit.js';
import { clusterStrandedFloors, planCraterAccess, type AccessSurface, type StrandedFloor } from '../mining/CraterAccess.js';
import { defineRampSegments } from '../mining/Ramp.js';
import { rampFootprint } from '../mining/RampWidening.js';
import { queueRampOrder } from '../mining/RampOrder.js';
import { computeVoxelColumnSurfaceHeight, type VoxelGrid } from '../world/VoxelGrid.js';
import { siteVehicleReach, strandedDebrisTargets } from './OrderReachability.js';

interface Cursor {
  /** Tick of the last scan. */
  tick: number;
  /** Nav revision and floors of the last scan that found no affordable plan; the same world is not re-planned. */
  failedSignature: string | null;
}

/** Derived, never saved: a fresh state simply scans on its next recheck. */
const cursors = new WeakMap<GameState, Cursor>();

function floorsSignature(revision: number, floors: readonly StrandedFloor[]): string {
  return `${revision}|${floors.map(f => `${f.x},${f.z},${f.floorY},${f.orderCount}`).join(';')}`;
}

/**
 * Stranded floors with each target's y read from the terrain (rubble tops sit above the floor).
 * A stamp lags the world: a ramp that just connected the crater leaves its orders stamped until the next
 * classification sweep, so a target the vehicle network reaches now is not stranded and is skipped.
 */
function strandedFloors(state: GameState, grid: VoxelGrid, surface: AccessSurface): StrandedFloor[] {
  const cells = strandedDebrisTargets(state)
    .filter(t => !surface.reachableFrom(Math.round(t.x), Math.round(t.z)))
    .map(t => {
      const y = computeVoxelColumnSurfaceHeight(grid, Math.round(t.x), Math.round(t.z));
      return { x: t.x, z: t.z, y: Number.isFinite(y) ? y : t.y };
    });
  return clusterStrandedFloors(cells, CRATER_ACCESS_CLUSTER_GAP_CELLS)
    .filter(f => f.orderCount >= CRATER_ACCESS_MIN_STRANDED_ORDERS)
    .sort((a, b) => b.orderCount - a.orderCount);
}

function accessSurface(state: GameState, grid: VoxelGrid): AccessSurface | null {
  const reach = siteVehicleReach(state);
  const nav = state.navGrid;
  if (reach === null || nav === null) return null;
  return {
    heightAt: (x, z) => computeVoxelColumnSurfaceHeight(grid, x, z),
    contains: (x, z) => grid.containsColumn(x, z) && (nav.cellAt(x, z)?.type ?? 'void') !== 'void',
    reachableFrom: reach,
  };
}

/** Orders at most one access ramp down to the stranded floor with the most orders; no-op until the world changes or cash allows. */
export function syncCraterAccess(state: GameState, grid?: VoxelGrid | null): void {
  if (!grid || state.navGrid === null || !isProgressionSite(state)) return;
  const cursor = cursors.get(state);
  if (cursor !== undefined && state.tickCount - cursor.tick < CRATER_ACCESS_RECHECK_TICKS && state.tickCount >= cursor.tick) return;
  const next: Cursor = { tick: state.tickCount, failedSignature: cursor?.failedSignature ?? null };
  cursors.set(state, next);

  if (state.pendingActions.some(a => a.type === 'dig_ramp_segment')) return;
  const surface = accessSurface(state, grid);
  if (surface === null) return;
  const floors = strandedFloors(state, grid, surface);
  if (floors.length === 0) { next.failedSignature = null; return; }
  const signature = floorsSignature(state.navGrid.revision, floors);
  if (signature === next.failedSignature) return;

  const reserve = getOperatingCostPerHour(state).payroll * CRATER_ACCESS_CASH_RESERVE_TICKS;
  let affordabilityBlocked = false;
  for (const floor of floors) {
    const plan = planCraterAccess(floor, surface, slowestVehicleTierSlopeRatio(), RAMP_DEFAULT_WIDTH);
    if (!plan.ok) continue;
    if (state.cash - plan.cost < reserve) { affordabilityBlocked = true; continue; }
    const segments = defineRampSegments(grid, plan.def);
    const footprint = rampFootprint(plan.def, RAMP_DEFAULT_WIDTH);
    if (queueRampOrder(state, plan.def, footprint, segments, plan.cost, 'Crater access ramp') !== null) return;
  }
  // Only a world with nothing buildable is remembered; an unaffordable plan is retried as cash changes.
  next.failedSignature = affordabilityBlocked ? null : signature;
}
