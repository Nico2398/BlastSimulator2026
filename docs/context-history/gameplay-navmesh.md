# History — gameplay-navmesh

Records why the rules in the `gameplay-navmesh` skill exist: the issues that introduced or changed each mechanic, measurements, decision reviews and earlier behaviour.

## Navigation Grid

- Growing site / chunk claims: #473.
- Per-step face refusal making a crater an obstacle: #953.

## A* Pathfinding

- Diagonal corner rule: #1197.
- Clearance: #1154.

## Ramps & Multi-Level Navigation

- Ramps as terrain features: #1298.
- Cliff-adjacent ramp cells omitted from connections: #1305.
- End-floor snap: #1852.
- Multi-leg ramps: #1939.
- Original: "a def without `legs` is one leg, so old saves load unchanged (no save version bump)."
- Before `smoothOffCentreSteps`, the inside of a turn jumped several steps between adjacent tiles.
- Spiral ramp: #1940.
- Ramp tool: #1942.

## Dynamic NavGrid Updates

- Why a claim rebuilds the grid (#473, decision D7): "Expansion happens at human speed, which is what makes an O(area) rebuild cheaper than making A* chunk-aware."

## Reachability Helpers

- Multi-source climb fill: #1306.
- Fill overrides for the placement cutoff: #1391.

## Stranded Debris

- Stranded debris as a legitimate state: #1302.
- Per-action actors without a depot anchor: #1306.

## Path Following & Stuck State

- Hop-origin pathing: #1687.
- Idle blockers yield off the route: #1696.
- Original: "With no such cell the older nearest-free-cell behaviour applies."
- Shared world-to-cell rounding: #1851.

## Per-agent slope limit

- Per-agent slope limit: #1938.
- Original: "A* cost and heuristic are unchanged." (by #1938).
- Per-step limit including diagonals was a decision of #1938.
- Original: "Recorded, not a bug."

## Crater access — provenance (merged from main)

- Crater access came with #2082; offset feet and spirals from a hollow start with #2086; stuck ramps, plans that would free nothing, abandoned debris and stranded recovery with #2085.
