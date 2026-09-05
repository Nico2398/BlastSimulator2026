---
name: gameplay-navmesh
description: >
  NavMesh and pathfinding specification for BlastSimulator2026: 2D NavGrid derived from
  VoxelGrid surface, A* with 8-directional movement and octile heuristic, multi-level
  ramp routing, and dynamic incremental updates after blasts. Use when implementing or modifying agent movement, pathfinding, ramps, or navgrid updates.
---

## Design Goals

Employees + vehicles navigate mine surface autonomously, routing around drill holes, buildings, parked vehicles, pit edges. Blasts create craters + benches → navigable surface changes dynamically. Must handle 20+ simultaneous agents at 8× speed without frame drops.

**2D navigation grid** derived from VoxelGrid surface, refreshed incrementally after blasts. No full 3D pathfinding — vertical movement via dedicated ramps.

## Navigation Grid

The `NavGrid` is 2D array of `NavCell` covering VoxelGrid's live X×Z **bounding box**. The site grows as the player claims chunks (#473), so the grid carries `originX`/`originZ` alongside `width`/`height`: `cells` is indexed locally (`cells[z - originZ][x - originX]`) while every public query takes world coordinates. Use `cellAt(x, z)` / `setCellAt(x, z, cell)`; never index `cells` with a world coordinate. Columns inside the bounding box the site does not own — the notch a non-rectangular site leaves when its box is squared off — are `void`.

`src/core/nav/NavGrid.ts` declares `NavCellType` and `NavCell` (`type`, `moveCost` where 1.0 is normal and higher is slower, `benchLevel` counting down from 0 at the surface, `vehicleOccupied`) and is the authority on their fields — `vehicleOccupied` in particular carries a narrow contract stated there, not a general per-tick occupancy map.

**Derivation rules** — what each cell type means is what makes it that type:
1. `void` if no solid voxel below surface at that column
2. `drill_hole` if a `DrillHole` exists at (x, z)
3. `blocked` if building footprint covers it, or vehicle parked/stationary
4. `ramp` if surface height delta to any cardinal neighbor is more than 1 voxel and at most `NAV_MAX_CLIMB_HEIGHT` (balance.ts) — a negotiable grade
5. All remaining solid-surface cells = `walkable`

