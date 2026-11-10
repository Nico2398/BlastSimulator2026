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

## 2026-11-10 — Blast design rework: per-hole energy kernel, fill-to-stemming charges, burden/staggered grid, drilling cost, permit by area

- **Why.** The absorb/overflow model (each voxel kept what its rock absorbed and passed the rest to its 18 neighbours, losing `TRANSMISSION_LOSS_BASE` 0.08 + `TRANSMISSION_LOSS_POROSITY_SCALE` 0.40 × porosity per step, pulled toward free faces by `FREE_FACE_BIAS` 2.0 within `FREE_FACE_LATERAL_RANGE_M` 4 m, cut off at `PROPAGATION_ENERGY_EPSILON` 0.01 and `MAX_PROPAGATION_ITERATIONS` 500) could never put more than about 40% of a pattern's rock in the good band: the good band was a shell round each charge column, whatever the design. The per-hole kernel (`exp(-d / BLAST_ENERGY_DECAY_M)` through rock out to `BLAST_ENERGY_REACH_M`, normalised per hole, holes adding up) lets overlapping holes fill the rock evenly, so the mesh, the explosive's density and the stemming decide the outcome. Measured after the rework: the best design per rock (explosive × spacing × bore at 2.5 m of stemming) reaches 51–67% good, and only 1–6 of 80 designs per rock reach 50%. Removed with the old model: those five constants, `EnergyField.loss` and `EnergyField.iterations`.
- **Floor rule.** The old model broke about one voxel under each charge, which `floorToGrade`'s one-voxel lift levelled. The kernel now spends the share under a hole's bottom in `dissipated`, so a pattern of equal holes floors flat at grade on its own (3x3, 4 m, 8 m deep, `desert_badlands` seed 42: flat for pop_rock, boomite and krackle fills); the lift remains for mixed depths. The skill's "a ramp reaches over 90% of a krackle crater's columns" was dropped, not re-measured.
- **Calibration.** `EXPLOSIVE_ENERGY_SCALE` 10 → 25, set on the default design (89 mm holes 4 m apart, 8 m deep, boomite filled under 2.5 m): ~60% (measured 62%) of molite's rock good, krackle half fines. `SEEDS_BASE` 0.35 → 2.0 and `SEEDS_PER_INTENSITY` 0.8 → 2.0 (below intensity 1 the base scales with intensity), about 3× more fragments; the skill's "`SEEDS_BASE` is below 1 on purpose" no longer holds. `MIN_THROW_FRACTION` 0.05 → 0.02, so an overcharge under full stemming throws nothing; it replaced the measurement "same 8 kg charge: 0 m of stemming → 30 m/s and flyrock, 2 m → 11 m/s heave".
- **Fill-to-stemming charges.** The player chooses explosive and stemming; the hole fills from the bottom. `ExplosiveType` lost `minChargeKg` / `maxChargeKg` (and `explosiveHoleLimits`, the per-explosive kg range scaled by bore) and gained `density`; `CHARGE_REFERENCE_DENSITY` 0.8. `CHARGE_DEFAULT_AMOUNT_KG` (7, "the smallest charge that breaks out of the default 3x3 on the sandbox pad and `tutorial_pit`", #1724) was deleted; `defaultChargeKg` became `defaultStemmingM`. The Charge step's kg stepper and its `too_much_for_hole` line were removed; an explicit `amount:` stays for scripts. The recommended range sweeps stemmings instead of fractions of the heaviest fitting charge; the note "best samples reach 8-27% good" described the old model. The optimizer sweeps stemmings too, and `OPTIMIZER_SWEEP_STEPS` went 8 → 16 because under a tight permit only the last few stemmings fit and 8 samples left the proposal behind a hand plan; `optimize_charges stemming:` was removed. Its old timings (36 holes ~1.1 s, 400 holes at grade 5 ~10 s) were dropped, not re-measured.
- **Grid and drilling cost.** Burden and staggered rows (`drill_plan grid burden: pattern:staggered`, the Drill strip's burden stepper and layout toggle); spacing and burden stored on holes. Drilling costs `DRILL_COST_PER_METRE` (12) per metre of 89 mm hole, booked under `drilling`, so a finer mesh over the same ground costs drilling rather than permit.
- **Permit by area.** `PERMIT_LIMITS` capped holes per blast; it now caps the pattern area (`patternAreaM2`), each grade's area being what its former hole limit covered at a 4 m × 4 m cell. Details in the `gameplay-game-design` history.
- **Skill measurements dropped as stale, not re-measured:** the heatmap recompute timings (100 / 256 / 576 holes: 106 / 183 / 257 ms; the fate pass adding ~15%), "on a standard pattern about half of what breaks is coarse", and the wall-stability line "the standard opening (floor up to 4 m deeper) leaves a tallest face of 10 m" (quoted under WALL STABILITY above).
- **Re-measured for the skill on this date:** a uniform titanite bench (3x3, 4 m, 8 m, 89 mm, filled under 2.5 m) breaks nothing with pop_rock, boomite or krackle, 72 voxels with big_bada_boom and 968 with dynatomics (the old line, at each explosive's max kg per hole: "boomite and krackle only the charge cells (72 voxels)"); a molite bench with boomite filled on a 3 m mesh of 8 m holes throws nothing under 2.5 m of stemming and 750–1,200 projections, up to 36 m, under 0.5–1.5 m; the EST. ORE VALUE ratios on the survey test's filled shots (seismic 0.89 / 0.77 / 0.94, core samples 0.93 / 0.92 / 0.94, aerial 0.10–0.14) replaced the 8 kg / 4 kg ones (seismic 0.86 / 0.84 / 0.78, core samples 0.68 / 0.67 / 0.40, aerial 0.2–0.26).
