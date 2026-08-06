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
   * When set, the selection *is* this rectangle — the player does not have to
   * reproduce it. Any click or drag that lands in the live area snaps to these
   * corners, so a guided step lands on the one placement it is teaching rather
   * than on whatever the player's drag happened to cover (#489: "the player has
   * too much freedom in the tutorial").
   */
  exact?: boolean;
}

/**
 * Tiles of slack around an exact region in which the pointer still responds.
 *
 * An exact region is often a single tile or a one-tile-wide line, and asking a
 * player to land a 3D pick on that is asking them to thread a needle. The
 * snapping above means precision buys nothing anyway, so the live area is the
 * region grown by this much and every click inside it produces the same answer.
 */
export const EXACT_LIVE_MARGIN = 3;

/** The area the pointer responds in: the region itself, grown when it is exact. */
export function liveArea(region: TileRegion): TileRegion {
  if (!region.exact) return { x1: region.x1, z1: region.z1, x2: region.x2, z2: region.z2 };
  return {
    x1: region.x1 - EXACT_LIVE_MARGIN, z1: region.z1 - EXACT_LIVE_MARGIN,
    x2: region.x2 + EXACT_LIVE_MARGIN, z2: region.z2 + EXACT_LIVE_MARGIN,
  };
}

/** Centre tile of a region, for framing the camera on it. */
export function regionCenter(region: TileRegion): { x: number; z: number } {
  return {
    x: Math.round((region.x1 + region.x2) / 2),
    z: Math.round((region.z1 + region.z2) / 2),
  };
}

/** Widest side of a region in tiles — how far back the camera has to sit to show it. */
export function regionSpan(region: TileRegion): number {
  return Math.max(region.x2 - region.x1, region.z2 - region.z1) + 1;
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