A delta beyond `NAV_MAX_CLIMB_HEIGHT` is a **face**, not a ramp, and does not classify the cell at all: the same cell is often walkable from one neighbour and a wall relative to another, so the refusal belongs to the step, not to the cell. `findPath` applies it per step (`isStepClimbable`, NavGrid.ts) on both the A* neighbour expansion and the direct-line fallback, and the reachability helpers below mirror it. This is what makes a fresh blast crater an obstacle rather than a gentle slope (#953): a bench face is `NAV_BENCH_HEIGHT` and a crater a hole-depth deeper, so both are out of reach and are descended by a dug ramp, while ordinary terrain relief stays ordinary.

**Move costs:**

| Cell Type | Cost |
|-----------|------|
| `walkable` | 1.0 |
| `ramp` | 1.8 |
| `drill_hole` | 5.0 (passable but discouraged) |
| `blocked` / `void` | ∞ (impassable) |

## A* Pathfinding

8-directional movement (cardinal + diagonal). Diagonal moves cost √2 × `moveCost`.

`src/core/nav/Pathfinding.ts` declares `PathRequest` (from/to in NavGrid cell space, plus `avoidVehicles`), `PathResult` (`found`, `waypoints`, `totalCost` — waypoints empty when `found` is false) and `RampConnection`. Read it before calling `findPath`.

**Heuristic — octile distance (standard for 8-directional grids):**
```
h(a, b) = max(|dx|, |dz|) + (√2 − 1) * min(|dx|, |dz|)
```

**Pathfinding budget:** capped at **500 explored nodes per request**. If exceeded → fallback to **direct line walk** (ignores non-`blocked`/`void` obstacles) + emits `pathfinding_budget_exceeded` dev warning.

## Ramps & Multi-Level Navigation

Pit descends in bench levels. Employees + vehicles access lower benches via **ramp structures** (building type `'ramp'`, footprint 1×4 cells, oriented N/S/E/W). Ramps appear as `ramp` cells bridging two bench levels.

Multi-level path planning:
1. Same bench level → standard A*
2. Different levels → find nearest ramp connecting required levels → 3-query route: `start → ramp entrance → ramp exit → destination`
3. No ramp for required levels → `found: false`, emit `no_ramp_available` event

A pit floor is therefore only workable once a ramp reaches it: dispatch queues haul/charge actions against fragments the crew cannot climb down to, and they sit unclaimed until one is dug. Level scripts and scenarios that blast a bench and then expect it hauled out have to build that ramp first (`level2-playthrough-win.json` does, at the rim, before its first blast).

## Dynamic NavGrid Updates

NavGrid is **incrementally updated** — full rebuild too expensive.

| Trigger | Region Updated |
|---------|---------------|
| Blast completes | All cells in blast AABB + 2-cell margin |
| Building placed or demolished | Building footprint cells |
| Vehicle parks or departs | Single cell |
| Drill hole added | Single cell |
| Ramp built | 1×4 footprint + adjacent cells |
| Site claims a chunk | Full rebuild over the new bounding box |

A claim is the one trigger that rebuilds rather than patches: the bounding box itself moved, so every cell's index changed. Expansion happens at human speed, which is what makes an O(area) rebuild cheaper than making A* chunk-aware (#473 D7).

Paths crossing updated region → marked stale, re-requested next tick. Paths outside region remain valid.

## Reachability Helpers

Two `NavGrid` static queries, beyond `findPath`, for picking a destination that isn't already known to be walkable:

- `findNearestTraversableCell(navGrid, x, z)` — nearest walkable/ramp/drill_hole cell to (x, z) by pure distance, searching outward in rings. Can land on a traversable pocket a blast crater walled off from the rest of the map with `void` on every side — distance-only, no connectivity check.
- `findNearestReachableCell(navGrid, anchorX, anchorZ, targetX, targetZ)` — BFS flood fill (8-directional adjacency, no climb gate) from an `anchorX/anchorZ` known to sit in the map's main connected region (a world corner works), returning the cell nearest `targetX/targetZ` that is actually path-connected to it. Use this, not `findNearestTraversableCell`, wherever a mover must be guaranteed to path away from the point afterward — e.g. snapping a new hire's or purchased vehicle's spawn point off a blast-cleared void or isolated pocket.
- `computeReachableSet(navGrid, anchorX, anchorZ)` / `computeClimbReachableSet(...)` — every cell connected to the anchor, without and with the per-step climb gate. The climb-aware one is the exact set a real `findPath` from that anchor can resolve against, which is what lets a caller screen candidate destinations without paying for a pathfind (`selectBestActionForEmployee`, ActionSelection.ts).
- `findNearestNavigableCell(navGrid, targetX, targetZ)` — nearest cell inside the grid's **largest climb-connected region**, with no anchor to assume. Spawn points are chosen before terrain exists (a staffed roster, a campaign level's literals), and with a climb limit in force a fixed coordinate can land on a one-cell island atop a peak. `regenerateGrid` snaps every employee and vehicle through this once the grid is built (`snapAgentsToNavigableGround`, GameState.ts); an agent already on the main ground is left untouched.

## Building Approach Cells

A building's entire footprint — including its `entryPoint`/`exitPoint` markers, which are cosmetic door offsets, not a walkability guarantee — classifies `blocked`. `findPath` rejects an impassable goal outright, so nothing can path onto a building's raw (x, z). `findBuildingApproachCell(navGrid, building, def, fromX, fromZ)` (`src/core/nav/BuildingApproach.ts`) finds the nearest walkable ring cell just outside the footprint, closest to the mover. Any destination that targets a building — rest routing, hauling delivery, shift-cycle sleep — resolves through this, never the building's own coordinates.

## Path Following & Stuck State

Agents move at most `walkSpeed` cells/tick toward next waypoint. Next waypoint becomes `blocked` mid-path → re-request from current position. After **3 consecutive failed re-requests** → `stuck` state:
- Idle, morale −2/tick
- Emits `agent_stuck` event
- Resumes when path clears

