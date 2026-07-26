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
