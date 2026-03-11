// BlastSimulator2026 — Drill plan definition
// A drill plan is a set of holes. Each hole has position, depth, and diameter.

export interface DrillHole {
  id: string;
  /** Surface position X. */
  x: number;
  /** Surface position Z. */
  z: number;
  /** Hole depth in meters/voxels. */
  depth: number;
  /** Hole diameter in meters (real drill holes: 75–150mm). */
  diameter: number;
}

let nextHoleId = 1;

/** Reset hole ID counter (for tests). */
export function resetHoleIds(): void {
  nextHoleId = 1;
}

/** Create a grid drill pattern. */
export function createGridPlan(
  origin: { x: number; z: number },
  rows: number,
  cols: number,
  spacing: number,
  depth: number,
  diameter: number,
): DrillHole[] {
  const holes: DrillHole[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      holes.push({
        id: `H${nextHoleId++}`,
        x: origin.x + c * spacing,
        z: origin.z + r * spacing,
        depth,
        diameter,
      });
    }
  }
  return holes;
}

/** Add a single hole to an existing plan. */
export function addHole(
  holes: DrillHole[],
  x: number,
  z: number,
  depth: number,
  diameter: number,
): DrillHole {
  const hole: DrillHole = { id: `H${nextHoleId++}`, x, z, depth, diameter };
  holes.push(hole);
  return hole;
}
