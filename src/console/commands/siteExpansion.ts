// BlastSimulator2026 — Site expansion for off-site actions (#473 D5/P2)
//
// Every action that can land outside the site — a drill hole, a ramp, a
// building, a survey — routes through here first. Expansion is never
// implicit: the action asks for the ground, and either gets it or gets a
// reason it cannot have it. An off-site action that silently did nothing was
// the old dense grid's behaviour, and it is indistinguishable from a bug.

import { buildGameNavGrid, syncWorldBounds } from '../../core/state/GameState.js';
import type { ClaimRefusalReason } from '../../core/world/PlayableArea.js';
import type { GameContext } from './world.js';

export interface ClaimOutcome {
  /** False when at least one cell was refused — the caller must abort the action. */
  ok: boolean;
  /** Player-facing refusal text. Only set when `ok` is false. */
  output?: string;
  /** True when the site actually grew. */
  expanded: boolean;
}

const REFUSAL_TEXT: Record<ClaimRefusalReason, string> = {
  protected_structure: 'protected ground — a village, river or landmark stands there and the site can never take it',
  not_adjacent: 'out of bounds — the site can only grow into ground that touches it',
  too_far: 'too far — the site cannot bridge that much ground in a single action',
  expansion_disabled: 'outside the site, and this site cannot be expanded',
};

/**
 * Bring every cell an action touches onto the site, or refuse the whole
 * action. All-or-nothing: a drill grid half on protected ground is refused
 * entirely rather than left with holes.
 *
 * On success the navgrid is rebuilt over the site's new bounding box (#473
 * D7 — expansion happens at human speed, so an O(area) rebuild per claim is
 * cheaper than making A* chunk-aware) and a `terrain:updated` covering the
 * claimed ground is emitted so the renderer meshes it.
 */
export function claimForAction(
  ctx: GameContext,
  cells: ReadonlyArray<{ x: number; z: number }>,
  what: string,
): ClaimOutcome {
  const { state, grid, playableArea } = ctx;
  if (!state || !grid || !playableArea) return { ok: true, expanded: false };

  const offSite = cells.filter(c => !playableArea.contains(Math.floor(c.x), Math.floor(c.z)));
  if (offSite.length === 0) return { ok: true, expanded: false };

  let claimedMinX = Infinity, claimedMinZ = Infinity, claimedMaxX = -Infinity, claimedMaxZ = -Infinity;
  let expanded = false;

  for (const cell of offSite) {
    const result = playableArea.claim(Math.floor(cell.x), Math.floor(cell.z));
    if (!result.claimed) {
      return {
        ok: false,
        expanded,
        output: `Cannot ${what} at (${Math.floor(cell.x)}, ${Math.floor(cell.z)}): ${REFUSAL_TEXT[result.reason]}.`,
      };
    }
    if (result.alreadyOwned) continue;
    expanded = true;
    claimedMinX = Math.min(claimedMinX, result.rect.minX);
    claimedMinZ = Math.min(claimedMinZ, result.rect.minZ);
    claimedMaxX = Math.max(claimedMaxX, result.rect.maxX);
    claimedMaxZ = Math.max(claimedMaxZ, result.rect.maxZ);
  }

  if (!expanded) return { ok: true, expanded: false };

  syncWorldBounds(state, grid);
  buildGameNavGrid(state, grid, state.buildings.buildings, state.drillHoles);
  // Padded one voxel past the claim on every side: the chunks that were
  // already built next to it sealed themselves against empty space, and those
  // walls have to come down now that there is ground on the other side.
  ctx.emitter.emit('terrain:updated', {
    region: {
      minX: claimedMinX - 1, minY: 0, minZ: claimedMinZ - 1,
      maxX: claimedMaxX, maxY: grid.sizeY - 1, maxZ: claimedMaxZ,
    },
  });

  return { ok: true, expanded: true };
}

/** Every integer column a rect (max inclusive) covers — the cell list an area action claims. */
export function cellsInRect(minX: number, minZ: number, maxX: number, maxZ: number): Array<{ x: number; z: number }> {
  const cells: Array<{ x: number; z: number }> = [];
  for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
    for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) cells.push({ x, z });
  }
  return cells;
}

/**
 * Every integer column within `radius` of (centerX, centerZ) — the cell list
 * a disc-shaped action (e.g. a blast danger zone) claims (#558).
 *
 * TODO: implement — this is a skeleton stub for the test-writer/implementer.
 */
export function cellsInDisc(centerX: number, centerZ: number, radius: number): Array<{ x: number; z: number }> {
  void centerX;
  void centerZ;
  void radius;
  throw new Error('not implemented');
}
