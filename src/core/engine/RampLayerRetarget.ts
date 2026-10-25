import type { GameState, PendingAction, PlannedRamp, RampSegmentTracker } from '../state/GameState.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { pickReachableColumn } from '../mining/WorkTarget.js';

type Column = { x: number; z: number };

/** Column lists tried in order (nearest reachable of the first non-empty hit wins) for one unreachable lead. */
type CandidateStrategy = (ramp: PlannedRamp, lead: RampSegmentTracker) => ReadonlyArray<ReadonlyArray<Column>>;

/**
 * Shared driver: for each planned ramp whose never-claimed lead layer sits on an unreachable
 * target, move it to the nearest reachable column of the strategy's candidate lists. Returns the number moved.
 */
function retargetLeads(
  state: Pick<GameState, 'plannedRamps' | 'pendingActions'>,
  canReach: (action: PendingAction, x: number, z: number) => boolean,
  candidatesFor: CandidateStrategy,
): number {
  let moved = 0;
  for (const ramp of state.plannedRamps) {
    const lead = ramp.segments.find(s => !s.done);
    if (lead === undefined) continue;
    const action = state.pendingActions.find(a => a.id === lead.actionId);
    if (action === undefined || action.status !== 'queued') continue;
    if (canReach(action, action.targetX, action.targetZ)) continue;

    const anchor = { x: action.targetX, z: action.targetZ };
    const reach = (x: number, z: number) => canReach(action, x, z);
    let pick: Column | null = null;
    for (const columns of candidatesFor(ramp, lead)) {
      pick = pickReachableColumn(columns, anchor, reach);
      if (pick !== null) break;
    }
    if (pick === null) continue;
    action.targetX = pick.x;
    action.targetZ = pick.z;
    moved++;
  }
  return moved;
}

/**
 * Move the lead `dig_ramp_segment` layer of each planned ramp onto the nearest
 * column `canReach` accepts. Returns the number of layers moved.
 *
 * The layer's order-time target is its band centre, which can be a fill cell
 * the digger cannot reach where the ramp crosses a crater; any column of the
 * layer's own cells stands in for it. When none of those is reachable (a ramp
 * ordered from intact ground ending inside a dug crater), the nearest reachable
 * column of the ramp's other segments stands in. Only a never-claimed lead is moved.
 */
export function retargetRampLayers(
  state: Pick<GameState, 'plannedRamps' | 'pendingActions'>,
  canReach: (action: PendingAction, x: number, z: number) => boolean,
): number {
  return retargetLeads(state, canReach, (ramp, lead) => {
    const own = distinctColumns(lead.cells);
    // Fallback: the carve acts on the segment's cells wherever the digger
    // stands, so any reachable column of the already-built part will do.
    // Own columns were already probed, so they are left out of the fallback.
    const probed = new Set(own.map(c => `${c.x},${c.z}`));
    const others = distinctColumns(ramp.segments.flatMap(s => (s === lead ? [] : s.cells)))
      .filter(c => !probed.has(`${c.x},${c.z}`));
    return [own, others];
  });
}

/**
 * Second chance for a lead layer `retargetRampLayers` left unreachable (#2082): the nearest reachable
 * column beside the layer's own cells, where the digger can stand and carve it, else beside the ramp's
 * other segments — a digger left on a crater floor carves a ramp that lands flush beside it from its
 * foot (#2045). Never a column of the ramp itself (`retargetRampLayers` probed those). Only a queued lead is moved.
 */
export function retargetBesideRampLayers(
  state: Pick<GameState, 'plannedRamps' | 'pendingActions'>,
  canReach: (action: PendingAction, x: number, z: number) => boolean,
): number {
  return retargetLeads(state, canReach, (ramp, lead) => {
    const seen = new Set(distinctColumns(ramp.segments.flatMap(s => s.cells)).map(c => `${c.x},${c.z}`));
    const besideOwn = besideColumns(distinctColumns(lead.cells), seen);
    const besideOthers = besideColumns(distinctColumns(ramp.segments.flatMap(s => (s === lead ? [] : s.cells))), seen);
    return [besideOwn, besideOthers];
  });
}

/** The 8-neighbours of `columns` not yet in `seen`, each once; every one returned is added to `seen`. */
function besideColumns(columns: readonly Column[], seen: Set<string>): Column[] {
  const beside: Column[] = [];
  for (const c of columns) {
    for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
      const key = `${c.x + dx},${c.z + dz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beside.push({ x: c.x + dx, z: c.z + dz });
    }
  }
  return beside;
}

function distinctColumns(cells: readonly { x: number; z: number }[]): { x: number; z: number }[] {
  const seen = new Set<string>();
  const columns: { x: number; z: number }[] = [];
  for (const cell of cells) {
    const key = `${cell.x},${cell.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push({ x: cell.x, z: cell.z });
  }
  return columns;
}
