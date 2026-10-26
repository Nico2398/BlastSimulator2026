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

## Pit logistics belong to the player

- One 20° vehicle limit, no diagonal shortcut up a limited ramp, flush ramp ends, landing on the level the order reaches for, ramp repair and its shape tolerance: #2045.
- Core crater access, abandoned-debris pruning and stranded recovery removed; core explains and the player acts: #2095.
- Rubble blocks every walk again: #2094.
- A haul needs a road on to its depot; docked vehicles stand for the cells they docked from: #2045.
- Access plans: modal floor, shortest straight ramp over every floor-level foot, then the shortest trip toward the haul depot; exclusions for dug ramps, rubble fill and building footprints: #2045.
- The site's vehicle network is anchored on the haul depots as well as the rally point (a spoil heap walled the rally into a pocket and every plan read no_start): #2093.
- A digger on a crater floor starts a flush ramp from beside its foot: #2045.
- A repair leaves tiles an older ramp covers to that ramp: a traffic-jam widening grew one ramp into its neighbour's lane, and on the seed-42 full-kit ladder the two re-ordered each other's repair every 50-100 ticks from t5500, which held every other ramp order (#2091).
- The probe buys a digger when ramp work waits and none stands on the vehicle network (#2091).
- Shallow rescue ramps (`minDropM`): a driver and a digger on a strip a metre below the road kept every later shot near them refused. Shallow plans for every floor, and a 90 m trench for a metre's drop, cost the Shareholder Summit ladder its win, hence crew floors only and the 10 m cap (#2091).

## Search and approach caches

- Failed terrain searches kept per nav grid revision, and the building main region likewise: a 12-hauler ladder run spent 59% of its A* time on repeated failed searches and a quarter of each tick re-labelling the grid for depot approaches (#2089).
