// BlastSimulator2026 — Weather effects on mining operations
// Rain fills drill holes; water persists per hole until it seeps away. Tubing makes a hole watertight.

/** Per-hole water state. */
export interface HoleWater {
  /** Water level as a fraction of hole depth (0 = dry, 1 = full). */
  level: number;
  /** Rock porosity at the hole (0..1); porous rock fades water slower. */
  porosity: number;
}

/** One tick of water change in a hole: rain fills it, ground wetness seeps in, fade drains it. */
export function advanceHoleWater(
  _hw: HoleWater,
  _rain: number,
  _groundWetness: number,
  _tubed: boolean,
): HoleWater {
  // TODO: implement
  return undefined as unknown as HoleWater;
}

/** One tick of ground wetness change: rises with rain, decays when dry. */
export function advanceGroundWetness(_wetness: number, _rain: number): number {
  // TODO: implement
  return undefined as unknown as number;
}

/** True when a water level (fraction of depth) is past HOLE_WET_THRESHOLD. */
export function isHoleFlooded(_level: number): boolean {
  // TODO: implement
  return undefined as unknown as boolean;
}
