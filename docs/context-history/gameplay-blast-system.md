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
- The buried-hole bonus also ranks breaking a boulder on a planned hole: on the seed-42 full-kit ladder 13 boulders kept a deepening pattern buried after the haulers had cleared the rest, and every deepening shot was dropped (#2089).

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
- Buried-hole rubble exempt from barren-yields-to-ore (#2089).

## 2026-11-10 (#2203)
Added per-hole readouts paragraph under Energy heatmap: powder factor, band mix, recommended range, card band mix.

## Coarse band and recommended range (blast legibility review, 2026-11-10)

- Review after the #2197–#2204 batch, on uniform benches and the sandbox opening pattern (3x3, 4 m, 8 m, 89 mm, 2.5 m stemming): about half the rock a standard shot breaks out (lifted burden, floor to grade) has intensity below 1, and the heatmap and band mixes showed it as "Intact: rock stays put" (molite/krackle 8 kg: 351 of 648 broken voxels). It now reads `coarse` (`fragmentationBandOf`), in the preview and in `executeBlast`'s band volumes alike.
- `recommendedPowderFactors` returned null for every hole of every rock and explosive on that pattern: the good band is a shell round the charge, so the best charge reaches 8-27% good, never the 0.5 the absolute bar asked. The range is now relative to the best sample (`RECOMMENDED_RELATIVE_GOOD_SHARE` 0.8), with `RECOMMENDED_GOOD_SHARE_MIN` lowered to 0.05 as the "this explosive cannot do it" floor (titanite/boomite best 3%).
- The software table's names are the in-game ones (`ui.blast_workshop.preview.tier_*`); the old names described the pre-#2201 line-up.

