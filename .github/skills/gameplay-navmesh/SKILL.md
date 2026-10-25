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
4. `ramp` if the slope to any cardinal neighbor exceeds `NAV_RAMP_MIN_SLOPE_DELTA` but stays within `NAV_MAX_SLOPE_DEGREES`/`NAV_MAX_SLOPE_RATIO` (balance.ts) — a negotiable grade, one measure for cardinal (1.0m run) and diagonal (√2m run) steps alike
5. All remaining solid-surface cells = `walkable`

A slope beyond `NAV_MAX_SLOPE_DEGREES` (30°) is a **face**, not a ramp, and does not classify the cell at all: the same cell is often walkable from one neighbour and a wall relative to another, so the refusal belongs to the step, not to the cell. `findPath` applies it per step (`isStepClimbable`, NavGrid.ts) on both the A* neighbour expansion and the direct-line fallback, and the reachability helpers below mirror it. This is what makes a fresh blast crater an obstacle rather than a gentle slope (#953): a bench face is `NAV_BENCH_HEIGHT` and a crater a hole-depth deeper, so both are out of reach and are descended by a dug ramp, while ordinary terrain relief stays ordinary.

**Move costs:**

| Cell Type | Cost |
|-----------|------|
| `walkable` | 1.0 |
| `ramp` | 1.8 |
| `drill_hole` | 5.0 (passable but discouraged) |
| `blocked` / `void` | ∞ (impassable) |

## A* Pathfinding

8-directional movement (cardinal + diagonal). Diagonal moves cost √2 × `moveCost`.

**Diagonal corner rule (#1197):** a diagonal step from `(x, z)` to `(x+dx, z+dz)` is legal only
when both orthogonal cells it passes between — `(x+dx, z)` and `(x, z+dz)` — are neither
`blocked` nor `void`. Applied identically in A*'s neighbour expansion and in the direct-line
fallback: a route never clips a solid corner even when the diagonal's own destination cell is
walkable, so two buildings that touch only at a corner force a route around it, never between
them. Checks solidity only — vehicle occupancy and clearance (#1154) play no part, and the
agent's own start cell keeps its usual exemption.

`src/core/nav/Pathfinding.ts` declares `PathRequest` (from/to in NavGrid cell space, plus `avoidVehicles`), `PathResult` (`found`, `waypoints`, `totalCost` — waypoints empty when `found` is false) and `RampConnection`. Read it before calling `findPath`.

**Heuristic — octile distance (standard for 8-directional grids):**
```
h(a, b) = max(|dx|, |dz|) + (√2 − 1) * min(|dx|, |dz|)
```

**Pathfinding budget:** the first search is capped at `pathfindingNodeBudget` (half the grid, at least 500 nodes) with the heuristic inflated by `ASTAR_HEURISTIC_WEIGHT`. When it runs out with frontier left it retries once on a whole-grid budget **with the plain, consistent heuristic** (octile × the cheapest move cost, #2045): no cell is expanded twice, so that retry is a complete search. The inflated weight re-opens cells, and on a 20° site a cross-map road out of a pit ran a whole-grid budget dry before it found the ramp. Only then → fallback to **direct line walk** (ignores non-`blocked`/`void` obstacles).

## Ramps & Multi-Level Navigation

Pit descends in bench levels. Employees + vehicles access lower benches via **ramps**, corridors dug N/S/E/W. A ramp is a **terrain feature, not a building** (#1298): it is never in `state.buildings`, has no tier or occupants, is not destructible, and never blocks the navmesh — it only appears as `ramp` cells bridging two bench levels.

**Width is per ramp.** The player picks one of `RAMP_WIDTH_OPTIONS` (3, 5, 7; default `RAMP_DEFAULT_WIDTH`) at construction (`build_ramp ... width:N`); the corridor is `floor(width/2)` voxels either side of the axis. Cost is `length × width × RAMP_COST_PER_METER_PER_WIDTH`, and dig time scales with the number of cells to clear. A finished ramp is recorded in `state.builtRamps` (`BuiltRamp`: id, def, width, footprint — `src/core/mining/RampWidening.ts`), which is what makes it selectable. `orderRampWiden(state, grid, rampId, toWidth)` (console `widen_ramp id:N width:M`) charges only the extra width and queues only the side strips, carved to the existing corridor's floor line (anchored on the axis column's step-0 surface), not to the terrain beside it. Every footprint cell takes its own headroom and its own cut-or-fill decision, so a ramp on ground sloping across it comes out level from side to side; cancelling it refunds the unworked cost and the ramp keeps its old width. Selecting a ramp offers widen only — no demolish, upgrade or move.

Multi-level path planning:
1. Same bench level → standard A*
2. Different levels → find nearest ramp connecting required levels → 3-query route: `start → ramp entrance → ramp exit → destination`
3. No ramp for required levels → `found: false`, emit `no_ramp_available` event

A ramp connection (`findRampConnections`) requires `isStepClimbable` steps from the ramp cell to BOTH its upper and lower neighbour; a cliff-adjacent `ramp` cell is omitted (#1305). The ordinary search distinguishes an empty open set (genuine wall: straight to the multi-level fallback) from an exhausted node budget: on exhaustion it retries once with `pathfindingRetryNodeBudget` (full grid area, `PATHFINDING_RETRY_BUDGET_AREA_DIVISOR`) before the ramp fallback, so a long switchback is routed ordinarily.

**Ramp-layer work target follows the digger's reach.** A `dig_ramp_segment` layer is ordered with its band centre as work target, which on a ramp crossing a crater can be a fill cell above nothing the digger can stand next to. Each reachability pass (`classifyQueuedOrders`, via `retargetRampLayers` in `src/core/engine/RampLayerRetarget.ts`) moves the lead, still-queued layer of every planned ramp onto the nearest reachable column of its own cells (`pickReachableColumn`, `src/core/mining/WorkTarget.ts`), so the verdict, ghost, `blockedReason` and dispatcher all read one target. When no column of the layer's own cells is reachable (a ramp ordered from intact ground ending inside a dug crater), it falls back to the nearest reachable column among the ramp's other segments' cells, since the carve acts on the segment's cells wherever the digger stands. A reachable centre is left alone; a claimed layer is never moved.

**Flush ramp ends (#1852, #2043, #2045).** A vehicle enters and leaves a ramp with no step at either end. The top: the line is anchored on the origin column's continuous ground, so the first cell joins the ground behind it (#2043). The foot: when the end row (`rampEndRow`, the `width` tiles one step past the foot, across the last leg) is a dug floor, at least `RAMP_CRATER_MIN_DROP_M` below the start ground, the ramp lands on it (`landRampOnEndFloor` / `landRampOnGrid`, `Ramp.ts`): the line drops exactly to the floor of that row (`rampEndRowGround`), whatever depth was asked, a chosen grade included (it keeps its grade and runs level once it reaches the floor). The floor is the level most of the row shares (`modalLevel`, tiles within `RAMP_LANDING_LEVEL_M` of one another are one level, the lower level on a tie), so neither a lump a blast left on the row nor a hole bottom a charge left in it is what the foot meets. **Decision (#2045): the ordered depth is only an input for a trench into intact ground; a ramp onto a floor is validated, and recorded, at the floor's real depth.** A ramp too short (or a grade too gentle) to reach the floor within the cut limit is refused with the ordinary `slope_too_steep` / `grade_too_gentle` text, never cut with a step at its foot. Every order path lands: the console `build_ramp` / `ramp spiral` (`orderRampDef`), `buildRamp`, and the ramp tool's readout and Confirm gate (ground read through the spiral seam's continuous heights). A widen order keeps the line already cut. The ramp tool strip says where the foot lands (`src/ui/rampFootLine.ts`).

**Ramp repair (#2045).** A shot that cuts into a ramp, or deepens the floor at its foot, leaves steps a vehicle cannot climb, and the inspector's climb line reads "Too steep for vehicles". A ramp counts as damaged only when its ground strays from its line by more than `RAMP_REPAIR_TOLERANCE_M` in shape (the spread of ground minus line across its columns): a line re-anchored on a ground another order nudged sits off by the same hair everywhere and drives as before, and two chained ramps would otherwise re-order each other's repair forever. A damaged ramp is re-cut whole. Keeping a ramp out of a shot, or repairing it after one, is the player's job; core never repairs a ramp by itself. `repair_ramp id:N` (and the inspector's Repair action, shown with its cost once a shot left anything to fix) re-cuts the built ramp to its line landed again on the floor its end row shows now (`quoteRampRepair` / `orderRampRepair`, `src/core/mining/RampRepair.ts`): cells standing above the line are cut, cells blown out below it are filled. Only the cells off the line are queued, paid `RAMP_REPAIR_COST_PER_CELL` each, as a planned ramp with `repairOf` that `recordBuiltRamp` folds back into the same built ramp. Refused when the ramp is intact, when other work on it is under way, when the cash falls short, and when the floor a later shot deepened is out of the ramp's reach within the cut limit (then the player needs a longer ramp).

**Multi-leg ramps (#1939).** A ramp may turn: a path of straight cardinal legs from `RampDef.originX/Z`, joined at corner landings. Geometry is the pure leaf `src/core/mining/RampPath.ts`; `RampDef.legs` (optional, two or more) and `gradeDegrees` (optional) extend the def, with `direction`/`length` = first leg / total, and a def without `legs` is one leg, so old saves load unchanged (no save version bump).

- Console `build_ramp path:<x>,<z>;<x>,<z>;… depth:<m> width:<3|5|7> [grade:<deg>]` (`legsFromWaypoints`: floors coordinates, refuses diagonal and zero-length legs, merges collinear same-direction legs, two waypoints = a straight ramp). `path:` cannot be combined with start/end/origin/direction/length.
- The centreline runs origin to the last waypoint exclusive; total length is the sum of legs. Each interior waypoint gets a width x width landing square belonging to the leg leaving the corner, whose tiles take the step of the centreline they sit on or nearest to (so the centreline keeps its constant grade through the corner), then every off-centreline tile's step is relaxed to within one step per metre of its 4/8 neighbours (`smoothOffCentreSteps`), so the inside of the turn no longer jumps several steps between adjacent tiles; the only remaining excess is the 8-neighbour diagonal that cuts the corner, at most sqrt(2) x the ordered grade; no tile is emitted twice. Cost is `totalLength x width x RAMP_COST_PER_METER_PER_WIDTH` (corners counted once).
- Refusals (`validateRampOrder`, console adds building and parse errors): leg shorter than the width (`leg_too_short`), legs overlapping, crossing or reversing (`legs_cross`, strict: any claimed tile shared outside a corner landing), total over `MAX_RAMP_LENGTH` (checked before any cells are built), grade over `atan(RAMP_CUT_SLOPE_RATIO)` (`grade_too_steep`) or under `atan(depth/total)` (`grade_too_gentle`), a leg over a built or planned building (`leg_hits_building`, console).
- Grade: default is `atan(depth/total)`, identical to a straight ramp today, including the end-floor snap. A chosen steeper grade floors at `min(depth, step x tan(grade))` and skips the snap (`rampFloorDepthAt`, `rampGradeBoundsDegrees`).
- Digging reuses the one carve path: `defineRampSegments` takes the corridor cells from `rampPathCells` and emits leg by leg, top-down within a leg, with contiguous indices. A multi-leg layer's anchor snaps to its nearest contributing cell (the band centre can fall in the corner's empty inside).
- Recording: one `BuiltRamp` carrying `def.legs`; its `footprint` is the bounding box, but hit-testing (`findRampAtTile`), placement reservations and `rampSteepestGradeDegrees` use the per-leg rects (`rampFootprintRects`), so the L's empty corner is neither selectable nor reserved nor graded.
- Widening is straight ramps only: `validateWidenRamp`/`orderRampWiden` refuse a multi-leg ramp with `mining.widen_ramp.multi_leg`; the inspector shows Widen disabled with the reason. The inspector adds Legs and Grade rows; the selection sub-line adds the leg count.
- The 3D ramp arrow draws one arrow per leg (`rampLegSpecs`, `src/renderer/RampArrow.ts`); leg k's origin is the corner tile where it starts.

**Spiral ramp (#1940).** `ramp spiral from:<x>,<z> depth:<m> grade:<deg> width:<3|5|7> [dir:cw|ccw] [preview]` proposes a multi-leg road down a pit wall. Pure planner `src/core/mining/RampSpiral.ts` (`proposeRampSpiral`) reads only `heightAt` and `contains`; without `preview` the proposal becomes a `RampDef` ordered by the multi-leg tail (`orderRampDef`).
- Pit detection: void = claimed tiles at least `RAMP_CRATER_MIN_DROP_M` below the start tile's ground, flood-filled (4-connected, bounded by `RAMP_SPIRAL_MAX_PIT_SPAN_M`) from the start's neighbours. The start must sit on the rim: outside the void and next to it. Refusals: `outside_area`, `bad_depth`, grade invalid / `grade_too_steep` (existing keys), `start_in_void` (every cardinal ray meets higher ground), `not_on_rim` (void nearby, none adjacent), `no_pit` (no void, or the fill outgrows the span; reports the minimum drop).
- Layout: a single ring (one lap) round the void's bounding rectangle, so pits are treated as rectangles. Corridor edge is at least `RAMP_SPIRAL_RIM_GAP_WIDTHS x width` tiles (Chebyshev) from the void; the corridor must stay inside the claimed area. The road refuses when one lap cannot fit the length the grade needs. There are no extra laps: the closing side may run on past the last corner by `RAMP_SPIRAL_CLOSING_RUN_WIDTHS x width`.
- Start: the nearest point on the ring to the start tile, kept at least one width from each end of its side. `cw` runs east, south, west, north (+z south); `ccw` runs the sides the other way (west, south, east, north from the top).
- Length: `ceil(depth / tan(grade))`, last leg trimmed to it (never under one width). A grade needing more than `MAX_RAMP_LENGTH` refuses with `too_long` (`needed`/`max`). Otherwise offered length counts whole metres of corridor inside the claim; too short refuses with `needed`/`offered`: "This grade needs {needed} m of wall; this pit offers {offered} m. Widen the pit or steepen the road." Self-crossing is checked with `findRampPathFault`.
- Cost is `computeRampCost(totalLength, width)`; `laps` is always 1.

**Ramp tool (#1942).** The Build panel's Ramp button arms `src/ui/RampTool.ts`; it only collects clicks and calls the core helpers.
- Path: shape `path` in `PlacementController`. The first click is the start (dragging from it to a different tile ends the ramp there); each later click adds a corner snapped to the previous corner's dominant axis (`snapToCardinal`, ties go to z); a click on the last tile is ignored. Backspace or the Undo corner button (`data-action="ramp-undo-corner"`) drops the last corner. Two corners order `build_ramp start:A end:B ...`; three or more order `build_ramp path:x,z;x,z;... depth width [grade]`. A lone corner leaves Confirm disabled.
- Grade: a stepper (1 degree) beside depth and width. Automatic until touched (no `grade:` argument; the field shows the planned grade, `plannedRampGradeDegrees`). Once set it is clamped to `rampGradeBoundsDegrees` (tenth-degree steps) and re-clamped when a corner is undone or the depth changes. **Decision (#2045): the ceiling is core's cut-slope maximum for the site (`atan(rampCutSlopeRatio(progression))`: about 19.6° on a progression site, 29.4° elsewhere), not a literal limit.** `RampDef.cutSlopeRatio` records the ratio a ramp was ordered at (absent on old saves: the old 29.4° ratio). Inert under the tutorial's exact region.
- Readout above the strip: `describeRampPlan` (length, legs, cost from `validateRampOrder`, grade) and, on progression sites only, one climbable line (`climbForGrade`, `RampGrade.ts`): "Vehicles can climb it (max 20°)" or "Too steep for vehicles (max 20°)". **Decision (#2045): one line, no tiers; every vehicle has the same limit.**
- Spiral: the Spiral button (`data-action="ramp-spiral"`) shows with exactly one corner on a pit rim tile (`isPitRim`; not inside a hollow and next to a void tile), terrain read through `spiralSurfaceFrom` (the same seam as the console command, supplied by `UIManager.setSpiralSurfaceProvider`). Pressing it previews `proposeRampSpiral`'s legs as the ghost, or shows its refusal text and disables Confirm. **Decision: the direction is always `cw`.** **Decision (#2045): with the grade on automatic, the preview starts at the steepest grade the ceiling allows and gentles by tenth-degree steps until the pit fits a road, so the road is the shortest that fits; a grade the player touched is proposed as is.** Confirm orders `ramp spiral from:x,z depth:d grade:g width:w dir:cw` with the proposal's grade.
- Foot line (`rampFootLine`) reads the last leg: its start and end ground tiles and the depth still left to drop over it.

A pit floor is therefore only workable once a ramp reaches it: dispatch queues haul/charge actions against fragments the crew cannot climb down to, and they sit unclaimed until one is dug. Level scripts and scenarios that blast a bench and then expect it hauled out have to build that ramp first (`level2-playthrough-win.json` does, at the rim, before its first blast).

**Crater access is the player's job (#2082, #2095).** Blasts deepen the pit below the built ramps; a floor the vehicles cannot climb to strands its rubble (`debris_out_of_reach`) and buries its planned holes (`buried_under_rubble`). Core never orders, pays for or digs a way in by itself, never drops those orders and never moves a cut-off vehicle or worker. **Decision (#2095): core explains, the player acts.**
- The orders keep their blocked reason, so the pip and Operations read "build a ramp or level the ground to haul them, or leave them". Holes stay queued and the pattern is never cleared.
- `findStrandedCrew` (`src/core/engine/StrandedCrew.ts`, read-only) names a driverless vehicle no employee licensed for it can walk to, and an on-foot employee outside the largest group of mutually reachable employees. The notification centre toasts each one once, by name, and shows one "CUT OFF" pip naming all of them while it lasts. A vehicle nobody on the roster may drive is not listed (that is a hiring problem).
- `planCraterAccess` (`src/core/mining/CraterAccess.ts`) is a pure planner nothing in the tick calls. The progression probe uses it to play the player (`orderCraterAccess`, `scripts/shared/probe-crater-access.ts`): every 50 ticks it clusters the stranded order targets (`strandedDebrisTargets`, the verdicts classification already stamped; `clusterStrandedFloors`, gap `CRATER_ACCESS_CLUSTER_GAP_CELLS`) into floors of at least 3 orders, plans the largest floor first and orders the plan through the console `build_ramp path:` command. One access ramp at a time (a queued, unheld segment stamped blocked is not live work), and none the cash cannot cover with 200 ticks of payroll to spare. A world that planned nothing is not re-planned until the nav grid or the floors change.
- The floor of a cluster is the level most of its orders lie on (`modalLevel`), not the deepest member: a charge leaves hole bottoms below the floor its rubble mostly lies on, and a ramp down to a hole frees almost none of it (#2045).
- The planner finds the shortest straight ramp of default width, from a cell a vehicle reaches from the rally point (`siteVehicleReach`; an existing ramp's foot counts), ending on floor-level ground at grade <= `CRATER_ACCESS_MAX_GRADE_MARGIN` (0.9) x the vehicle limit. Lengths rise across every foot at once: the floor's own cell, then each floor-level cell within `CRATER_ACCESS_CLUSTER_GAP_CELLS` of it, nearest first (#2045), so a foot at the crater's edge beats a long road to its middle. Every backend's plan must land on the floor: the level most of its end row shares (`modalLevel`) within `CRATER_ACCESS_FLOOR_LEVEL_M` (0.5 m) of the floor's depth, and still validate once landed; the returned plan is the landed def. With no straight start it falls back to `proposeRampSpiral` from a reachable pit-rim tile (pit span within `RAMP_SPIRAL_MAX_PIT_SPAN_M`, up to `CRATER_ACCESS_SPIRAL_START_ATTEMPTS` rim tiles). It refuses (never throws) with `mining.crater_access.no_start` / `too_shallow` (floor under `RAMP_CRATER_MIN_DROP_M`).
- Exclusions (#2045): a plan never cuts through a dug ramp's corridor or the end row its foot lands on (the cut would leave that ramp too steep), never runs a corridor over a tile its surface leaves out (`AccessSurface.contains`: off the claimed area; the probe also leaves out built and planned building footprints), and never fills more than one voxel layer over a tile holding rubble (`AccessSurface.holdsRubble`), which would bury the rubble it is meant to free.
- The probe, as a careful player, also sets aside a plan whose dug corridor would cut more than a few cells of today's vehicle network off from the rally point (`keepsVehicleNetwork`: a trench along the one gentle slope off the rally plateau walls the rally and its depots off from every pit) and plans the floor again. It keeps its shots off built ramps (`rampKeepOutZones`, footprint plus `RAMP_SHOT_KEEP_OUT_M`), repairs a ramp a shot damaged (`repair_ramp`) and cancels a repair whose segments went out of every digger's reach.
- Spirals from a hollow start (#2086): `SpiralRequest.fromReachable` (and `isPitRim(..., true)`) lets a start on reachable ground inside a wider hollow (a ledge, a built ramp's foot) count as a rim when a deeper void lies beside it. `planCraterAccess` always sets it, budgets `CRATER_ACCESS_SPIRAL_START_ATTEMPTS` per start height, measures the drop from the ring's first tile (not from the start), and accepts a spiral only when its foot touches floor-level ground; otherwise it ends the ring near its tail and cuts one straight leg across the pit wall to floor-level ground (a grade-set ramp runs level past its depth, so the longer road keeps its grade).
- Stuck ramps (#2085): the caller passes the footprints of planned ramps whose every remaining segment is blocked as `avoid`, and a straight or spiral plan overlapping one is rejected (the next candidate or floor is tried).
- Plans that would free nothing (#2085): a plan identical to a built ramp (`state.builtRamps`) is skipped, and a spiral whose foot has no floor-level ground (within `CRATER_ACCESS_FLOOR_LEVEL_M`) inside `(RAMP_SPIRAL_RIM_GAP_WIDTHS + 1) x width` tiles is rejected: round a pit nested in a wider one the spiral rings the outer pit and ends beside nothing, so the floor is unplannable.
- A walk-only pin (`walkOnlyPinnedBy`) on a queued order is dropped once the pinned employee can no longer serve it (`releaseUnservableWalkPins`, e.g. the vehicle was upgraded to a tier their licence does not cover); a permanent target is untouched.
- Rubble is an obstacle to every walk, evacuation and rest trips included (#954/#1090, #2094): a worker a rubble ring boxes in reads `stranded` and the armed shot waits for the player to clear a path or fire anyway.
- Ramp reachability and the executor agree on rubble: component labelling ignores fragment occupancy and a drive leg paths with `avoidVehicles: false`, so a ramp column buried under fragments is reachable; only haul orders on a genuinely sealed cell stay `debris_out_of_reach`.
- A ramp layer none of whose own or sibling columns the digger reaches falls back to a column beside its cells (`retargetBesideRampLayers`), rather than staying `target_unreachable`.

## Dynamic NavGrid Updates

NavGrid is **incrementally updated** — full rebuild too expensive.

| Trigger | Region Updated |
|---------|---------------|
| Blast completes | All cells in blast AABB + 2-cell margin |
| Building ordered, placed, upgraded, moved, cancelled, or demolished | Building footprint cells |
| Vehicle parks or departs | Single cell |
| Drill hole added | Single cell |
| Ramp built or widened | Corridor footprint (`rampFootprint`) + adjacent cells |
| Site claims a chunk | Full rebuild over the new bounding box |

A claim is the one trigger that rebuilds rather than patches: the bounding box itself moved, so every cell's index changed. Expansion happens at human speed, which is what makes an O(area) rebuild cheaper than making A* chunk-aware (#473 D7).

Paths crossing updated region → marked stale, re-requested next tick. Paths outside region remain valid.

## Reachability Helpers

Two `NavGrid` static queries, beyond `findPath`, for picking a destination that isn't already known to be walkable:

- `findNearestTraversableCell(navGrid, x, z)` — nearest walkable/ramp/drill_hole cell to (x, z) by pure distance, searching outward in rings. Can land on a traversable pocket a blast crater walled off from the rest of the map with `void` on every side — distance-only, no connectivity check.
- `findNearestReachableCell(navGrid, anchorX, anchorZ, targetX, targetZ)` — BFS flood fill (8-directional adjacency, no climb gate) from an `anchorX/anchorZ` known to sit in the map's main connected region (a world corner works), returning the cell nearest `targetX/targetZ` that is actually path-connected to it. Use this, not `findNearestTraversableCell`, wherever a mover must be guaranteed to path away from the point afterward — e.g. snapping a new hire's or purchased vehicle's spawn point off a blast-cleared void or isolated pocket.
- `computeReachableSet(navGrid, anchorX, anchorZ)` / `computeClimbReachableSet(...)` — every cell connected to the anchor, without and with the per-step climb gate. The climb-aware one is the exact set a real `findPath` from that anchor can resolve against, which is what lets a caller screen candidate destinations without paying for a pathfind (`selectBestActionForEmployee`, ActionSelection.ts).
- `computeClimbReachableSetFromSources(navGrid, sources, clearance)` — the climb-aware set flooded from several sources at once (#1306): reachable from any of them, one fill whatever the source count. Sources clamp into the grid; a stranded source reaches its own cell. `OrderReachability.ts` uses it so a ghost's colour costs one fill per actor key, not one per actor (`gameplay-employee-skills`).
- `computeClimbReachableSetFromSources(..., overrides?)` — optional `FillOverrides` `{ block, free }` rects (min-inclusive, max-exclusive) make cells impassable or passable for one fill, answering "what if a building stood here" without touching the grid (#1391, placement cutoff in `gameplay-buildings`).
- `findNearestNavigableCell(navGrid, targetX, targetZ)` — nearest cell inside the grid's **largest climb-connected region**, with no anchor to assume. Spawn points are chosen before terrain exists (a staffed roster, a campaign level's literals), and with a climb limit in force a fixed coordinate can land on a one-cell island atop a peak. `regenerateGrid` snaps every employee and vehicle through this once the grid is built (`snapAgentsToNavigableGround`, GameState.ts); an agent already on the main ground is left untouched.
- **Rally point** (`src/core/state/RallyPoint.ts`) — every site plants one flag (`state.rallyPoint`) when its first grid exists: `chooseRallyPoint` takes the centre of a `RALLY_POINT_FLAT_RADIUS` square within `RALLY_POINT_MAX_HEIGHT_SPREAD_M`, on the largest climb component at vehicle clearance, nearest the level's authored `rallyPoint`, its starting crew, or the site centre. `placeStartingCrew` gathers the crew around it, every hire and vehicle purchase spawns on `rallySpawnCell` (the free cell nearest it, starting from `findNearestNavigableCell` so a flag left on a blast island still spawns onto main ground; vehicles on level ground, clear of the flag and the fleet), and a level's opening buildings keep `RALLY_POINT_BUILDING_CLEARANCE` from it. The flag is a marker, not a building: nothing damages it, and the renderer (`RallyFlagMesh`) stands it on whatever ground is left under its tile.

## Stranded Debris (#1302)

Debris no actor able to haul it can reach is a legitimate state, not a defect (per-action actors, #1306). A haul order also needs its hauler pool to reach a depot for its rubble, a freight warehouse or a spoil heap for barren rock (#2045): a hauler in a pit with no road out could load and never unload. While no depot of the kind stands, the order reads no warehouse or no spoil heap instead. A vehicle parked on a docking cell beside a building stands for the clearance-2 cells it docked from (`dockedFrom`, the same two thin hops as `withDockingCells`), or a fleet parked at the warehouse would reach nothing. Auto-generated
`haul_debris` / `fragment_debris` work there waits (blockedReason `debris_out_of_reach`) without
counting as a failure or a blocked order, is shown as a single summary indication (neutral top-bar
pip, no toast or log entry), and resumes on its own once connected. Player-ordered unreachable
actions (survey, place_building, ramp layers, ...) still get `target_unreachable` and the per-order warning. Every unreachable queued action, debris included, also draws a red ghost.

## Building Approach Cells

A building's entire footprint — including its `entryPoint`/`exitPoint` markers, which are cosmetic door offsets, not a walkability guarantee — classifies `blocked`. `findPath` rejects an impassable goal outright, so nothing can path onto a building's raw (x, z). `findBuildingApproachCell(navGrid, building, def, fromX, fromZ)` (`src/core/nav/BuildingApproach.ts`) finds the nearest walkable ring cell just outside the footprint, closest to the mover. Any destination that targets a building — rest routing, hauling delivery, shift-cycle sleep — resolves through this, never the building's own coordinates.

## Path Following & Stuck State

Agents move at most `walkSpeed` cells/tick toward next waypoint. Next waypoint becomes `blocked` mid-path → re-request from current position. After **3 consecutive failed re-requests** → `stuck` state:
- Idle, morale −2/tick
- Emits `agent_stuck` event
- Resumes when path clears


A mover mid-hop paths from its committed hop origin (`inFlightHopOrigin`), not the rounded cell of its fractional position, which can be a sealed pit (#1687).

**Idle blockers yield off the route (#1696).** When the occupant in a mover's way is an idle employee or an idle parked vehicle (nothing queued, not working/resting/driving) and the nearest free cell would be another cell of the mover's remaining route, `pickYieldCell` (`nav/IdleYield.ts`) picks the nearest free cell within `IDLE_YIELD_SEARCH_RADIUS_CELLS` that is off that route (route recomputed each ladder step). The blocker is relocated there with no return trip, so it cannot walk back into a 1-wide corridor. With no such cell the older nearest-free-cell behaviour applies. Working, resting, driven and evacuating agents are never relocated. Ladder steps are counted per leg destination in `Employee.blockEpisode` (survives sidestep/reroute resets, cleared on arrival); at `BLOCK_EPISODE_ABANDON_LIMIT` the movement is abandoned so a sidestep-return loop ends.

A world position maps to a cell by `Math.round` through `NavGrid.clampX`/`clampZ`; pathfinding, planner and runtime share it, so a mover stopped mid-hop at a fractional position finds routes from the same cell the runtime sees (#1851).

## Slope limits (#1938, #2045)

`isStepClimbable(fromY, toY, run, maxSlopeRatio = NAV_MAX_SLOPE_RATIO)` is the one climb predicate. `PathRequest.maxSlopeRatio` (default 30°) is threaded to every climb check: A* neighbour expansion, the direct-line walk, exact paths, ramp connections (`findRampConnections`) and the multi-level fallback. A* cost and heuristic are unchanged. The inclusive `<=` boundary (with epsilon) holds, so a slope exactly at the limit is climbable.

| Agent | Max slope |
|-------|-----------|
| Walking, any site | 30° |
| Any vehicle, any role and tier, progression site | 20° (`VEHICLE_MAX_SLOPE_DEGREES`) |
| Any vehicle, campaign / non-progression site | 30° |

Progression site = `state.grade !== undefined` (`isProgressionSite`). `vehicleMaxSlopeRatio(progression)` (`Vehicle.ts`) is the one helper; upgrading a vehicle never changes its limit. `nav/ClimbLimit.ts` only converts degrees and ratios. Ramp cell typing stays at 30°. Reachability labellings (`computeClimbComponents`, `computeClimbReachableSet*`) take the same ratio; `OrderReachability` keys its component cache by `${clearance}|${ratio}`, one vehicle ratio per site. The planner estimate and the executor (`Locomotion`, `AgentAdvance` recovery checks) share `vehicleMaxSlopeRatio`, so the estimate equals the executed route length.

**Decision (#2045): no diagonal shortcut up a ramp for a limited request.** `stepClimbRun(dx, dz, ratio)` (`NavGrid.ts`) is the run every climb check feeds `isStepClimbable`: `hypot(dx, dz)` at the walking limit, but `max(|dx|, |dz|)` for a ratio below it. A 20° vehicle therefore cannot zigzag up a 3-, 5- or 7-wide ramp steeper than 20° along its axis (the old gate passed up to 27°). The planner (`findPath`, `findRampConnections`, `NavGridReachability` legality) and the executor (`AgentAdvance` re-checks) all use it, so they stay equivalent. Walking keeps the diagonal run. The inspector grade is the steepest step along the surface.
