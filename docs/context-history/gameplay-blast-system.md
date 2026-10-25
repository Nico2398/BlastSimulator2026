# History — gameplay-blast-system

Records why the rules in the `gameplay-blast-system` skill exist: the issues that introduced or changed each mechanic, and the decisions taken along the way.

## Pipeline Overview

- Blast plan overlay redrawn from state on every state replacement and level load: #1877.

## Step 1 — Energy Propagation

- Hole diameter: #1934.
- Explosive tier shortfall: #1358.
- Free-face lateral range (`FREE_FACE_LATERAL_RANGE_M`), so an excavation beside a pattern cannot leave pillars: #1793.

## Step 2 — What Breaks

- Floor to grade (sub-drilling): #1723. Enclosed pillars: #1825. A sealed shot that never broke out stays sealed: #1724.

## Step 4 — Throw, Flight and the Muck Pile

- Rock that fails to break out stays sealed: #1724.
- Breakout warning and sealed reporting: #2003. "The thresholds (`BLAST_SEALED_SHARE_FAILURE` 0.75, `BLAST_SEALED_SHARE_PARTIAL` 0.25) are defaults chosen under `agentic-decision-autonomy`."
- No `haul_debris`/`fragment_debris` order for sealed rock: #1774.
- Defaults break out (`CHARGE_DEFAULT_AMOUNT_KG` 7, `CHARGE_DEFAULT_STEMMING_M` 2.5): #1724.
- Placement is physics-only: #1302.
- Levelling a crater: #1723.

## Damage

- Stuck walker counts as stranded: #1990. Vehicles keep the parked-vehicle rescue logic of #1746/#1781.
- Secondary crater from a destroyed stocked Explosive Warehouse: #1896 (its decisions are recorded with `gameplay-buildings`).

## Blast Report and Rating

- Rating caps: #1349. `sealed_failure` and `sealed_partial` caps: #2003.

## Loading a saved plan

- Introduced by #1342. Monotonic hole ids (`state.nextHoleId`): #1352.

## Pattern charge settings

- Introduced by #1345. Vehicle work for `charge_hole`: #1649. Hole water: #1350. Held detonation and rain exposure: #1957.

## Undrilled holes at fire time

- Introduced by #1346. Warning rather than gating FIRE was a default chosen over blocking FIRE.

## Software Upgrades (Prediction Tools)

- Previews take the wet-hole set (`state.holeWater`): #1350.
- Village vibration: #1343.

## Charge cost: cash vs stock

- Introduced by #1685.

## EST. ORE VALUE

- Introduced by #1703.

## BURIED HOLES

- Introduced by #1937.

## Pre-Flight building reach

- Introduced by #2030. `buildingsInBlastReach` warns through the Pre-Flight rows added in #2021. Flying rock is tracked by #1968.

## WALL STABILITY

- Introduced by #1941. "Measured: the standard opening ... leaves a tallest face of 10 m in the biomes where it breaks out (seeds 42/7/13), so no constant was lowered or raised."

## Wall warning prediction and overlay

- Introduced by #1943.

## Crater access clears buried holes — provenance (merged from main)

- Added with #2082. The Pre-Flight building reach section came with #2030.

## Buried holes

- Core no longer orders crater access for buried holes; the player does: #2095.
