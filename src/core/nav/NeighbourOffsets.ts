// BlastSimulator2026 — shared 8-directional neighbour adjacency
//
// Pathfinding's A* neighbour expansion and NavGridReachability's flood fill
// both walk the same 8-directional grid adjacency, so they share one
// constant rather than each declaring an identical array.

/** 4-directional (cardinal) neighbour offsets as [dx, dz] pairs. */
export const NEIGHBOUR_OFFSETS_4: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** 8-directional neighbour offsets as [dx, dz] pairs: 4 cardinal, 4 diagonal. */
export const NEIGHBOUR_OFFSETS_8: readonly [number, number][] = [
  ...NEIGHBOUR_OFFSETS_4,
  [-1, -1], [1, -1], [-1, 1], [1, 1], // diagonal
];
