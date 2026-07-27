// BlastSimulator2026 — Tutorial picker constraint
//
// The tile picker is opened by the panel that needs it, not by the tutorial, so
// there is nowhere to pass a constraint down through. This is the handoff: the
// tutorial publishes the area the current step expects, and the picker reads it
// when it opens.
//
// Set at the start of a step rather than when the picker's stage goes live —
// the picker opens on the click that *ends* the previous stage, so a constraint
// published on stage change would arrive a beat too late.

/** An inclusive rectangle of tiles. */
export interface TileRegion {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /**
   * When set, the selection must be this rectangle and nothing else — being
   * inside it is not enough. Used where the step is teaching a specific layout
   * rather than a general area, so the outline is the answer rather than a
   * suggestion. The picker clamps to the rectangle in this mode, so a player who
   * overshoots the corners lands on it instead of missing by a tile.
   */
  exact?: boolean;
}

let active: TileRegion | null = null;

/** Publish the area the current tutorial step expects, or null to lift it. */
export function setPickerRegion(region: TileRegion | null): void {
  active = region ? { ...region } : null;
}

/** The area the picker must keep the player inside, if any. */
export function getPickerRegion(): TileRegion | null {
  return active ? { ...active } : null;
}

/** Whether a tile falls inside a region. */
export function regionContains(region: TileRegion, x: number, z: number): boolean {
  return x >= region.x1 && x <= region.x2 && z >= region.z1 && z <= region.z2;
}

/** Whether an entire selection falls inside a region. */
export function regionContainsSelection(
  region: TileRegion,
  sel: { x1: number; z1: number; x2: number; z2: number },
): boolean {
  return regionContains(region, sel.x1, sel.z1) && regionContains(region, sel.x2, sel.z2);
}

/** Whether a selection is exactly the region, corner for corner. */
export function regionEqualsSelection(
  region: TileRegion,
  sel: { x1: number; z1: number; x2: number; z2: number },
): boolean {
  return sel.x1 === region.x1 && sel.z1 === region.z1
    && sel.x2 === region.x2 && sel.z2 === region.z2;
}

/**
 * Whether a selection satisfies a region — exactly equal when the region
 * demands it, otherwise merely inside.
 */
export function regionAccepts(
  region: TileRegion,
  sel: { x1: number; z1: number; x2: number; z2: number },
): boolean {
  return region.exact
    ? regionEqualsSelection(region, sel)
    : regionContainsSelection(region, sel);
}

/** Pull a tile into a region, so an overshooting drag lands on the boundary. */
export function clampToRegion(
  region: TileRegion,
  x: number,
  z: number,
): { x: number; z: number } {
  return {
    x: Math.min(region.x2, Math.max(region.x1, x)),
    z: Math.min(region.z2, Math.max(region.z1, z)),
  };
}
