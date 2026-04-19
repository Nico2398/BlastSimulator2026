---
name: navmesh
description: >
  NavMesh and pathfinding specification for BlastSimulator2026: 2D NavGrid derived from
  VoxelGrid surface, A* with 8-directional movement and octile heuristic, multi-level
  ramp routing, dynamic incremental updates after blasts, and atomic task breakdown.
  Use when implementing or modifying agent movement, pathfinding, ramps, or navgrid updates.
---

## Design Goals

Employees and vehicles navigate the mine surface autonomously, routing around drill holes, buildings, parked vehicles, and pit edges. As blasts create craters and benches, the navigable surface changes dynamically. Must be fast enough for 20+ simultaneous agents at 8× game speed without frame drops.

Implementation: **2D navigation grid** derived from VoxelGrid surface, refreshed incrementally after blasts. Full 3D pathfinding not required — vertical movement via dedicated ramps.

## Navigation Grid

The `NavGrid` is a 2D array of `NavCell` mirroring the VoxelGrid's X×Z footprint:

```typescript
export type NavCellType =
  | 'walkable'    // Open surface, clear of obstacles
  | 'blocked'     // Building footprint, parked vehicle, or pit edge
  | 'drill_hole'  // Active/drilled hole — agents avoid stepping in
  | 'ramp'        // Slope connecting bench levels; walkable with speed penalty
  | 'void';       // No solid voxel below — not accessible

export interface NavCell {
  type: NavCellType;
  moveCost: number;       // 1.0 = normal; >1.0 = slower
  benchLevel: number;     // 0 = surface, 1 = first bench below, etc.
  vehicleOccupied: boolean; // updated every tick
}
```

**Derivation rules:**
1. `void` if no solid voxel below surface at that column
2. `drill_hole` if a `DrillHole` exists at (x, z)
3. `blocked` if building footprint covers it, or vehicle parked/stationary
4. `ramp` if surface height delta to any neighbor > 1 voxel
5. All remaining solid-surface cells = `walkable`

**Move costs:**

| Cell Type | Cost |
|-----------|------|
| `walkable` | 1.0 |
| `ramp` | 1.8 |
| `drill_hole` | 5.0 (passable but discouraged) |
| `blocked` / `void` | ∞ (impassable) |

## A* Pathfinding

8-directional movement (cardinal + diagonal). Diagonal moves cost √2 × `moveCost`.

```typescript
export interface PathRequest {
  agentId: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  avoidVehicles: boolean;
}

export interface PathResult {
  found: boolean;
  waypoints: Array<{ x: number; z: number }>;
  totalCost: number;
}
```

**Heuristic — octile distance (standard for 8-directional grids):**
```
h(a, b) = max(|dx|, |dz|) + (√2 − 1) * min(|dx|, |dz|)
```

**Pathfinding budget:** capped at **500 explored nodes per request**. If exceeded → fallback to **direct line walk** (ignores non-`blocked`/`void` obstacles) + emits `pathfinding_budget_exceeded` dev warning.

## Ramps & Multi-Level Navigation

The pit descends in bench levels. Employees and vehicles access lower benches via **ramp structures** (building type `'ramp'`, footprint 1×4 cells, oriented N/S/E/W). Ramps appear as `ramp` cells bridging two bench levels.

Multi-level path planning:
1. Same bench level → standard A*
2. Different levels → find nearest ramp connecting required levels → 3-query route: `start → ramp entrance → ramp exit → destination`
3. No ramp exists for required levels → `found: false`, emit `no_ramp_available` event

## Dynamic NavGrid Updates

The NavGrid is **incrementally updated** — full rebuild is too expensive.

| Trigger | Region Updated |
|---------|---------------|
| Blast completes | All cells in blast AABB + 2-cell margin |
| Building placed or demolished | Building footprint cells |
| Vehicle parks or departs | Single cell |
| Drill hole added | Single cell |
| Ramp built | 1×4 footprint + adjacent cells |

Paths that cross an updated region are marked stale and re-requested next tick. Paths outside the region remain valid.

## Path Following & Stuck State

Agents move at most `walkSpeed` cells/tick toward next waypoint. If next waypoint becomes `blocked` mid-path → re-request from current position. After **3 consecutive failed re-requests** → `stuck` state:
- Idle, morale −2/tick
- Emits `agent_stuck` event
- Resumes when path clears

## Atomic Task Breakdown

| # | Task | File(s) |
|---|------|---------|
| 6.1 | Define `NavCell`, `NavCellType`, `NavGrid` interfaces | `src/core/nav/NavGrid.ts` (new) |
| 6.2 | Implement `buildNavGrid()` — derives NavGrid from VoxelGrid + buildings + holes | `src/core/nav/NavGrid.ts` |
| 6.3 | Implement `patchNavGrid()` — incremental update for a bounding box | `src/core/nav/NavGrid.ts` |
| 6.4 | Implement A* `findPath()` with 8-directional movement and octile heuristic | `src/core/nav/Pathfinding.ts` (new) |
| 6.5 | Implement node budget cap (500) and direct-line fallback | `src/core/nav/Pathfinding.ts` |
| 6.6 | Implement multi-level routing via ramp lookup | `src/core/nav/Pathfinding.ts` |
| 6.7 | Implement `advanceAgent()` — move agent 1 step along waypoints per tick | `src/core/nav/AgentMovement.ts` (new) |
| 6.8 | Implement stale-path detection and re-request on obstacle change | `src/core/nav/AgentMovement.ts` |
| 6.9 | Implement `stuck` state and `agent_stuck` event | `src/core/nav/AgentMovement.ts` |
| 6.10 | Integrate NavGrid build into `GameState` initialization | `src/core/state/GameState.ts` |
| 6.11 | Wire NavGrid patch calls into blast pipeline and building placement | `src/core/engine/GameLoop.ts` |
| 6.12 | Add i18n keys for pathfinding events (`agent_stuck`, `no_ramp_available`) | `src/core/i18n/locales/en.json`, `fr.json` |
