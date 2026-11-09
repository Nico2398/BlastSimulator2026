// BlastSimulator2026 — Projection risk zones as terrain columns (#2201)

/** Unique ground columns holding projected voxels, sorted by x then z. */
export function projectionZoneColumns(
  positions: ReadonlyArray<{ x: number; y: number; z: number }>,
): Array<{ x: number; z: number }> {
  const seen = new Map<string, { x: number; z: number }>();
  for (const { x, z } of positions) seen.set(`${x},${z}`, { x, z });
  return [...seen.values()].sort((a, b) => a.x - b.x || a.z - b.z);
}
