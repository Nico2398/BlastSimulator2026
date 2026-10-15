import type { GameState, PendingAction } from '../state/GameState.js';
import { pickReachableColumn } from '../mining/WorkTarget.js';

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
  let moved = 0;
  for (const ramp of state.plannedRamps) {
    const lead = ramp.segments.find(s => !s.done);
    if (lead === undefined) continue;
    const action = state.pendingActions.find(a => a.id === lead.actionId);
    if (action === undefined || action.status !== 'queued') continue;
    if (canReach(action, action.targetX, action.targetZ)) continue;

    const anchor = { x: action.targetX, z: action.targetZ };
    const reach = (x: number, z: number) => canReach(action, x, z);
    const own = distinctColumns(lead.cells);
    // Fallback: the carve acts on the segment's cells wherever the digger
    // stands, so any reachable column of the already-built part will do.
    const pick = pickReachableColumn(own, anchor, reach)
      ?? pickReachableColumn(distinctColumns(ramp.segments.flatMap(s => (s === lead ? [] : s.cells))), anchor, reach);
    if (pick === null) continue;
    action.targetX = pick.x;
    action.targetZ = pick.z;
    moved++;
  }
  return moved;
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
