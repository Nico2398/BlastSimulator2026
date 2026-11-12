---
name: gameplay-blast-system
description: >
  Full blast pipeline specification for BlastSimulator2026: the drill pattern and its charges,
  energy propagation through the voxel grid, which voxels break, carving the broken rock into
  fragments, and where those fragments end up. Covers voxel rock composition, the drill grid
  (spacing, burden, staggered rows, drilling cost), fill-to-stemming charges, the free-face and
  stemming mechanics, projectile grouping, and how the renderer plays a collapse back. Use when
  working on blast mechanics, drill patterns, charges, mining systems, fragment physics, or voxel
  grid code.
---

## Pipeline Overview

A blast resolves in four steps, all inside `src/core/mining/`. Every tuning constant lives in
`src/core/config/balance.ts`.

```
1. EnergyPropagation.ts   energy spreads from the charges through the rock
2. VoxelFragmentation.ts  which voxels break, crack, lift, or come away unsupported
3. FragmentGeneration.ts  the broken rock is carved into fragments
4. FragmentVelocity.ts    what throws each fragment
   ProjectileGrouping.ts  grouping thrown rock so motion cost is capped
   BlastResolve.ts        arcs, landings and the muck pile
```

`BlastExecution.executeBlast` orchestrates them and returns a `BlastResult`.

**Everything gameplay-visible is decided at detonation.** The renderer only plays the result back
(`src/renderer/FragmentAnimator.ts`), so a headless run — console, scenario runner — reaches exactly
the same state with no animation. Never move an outcome into the renderer.

The blast plan overlay (ordered-hole ghosts, drilled/charged tubes) is redrawn from the state on every state replacement (save load) and level load, not only after planning commands; an empty state resets it so no old hole stays drawn or clickable.

## Voxel Data Model

**Voxel size:** 1 m × 1 m × 1 m cells (SI units throughout).

Up to 4 rock types per voxel with coefficients summing to 1.0, generated from per-rock 3D Simplex
noise plus level bias. Ore sits in veins from a separate high-threshold field. A voxel also carries
a `fractureModifier` (< 1.0 where an earlier blast cracked it).

## Step 1 — Energy Propagation

Each charged hole spreads its energy through the rock around it: a per-hole kernel
(`seedEnergy`), the holes' shares adding up. Runs on flat typed arrays over the blast's bounding
box — never per-voxel objects or string keys, which a blast revisits far too often to afford.

- **Fill mode.** The player chooses the explosive and the stemming; the hole is filled from the bottom up to the stemming. A metre of hole holds `chargeKgPerMetre(d = 0.089, explosiveId?) = CHARGE_KG_PER_METRE × (d / 0.089)² × density / CHARGE_REFERENCE_DENSITY` kg: boomite (0.8 g/cm³, the reference) 2.0 kg/m in an 89 mm hole, dynatomics 4.0; at the reference density ~4.07 / ~6.87 kg/m in 127 / 165 mm. `fillChargeKg(depth, stemming, d?, explosiveId?)` is what a hole holds filled to the stemming, floored to 0.1 kg (`maxFittingChargeKg`). Every fit helper (`chargeColumnM`, `maxChargeKgForHole`, `chargeFitsHole`, `maxFittingChargeKg`) takes the hole's diameter and an optional trailing explosive id (its density; none or unknown reads the reference density).
- **`createCharge(explosiveId, amountKg | null, stemmingM, holeDepth, diameterM)`.** Null fills the hole. An explicit amount is a partial charge at the bottom of the hole, kept for scripts (console `amount:`); the UI never sends one. There is no per-explosive kg range: any positive amount whose column fits under the stemming is accepted. Refused: an unknown explosive; stemming under `MIN_STEMMING_M` or deeper than the hole; an explicit amount that is 0, negative or not a number (`mining.charge.invalid_amount`); no room under the stemming (`mining.charge.no_room`); an explicit amount overflowing the hole (`mining.charge.column_exceeds_hole`, quoting the max that fits).
- **Charge column.** `buildHoleSeeds(surfaceY, depth, amountKg, totalEnergy, x, z, floorY?, diameterM?, explosiveId?)` lays the charge over `round(amountKg / chargeKgPerMetre(diameterM, explosiveId))` cells (min 1) from the bottom of the hole, clamped to the world floor (an over-deep hole keeps its whole charge) and to the collar, and splits the hole's energy (`computeInitialEnergy` × `EXPLOSIVE_ENERGY_SCALE`) evenly over them. Stemming does *not* shorten the column; poor stemming is priced into `stemmingEfficiency` instead.
- **Hole diameter.** Each hole has a diameter, chosen per drill plan from `DRILL_HOLE_DIAMETER_OPTIONS_M` (89 / 127 / 165 mm, default 89). A wider bore needs a stronger rig (`minRigTierForDiameter`, see `gameplay-vehicle-fleet`). Console `drill_plan grid|add diameter:` takes mm or m (`normaliseHoleDiameter`), anything else is refused listing the options.
- **Charge step.** No kg stepper: the read-only "Per hole" value (`data-role="charge-per-hole"`) shows each hole's fill — one figure, or a min–max spread when depths or bores differ — and the capacity line the selected explosive's kg per metre in the narrowest hole. Charge All and a hole row send `charge hole:<*|id> explosive:<id> stemming:<s>m`. When the stemming leaves no room in some hole, Charge All is disabled with a reason naming the shallowest hole's depth (`no_room_reason`); the stemming stepper is never clamped.
- **Absorption threshold** = rock mix weighted by `energyAbsorption`, × `fractureModifier`, ×
  `confinementFactor(distToAir)`. **Rock near a free face breaks for a fraction of the energy**
  (`UNCONFINED_THRESHOLD_FACTOR`, ramping to full over `CONFINEMENT_FULL_DEPTH`) — this is why bench
  blasting works at all.
- **The explosive never gates breaking.** A voxel's threshold depends only on its rock
  (absorption, `fractureModifier`, confinement); the explosive's only part is the energy it
  delivers (`energyPerKg` × kg — its density sets the kg a filled hole holds — stemming, water).
  There is no explosive tier and no per-column gating lookup: `createEnergyField(grid, box)` takes
  none. The catalog defines an explosive by energy per kg, cost per kg, loaded density (g/cm³),
  water sensitivity and vibration modifier. A weak explosive on hard rock breaks little or nothing,
  in proportion to its energy per metre of hole; Shareholder Summit's hard rock (obstiite/titanite)
  therefore still needs the strong explosives for a real crater, through energy and density alone.
  Measured on a uniform titanite bench (3x3, 4 m spacing, 8 m holes, 89 mm, filled under 2.5 m of
  stemming): pop_rock, boomite and krackle break nothing, big_bada_boom 72 voxels, dynatomics a
  crater (968 voxels).
- **No Charge step weak-explosive warning.** The old tier-based "too weak for rock" line is gone;
  the pre-fire "breaks nothing" warning (below) is the fit signal.
- **Kernel.** Seeds are grouped by column, one hole per column. From each hole's charge cells a Dijkstra through rock — the 18 face-and-edge neighbours, steps of 1 and √2, air never entered — reaches out to `BLAST_ENERGY_REACH_M` (4.5 m). A reached voxel at distance d gets `holeEnergy × exp(−d / BLAST_ENERGY_DECAY_M) / Σ weights` (`BLAST_ENERGY_DECAY_M` 1.3 m), the weights summed over every voxel that hole reaches: one hole's shares sum to its energy, and the shares of several holes add up. Air neither absorbs nor carries: a void shields what is behind it. Holes closer than about twice the decay length overlap and fill the rock evenly; holes far apart leave a hot core round each hole (fines, dust) and cold rock between them (coarse, intact).
- **Floor rule.** The share a hole's kernel puts on rock below that hole's bottom (its lowest charge cell) goes to `dissipated`, not to the rock; the weights stay normalised over all the rock in reach. Each hole floors at its own bottom, so a pattern of equal holes floors flat at grade.
- **Received energy.** Per voxel, `effective = min(received, threshold)` and `overflowOut = max(0, received − threshold)`. A seed in air, or a hole with no rock in reach, goes to `dissipated`.
- **Energy is conserved.** `seeded == Σ (effective + overflowOut) + dissipated`. Keep it that way.

Two derived readings matter downstream:

- `effectiveAt` — energy a voxel retained. **Capped at its threshold**, so it is *useless* as a
  measure of violence: every broken voxel reads exactly 1.0× threshold.
- `intensityAt` — `(effective + overflowOut) / threshold`: everything the voxel received over what
  its rock takes. This is the signal fragment generation seeds from. 1.0 means "just barely broke".

## Step 2 — What Breaks

Four passes, in order:

1. **Energy** — `effective >= FRAGMENTATION_MULTIPLIER × threshold` breaks. Between
   `CRACKED_VOXEL_ENERGY_RATIO` and that, the voxel survives but is weakened
   (`CRACKED_VOXEL_WEAKENING` on its fracture modifier) for the next blast.
2. **Undermined burden** — a cap of intact rock up to `BURDEN_BREAKOUT_MAX` thick over a broken
   zone, with air above it, lifts rather than being crushed. Without this a charge carves a sealed
   cavity under intact ground at *any* size and the player sees nothing happen. Thicker burden still
   holds, which is what makes an over-buried charge visibly fail to break out.
3. **Floor to grade** — sub-drilling. `EnergyField.gradeY` is the world Y of the highest
   charged hole bottom, plus `BLAST_GRADE_FLOOR_OFFSET_M` (null when nothing is charged; `seedEnergy`
   sets it). In every footprint column (one with at least one voxel already broken), `floorToGrade`
   breaks the standing rock below the column's topmost broken voxel down to `gradeY`, but never more
   than `BLAST_GRADE_MAX_CUT_M` below that column's lowest broken voxel, so a deep outlier hole
   cannot gouge the pit. Holes no longer break below their own bottom (the kernel's floor rule), so
   a pattern of equal holes floors flush at grade. The one-voxel lift remains for mixed depths: the
   breakout one voxel under grade (a hole 1 m deeper than its neighbours) is left standing beside any
   column ending at grade, whichever pass broke it (neighbours read from a pre-lift snapshot; a cut
   clamped above grade does not count), so the floor is flush; a lone hole keeps its pit. The lift floods: an 8-connected group of columns all ending exactly one voxel under grade lifts whole when any member neighbours a column at grade (pre-lift snapshot), so pockets between close holes are flush too; **enclosed pillars**: an unbroken column with no 4-connected path of unbroken columns to the box shell (the centre of a square of four holes) is floored too, from its highest solid voxel down to the region's floor (`max(gradeY, lowest bordering footprint column - BLAST_GRADE_MAX_CUT_M)`); air is skipped, and only a pillar bordered by a column whose broken zone reaches its own top (the cap lifted off) is floored, so a sealed shot that never broke out stays sealed; columns touching the shell, a ring with a gap, lone-hole pits and gradeY null are unchanged; a group with no grade neighbour stays, and deeper columns neither lift nor carry the fill. It returns the voxels it added (`FragmentationResult.gradedCount`). The
   marks join the mask, so fragments, cleared voxels, the pre-blast estimate and the ore report
   follow the real broken volume; energy is untouched. A 3x3, 4 m spacing, 8 m deep pattern
   (sandbox `desert_badlands` seed 42) floors flat for pop_rock, boomite and krackle fills alike.
   Pits of a light charge that do not touch stay separate floors.
4. **Unsupported rock** — flood-fill the survivors from the box shell; anything the fill never
   reaches was standing on nothing and comes down.

## Step 3 — Carving Fragments

Broken voxels are diced into sub-cells (`SUB_CELL_RESOLUTION`), seed points scattered in proportion
to intensity, and each sub-cell joins its nearest seed. The clusters are the fragments.

```
I = intensity(v), FM = FRAGMENTATION_MULTIPLIER
seeds(v) = SEEDS_BASE × I / FM                       when I < FM
seeds(v) = SEEDS_BASE + SEEDS_PER_INTENSITY × (I − FM)  otherwise
```

`seedCountForIntensity` (`FragmentGeneration.ts`) rolls the fractional part as one more seed with
the blast's seeded chance and caps the count at `MAX_SEEDS_PER_VOXEL` (8). `SEEDS_BASE` and
`SEEDS_PER_INTENSITY` are both 2: a voxel broken at its threshold seeds two (fragments of about
0.5 m³), four at the fines bound (0.25 m³), eight at the dust bound (0.125 m³, the sub-cell floor:
gravel vehicles drive over, `FRAGMENT_DRIVABLE_MAX_VOLUME_M3`). Boulders, above
`OVERSIZED_FRAGMENT_THRESHOLD` (2.0 m³), come from the collar under the stemming and the weakly broken
pattern edges: the tutorial pit's guided 3x3 (4 m, 8 m deep, boomite filled under 2.5 m) leaves none,
its largest piece 2.0 m³, while an underfilled or over-stemmed shot there leaves 13-62, up to 11 m³. Rock broken with less energy than its threshold
(coarse: lifted burden, floor to grade, unsupported rock) seeds the base scaled by its intensity —
under one seed below half its threshold — so the least-energised of it seeds **nothing** and is
swallowed by a neighbouring cluster as one large boulder.
That is where an undercharged blast's oversize comes from. Rock no seed claims forms its own
connected lumps.

**Fragment size follows from the blast alone.** There is no fragment budget anywhere in this path —
`MAX_FRAGMENTS_PER_BLAST` is a guard against pathological input, never a tuning dial. Physics cost
is capped separately, in step 4, by grouping. **Volume is conserved**: Σ fragment volume = broken
voxel count, exactly.

A fragment carries the volume-weighted rock and ore of the voxels it was carved from
(`FragmentComposition.ts`), plus the bounding box the renderer scales it to.

### Fragmentation bands

`classifyFragmentationBand(intensity)` (`FragmentationBand.ts`) is the only place that names the
ranges; the blast, previews, heatmap and report all read it. A bound belongs to the band above it.

| Intensity | Band | Colour | Consequence |
|---|---|---|---|
| < `CRACKED_VOXEL_ENERGY_RATIO` (0.5) | intact | blue | none |
| 0.5 – `FRAGMENTATION_MULTIPLIER` (1) | cracked | pale blue | weakened, not broken |
| broken, < 1 | coarse | violet | breaks out as large blocks (oversize needs the rock breaker) |
| 1 – `FRAGMENTATION_BAND_FINES_MIN` (2) | good | green | haulable fragments |
| 2 – `FRAGMENTATION_BAND_DUST_MIN` (4) | fines | orange | smaller, more numerous fragments (more loads to haul) |
| ≥ 4 | dust | red | finest fragments; loses `DUST_LOSS_SHARE` of its mass and ore |

`coarse` is not an intensity range: it is rock the blast removes without enough energy to fragment it
(lifted burden, floor to grade, unsupported rock). `classifyFragmentationBand` never returns it;
`fragmentationBandOf(intensity, broken)` does, and every reader that knows a voxel's fate uses that —
`executeBlast`'s band volumes and `previewPlanBands` (which runs `identifyFragmentedVoxels` read-only
unless `{ fate: false }`). A preview must never label rock that comes out as rock that stays put.
Sweeps that only compare good shares (recommended range, optimizer) pass `fate: false`, since
coarse never takes a cell from good, fines or dust.

Fragment size follows from the seed curve above, which already shrinks fragments monotonically
across the bands. The explosive's tier never gates a band; the rock's threshold does. Overcharge does
not throw rock by itself: projections stay governed by stemming and the free face, so a heavily
stemmed overcharge crushes the rock near the charge (fines, dust) and leaves the rock near the collar
coarse or unbroken. `BlastResult.bandVolumes` holds the m³ per band and `BlastResult.dustLoss` the
mass (kg) and ore value lost to dust; fragments are already net of that loss, their volume is not.

The blast report (`BlastReportModal`) shows the band volumes, the kg lost to dust, and why holes failed. `analyseHoleFailures` (`HoleFailures.ts`, run by `executeBlastSteps`) returns one `HoleFailure` per charged hole whose charge broke no rock: `fizzled` (wet hole, water-sensitive explosive) or `below_threshold` (with `moreEnergyPct`, a linear estimate from the best charge-cell energy/threshold ratio), or whose column stayed sealed above it: `buried` (with `rockAboveM`). A shot with `clearedVoxels === 0` gets the dud explanation; `BLAST_REPORT_MAX_HOLE_REASONS` caps the lines, and `finesShare` >= `OVERCHARGE_NOTE_MIN_FINES_SHARE` adds the overcharge note.

### Energy heatmap (Blast Workshop)

The workshop's heatmap toggle (`toggle-energy-heatmap`, every software tier including none) shows the plan's own energy field (`previewPlanBands` in `SoftwarePreview.ts`, built on `buildPlanEnergyField`) coloured by `classifyFragmentationBand`; colours are `FRAGMENTATION_BAND_COLORS` (`FragmentationBand.ts`), shared by overlay, section and legend. `planHeatmap` (`EnergyHeatmap.ts`) caches one result per grid/holes/charges/wet-holes/`editRevision`, so redraws and hovers cost nothing (a cached read is under 1 ms). Two views: a top-down terrain overlay (`EnergyHeatmapOverlay`, a `GroundTintLayer`, opacity `HEATMAP_OVERLAY_OPACITY`) with one colour per column, and a vertical section (`EnergyHeatmapView`) through the row of voxels sharing the selected hole's z. A column shows the finest band covering at least `HEATMAP_COLUMN_BAND_MIN_SHARE` (0.15) of its filled voxels, so a lone fines voxel does not paint a whole column. Hover (panel cells and the scene `HoverTag`) names exact intensity and band. The console `preview energy` is ungated, like the heatmap.

**Per-hole readouts (every tier).** A hole owns the columns of its pattern cell (`holeCellOf`, `SoftwarePreview.ts`, from `holeCellSize`, `ChargePlan.ts`): spacing × burden when it was drilled as part of a grid (`spacingM` / `burdenM`), else a square as wide as the distance to its nearest neighbour, capped at `HOLE_CELL_MAX_SIDE_M` (8 m). `ownerHoleOf` gives a column to the hole with the smallest normalised Chebyshev distance `max(dx / halfX, dz / halfZ) ≤ 1` (ties to the nearer hole, Euclidean), and a hole counts the voxels of its columns within one hole depth below the top of its own column; `holeBandMixes` turns a `PlanBandMap` into six band shares per hole. `powderFactor(kg, depth, spacing, burden = spacing)` is kg / (spacing × burden × depth). The Charge step's hole rows (charged holes: powder factor and band mix; all holes: recommended range) and the heatmap's `HoverTag` read the same `planHeatmap` result (`col.hole`). `recommendedPowderFactors(holes, grid, explosiveId, wet?)` fills each hole at `RECOMMENDED_SWEEP_STEPS` stemmings over `stemmingSweepRangeM(depth)` — from the full-stemming length (`max(MIN_STEMMING_M, STEMMING_FULL_DEPTH_FRACTION × depth)`) to `depth − MIN_CHARGE_COLUMN_M` (0.5 m of explosive), most explosive first — and returns the contiguous run around the best sample whose good share stays at or above `RECOMMENDED_RELATIVE_GOOD_SHARE` (0.8) of the best's, as `PowderFactorRange { minKgPerM3, maxKgPerM3, minStemmingM, maxStemmingM }` (the least stemming gives the most kg/m³), or `null` when even the best sample is below `RECOMMENDED_GOOD_SHARE_MIN` (0.05) ("No charge of this explosive fragments this rock well"). The row reads "Best min–max kg/m³ · stemming min–max m"; the heatmap runs one sweep per explosive, shared by every hole charged with it. Explosive cards show the pattern's band mix for that explosive with every hole filled to the chosen stemming (`previewExplosiveBandShares(holes, grid, explosiveId, stemmingM, wet?)`), plus energy (`Energy N/kg`, game units), kg and energy per metre of the narrowest hole (`chargeKgPerMetre` × `energyPerKg` × `EXPLOSIVE_ENERGY_SCALE`) and vibration. `ChargeReadouts` memoizes card mixes per explosive and stemming and ranges per explosive, until the pattern, wet holes or `editRevision` change.

## Step 4 — Throw, Flight and the Muck Pile

**Three things decide whether rock is thrown rather than merely broken:**

| | |
|---|---|
| Leftover energy | Only what the rock received *beyond* its threshold (`overflowOut`) can move it; what the threshold took went into breaking it. |
| A free face | Rock near air has somewhere to go; confined rock can only settle. Direction blends the free face with the energy gradient (`FREE_FACE_WEIGHT`). |
| Stemming | `throwFraction = MIN_THROW_FRACTION + (1−MIN) × blowout²`, blowout = 1 − `stemmingFactor` (full from `STEMMING_FULL_DEPTH_FRACTION` of the depth), `MIN_THROW_FRACTION` 0.02. This is the player's main safety lever. |

**An overcharge under full stemming throws nothing**: too much explosive is paid in fines and dust,
too little stemming in flyrock. Measured on a molite bench, boomite filled in a 3x3, 3 m mesh of
8 m holes: under 2.5 m of stemming no projection (more fines than good rock); under 0.5–1.5 m,
750–1,200 projections, up to 36 m away at 0.5 m.

**Projectile grouping** (`ProjectileGrouping.ts`) caps how many bodies fly at
`MAX_ACTIVE_PROJECTILES`. Fragments that are close together and moving alike travel as one and split
back into their own pieces on landing. Fastest rock opens groups first, so the pieces a player
watches keep the truest trajectories. **Grouping never changes fragment identity, size or count.**

**Landing** (`BlastResolve.ts`) traces each arc against the terrain in closed form, longest flights
last, so rock lands on the pile earlier rock has already built. Everything else drops in place,
lowest first. Rock is clamped to the world; the terrain is cleared *before* landings resolve, so
fragments fall into the hole the blast just made. `BALLISTIC_MAX_T` must stay above the longest
flight `MAX_PROJECTION_VELOCITY` allows (straight up at the cap is 16.3 s) — below it, the fastest
rock is abandoned mid-arc.

**The muck pile** is per ground column, and two rules keep it a pile rather than a tower:

- A column rises by the **volume** a fragment adds, bulked by `RUBBLE_BULKING`, spread over the
  larger of the column or the fragment's own footprint. Never by the fragment's size — that adds
  the same height for a chip as for a boulder and stacks gravel into a spire.
- Muck past its angle of repose (`PILE_REPOSE_STEP`) rolls downhill one column at a time. **Only
  muck sheds rock.** A fragment landing where no other rock has reached stays exactly where it
  fell, whatever the terrain beside it does — otherwise flyrock trickles back into the pit it was
  thrown out of, and where flyrock lands is the whole reason it is dangerous.

**Rock that fails to break out stays sealed.** A fragment whose origin lies in a void with
an intact solid voxel above it in its column never leaves it: it does not fly (`thrown: false`,
never a projectile) and settles inside the void, on the first empty layer above the ground at or
below where it broke, never above the cap. Piles are keyed by (column, layer); a column filled to the
ceiling, or past the angle of repose, spills sideways into the lowest column of the same void. Rock
thrown in from elsewhere still lands on top of the cap, and open columns resolve exactly as before.
`BlastResult.brokeOut` is true when some cleared voxel sat at or above its column's pre-blast top;
a blast that cleared rock but never broke out is reported (`mining.blast.no_breakout`,
`BlastReport.brokeOut`) and capped to bad (`no_breakout`).

**Breakout warning and sealed reporting.** `predictBreakout` (`BreakoutPrediction.ts`) runs the
executor's read-only energy pass and fragmentation (`liftUnderminedBurden`, per-hole bore and
explosive density via `chargeKgPerMetre`) on a charged plan and reports broken voxels, sealed voxels (intact rock still above
in the column), `sealedShare`, `tooDeepHoleIds` and the charged hole count, plus the `fragmented` set and `sealedKeys` (`isVoxelSealed`, the voxel-level twin of `isFragmentSealed`); it agrees with
`executeBlast`'s `brokeOut`. `breakoutWarningKind`: `nothing` when the shot breaks no rock at all (not enough energy for the rock under the holes; checked first, so a dud no longer stays silent), `none` when every broken voxel stays sealed,
`partial` when the sealed share reaches `BLAST_SEALED_SHARE_PARTIAL`. Both the Blast step
(`breakout-check`) and the Pre-Flight modal (`preflight-breakout-warning`) show it at every software
tier (a plan-against-ground check, not an analysis number); it never blocks firing, and advises
shorter holes or less stemming (the charge then reaches higher up the hole), never wider holes; a shot that breaks nothing is told to use less stemming, a stronger explosive or a wider bore. The thresholds are
`BLAST_SEALED_SHARE_FAILURE` 0.75 and `BLAST_SEALED_SHARE_PARTIAL` 0.25. After fragments land, `isFragmentSealed` splits the result:
`BlastResult.totalOreValue` is broken-out ore only, `sealedOreValue` / `sealedFragmentCount` the rest,
`reachableOversizedFragments` the oversize fragments not sealed. The report modal shows "Sealed
underground" (a later shot breaking the cap can still free it) and limits the oversize hint to
reachable fragments; the console report matches.

Sealed rock gets no `haul_debris`/`fragment_debris` order until its void opens to the surface (the column's top solid no longer above it); then it is ordinary debris.

**Default design.** Boomite filled to `CHARGE_DEFAULT_STEMMING_M` (2.5 m) in the default pattern —
89 mm holes `DRILL_GRID_DEFAULT_SPACING_M` (4 m) apart, `DRILL_GRID_DEFAULT_DEPTH_M` (8 m) deep —
is 11 kg per hole. `EXPLOSIVE_ENERGY_SCALE` is calibrated on it: about 60% of a medium rock's
(molite) pattern in the good band, while krackle on the same design is half fines. The Charge step
opens on Boomite (or the pattern's explosive, when the level offers it) at 2.5 m, and the
tutorial's charge step sends `charge hole:* explosive:boomite stemming:2.5`.

**Defaults follow the permit.** The 8 m depth and 2.5 m stemming hold on a site without a permit
(tutorial, campaign levels without a grade). With a permit, `PermitDefaults.ts` derives them: the
Charge step opens at `defaultStemmingM(grade, holes, explosiveId)` — `CHARGE_DEFAULT_STEMMING_M`
raised in 0.1 m steps until filling every planned and drilled hole with the selected explosive stays
within `permitLimitsFor(grade).maxChargeKg`, counting each fill as loaded (floored to 0.1 kg), so it
steps back down while the real load still fits (2.8 m for nine 5 m boomite holes at grade 0:
4.4 kg each, 39.6 of 40 kg). No holes, or a permit no stemming shorter than the shallowest hole
can meet, keeps 2.5 m, and the over-permit warning says so. The Drill grid opens at
`DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M[grade]` (5 m at grade 0, else 8 m). Both yield the moment the
player steps the matching stepper (stemming, depth); the over-permit warning stays.

**Placement is physics-only.** Where fragments and debris land is decided by blast physics
alone and is never adjusted, rejected or relocated for reachability. No reachability query lives in
`src/core/mining` or fragment/physics code. Debris stranded outside the ground crew's reachable set
belongs to the player: connect it (ramp, levelling, another blast) or leave it.

**Levelling a crater.** A `level_ground` order's work target is the reachable column
(`employeeClimbReach`) of its rectangle nearest the rect's min corner (`pickReachableColumn`), so a
rectangle the crew can partly reach starts instead of waiting `target_unreachable`; when none is
reachable the target stays the corner and the order waits. The digger carves as it works
(`carveLevelColumnsStep`, each tick's share of the columns left; the payload's `levelCursor` counts
columns done), and completion carves the remainder.

`MuckPileSummary.summariseMuckPile` reads the settled pile back: size and speed spread, and how
much rock rests on nothing. Clearance is per column against **the pile beneath**, not the terrain —
rock stacked in a heap sits metres above the floor and is resting, not floating. Both state bridges
expose it as `muckPile`, so a browser harness and a headless run read the same numbers.

## Damage

- **Standing on the blast** is fatal regardless of the charge — the ground is simply gone.
  `blastCommand` kills employees and destroys vehicles on any cleared column. Evacuating the zone
  first (`Zone.ts`) is the point of the safety drill.
- **Stuck walker counts as stranded:** an armed blast never waits on an in-zone employee who
  cannot move. `isStuckWalker` (`DetonationSequence.ts`) = `isMoveStuck` or `moveConsecutiveFailures >=
  DETONATION_STUCK_WALKER_FAILURE_TICKS` (10). `detonationPhase` lists such an employee among the
  stranded names (all stranded, none walking -> `stranded`; mixed stays `evacuating`), and
  `tickDetonation` latches them into `strandedEmployeeIds` every tick so a counter reset by re-evacuation
  cannot revert the verdict. Employees only; vehicles keep the parked-vehicle rescue logic (`gameplay-vehicle-fleet`). Fire anyway and
  Cancel unchanged.
- **Landing impacts** go through `Damage.processProjections`, keyed on where fragments came to rest
  and how fast they were going.
- **Buildings** are destroyed when a cleared voxel falls under their footprint.


## Blast Report and Rating

`BlastResult` carries `clearedVoxels`, `crackedVoxels`, fragment counts and sizes, `projectionCount`,
`maxThrowDistance`, `projectileCount`, `flights`, ore value, vibration, and destroyed buildings.

Rating is driven by **how far rock was actually thrown** (`THROW_DISTANCE_BAD` /
`THROW_DISTANCE_CATASTROPHIC`), projection share and vibration — not by speed. Rock that lands back
in its own muck pile is a good blast however fast it left. `BlastReport.maxProjectionDistanceM` is that
traced `maxThrowDistance`, so the report modal, console and rating agree.

### Rating caps

`calculateRating` stays the base rule (`BlastResult.rating`). `buildBlastReport` then applies hard
ceilings via `applyRatingCaps` (`BlastRatingCaps.ts`), so `BlastReport.rating` is the capped value;
`baseRating` and `ratingCap` are set only when a cap actually lowered it (cap = first rule that did).
Caps only lower; precedence, most severe first:

| Cap id | Condition | Ceiling |
|--------|-----------|---------|
| `death` | any employee death | catastrophic |
| `casualty_or_destruction` | any injury, or any destroyed building (union by id of `result.destroyedBuildings` and `building_destroyed` accidents) | bad |
| `fizzled_failure` | fizzled charges / charged holes >= `BLAST_FIZZLE_SHARE_FAILURE` (0.75; `fizzleShare`, 0 charged = 0) | bad |
| `fizzled_partial` | same share >= `BLAST_FIZZLE_SHARE_PARTIAL` (0.25) | mediocre |
| `no_breakout` | rock was cleared but no cleared voxel reached its column's pre-blast top (`BlastResult.brokeOut` false) | bad |
| `sealed_failure` | sealed fragments / fragments >= `BLAST_SEALED_SHARE_FAILURE` (0.75; `sealedShare`, 0 fragments = 0) | bad |
| `sealed_partial` | same share >= `BLAST_SEALED_SHARE_PARTIAL` (0.25) | mediocre |
| `wet_holes` | wet holes with at least one fizzled charge (wet holes whose charges fired no longer cap) | good |
| `oversize` | oversized fragments / fragments strictly above `BLAST_OVERSIZE_SHARE_CAP` (0.30, 0 fragments = 0 share) | good |

Vehicle-only loss does not cap. Console `Rating:` and the report modal read the capped value; the
modal shows a note card first and the console a `mining.blast.rating_cap_*` line when a cap applied.

## Playback

`FragmentAnimator` walks each fragment from where it broke to where it settled. Horizontal motion is
straight; the vertical is the parabola joining those points in the flight's own duration under
gravity, so **the animation cannot end anywhere but the fragment's authoritative position**. For a
straight drop it reduces to free fall from rest. Skipping playback entirely is always safe.

While airborne a fragment also tumbles about its own seeded axis, at a rate scaled by how hard it
was thrown (`impactSpeed` against `MAX_PROJECTION_VELOCITY`; a mere drop barely rotates —
`TUMBLE_DROP_FACTOR`, `TUMBLE_MAX_RATE_RAD_S`). On landing it eases the tumble back to exactly its
untumbled spawn orientation while its scale does a damped squash-and-stretch bounce
(`SETTLE_DURATION_S`, `SETTLE_SQUASH_MAGNITUDE`, `SETTLE_BOUNCE_OSCILLATIONS`), then snaps to the
identity transform rather than approaching it asymptotically. This math (`FragmentTransformMath.ts`)
is a pure function of `(flight, t)`, so a seek and a run of per-frame updates landing on the same `t`
agree, and `finish()` puts every fragment at exactly the untumbled, unsettled rest transform.

**A screenshot taken right after a blast is a screenshot of an animation, not of a muck pile.**
`SceneManager` caps a frame at 0.1 s of animation time, and a frame costs seconds without a GPU, so
a collapse takes many minutes of wall clock to finish on screen and rock photographs as if it were
floating. `FragmentAnimator.finish()` — `window.__skipBlastPlayback()` from a harness — puts every
fragment on its resting place in one write, and `seek(t)` — `window.__seekBlastPlayback(t)` — holds
the collapse at an exact moment, so a frame-by-frame series lands on the times it asked for rather
than the times the frame rate allowed.

**Fragment meshes** (`FragmentMesh.ts`) are instanced: 24 shared geometries, each a unit cube sliced
by seeded planes into a closed convex "cut stone" (`FragmentGeometry.ts`), scaled per instance to the
fragment's half-extents, with a seeded orientation and slight shear so instances of one variant read
as different rocks. The stones are watertight by construction and by test — never go back to
jittering a box's vertices, whose per-face duplicates tear apart into floating planes. The
rotation/shear/scale part of a fragment's spawn transform never changes over its life and is built
once (`buildBaseTransform`); each frame's `updateTransforms` recomposes only the cheap part —
position, tumble rotation, settle scale — on top of it (`composeInstanceMatrix`), so a settled
fragment's matrix is bit-identical to its spawn one. Never decompose/recompose the instance matrix
as TRS — the shear does not survive that round trip.

**The whole blast resolves synchronously inside the click**, so the pipeline's cost is a frame the
player feels. Its hot paths are engineered accordingly — a typed-array heap reused by every hole's
Dijkstra in propagation, per-voxel seed-list caching in fragment generation, a spatial hash in projectile grouping, memoised
surface queries under the arcs. Profile before and after touching any of them; a 16-hole blast
budget is ~300 ms.

## Loading a saved plan

`blast_plan load name:X` queues orders; it never writes finished holes. Each saved hole becomes a planned hole (fresh unique id, `addHole` skips ids live in `drillHoles`/`plannedDrillHoles`) with one `drill_hole` order; each saved charge becomes one `charge_hole` order (cost deducted, `plannedChargesByHole` filled). Saved holes at an x,z already drilled or planned are skipped; orphan charges are skipped. Pre-checks (claim, `createCharge`, funds) are all-or-nothing. Charge-after-drill gate: `isHoleOrderClaimable` (ActionSelection.ts) keeps a `charge_hole` unclaimable while its hole is still in `plannedDrillHoles`, applied in targeted, pool and starvation claim paths. Removing the planned hole cancels and refunds its charge order.

Hole ids are monotonic (`state.nextHoleId`, saved with the game, v29 migration backfills it) except `drill_plan grid`, which replaces the plan and restarts at H1; removing a hole never reuses an id.

## Drill grid

`drill_plan grid rows:R cols:C spacing:S [burden:B] [pattern:square|staggered] depth:D [diameter:] start:x,z` replaces the plan with a rows × cols pattern (`createGridPlan`, `gridCellPositions`, `DrillPlan.ts`): holes `spacing` apart along x, rows `burden` apart along z (burden defaults to the spacing). `pattern:staggered` (`GRID_LAYOUTS`) shifts every odd row by `floor(spacing / 2)` and drops that row's last hole, so the pattern stays inside the rows × cols rectangle (4 + 3 + 4 holes for 3 rows × 4 cols); a one-column grid is never shifted. Refused: spacing or burden not above 0 (`mining.drill_plan.invalid_spacing`), an unknown pattern (`mining.drill_plan.invalid_pattern`, listing the layouts). Output: `Drill plan: R×C [staggered ]grid, N holes ordered, spacing Sm[, burden Bm], depth Dm`.

- **Pattern cell.** A grid hole carries `spacingM` / `burdenM` (`createHolesAt(..., cell)`), copied to the drilled hole by `landDrilledHole`; `holeCellSize(hole, holes)` reads them, and a hole added on its own falls back to the nearest-neighbour square (`holeSpacingM`, capped at `HOLE_CELL_MAX_SIDE_M`). `patternAreaM2(holes)` sums the cells: the area the blast permit measures (`gameplay-game-design`), so a finer mesh over the same ground costs drilling, not permit area.
- **Drill step strip.** The grid tool's strip has the fields spacing, burden, depth and diameter — the burden (`[data-field="burden"]`) follows the spacing until the player steps it — and a `grid-layout` action toggling aligned / staggered; its overlay marks the exact hole cells (`holeCells`). Under the grid tool and Add Hole alike, a readout line reads `Drilling: {holes} holes · {metres} m · ≈ {time} of rig work · ${cost}` (`ui.blast_workshop.drill.drill_readout`): rig work is `estimateDrillWorkTicks(holes, rigTier)` with the best drill rig the fleet owns (tier 1 with none; crew at base proficiency, travel excluded), cash is the holes × `drillHoleCost(depth, diameter)`; while the plan stays within the permit a second line reads `Permit area: used / limit m²`. The stat strip shows Pattern (`cols × rows`, `· staggered`), Mesh (`data-role="drill-mesh"`, `S × B m`) and Depth; the holes header shows the plan's area against the permit (`data-role="permit-area"`).
- **Drilling cost.** `drillHoleCost(depth, diameter) = round(DRILL_COST_PER_METRE × depth × diameter / 0.089)` (12 per metre of 89 mm hole) is paid as each hole is finished (the `drill_hole` completion, `TaskCompletionEffects.ts`), booked under the `drilling` expense category.

## Pattern charge settings

`charge hole:* explosive:X stemming:M` fills every drilled hole not yet covered up to the stemming (omitted: `CHARGE_DEFAULT_STEMMING_M`) and stores the settings on the pattern (`state.patternCharge`, a `PatternCharge` whose null `amountKg` means fill; repeat overwrites; output line `mining.charge.pattern_set_fill`); a hole drilled later is charged automatically the moment it lands (`autoChargeHole`, called by the `drill_hole` completion), filled to its own depth and bore. `amount:N` instead orders an explicit partial charge of N kg in every hole, for scripts; the UI never sends it. Every hole is checked first (`batchCharge`): one hole's `createCharge` refusal refuses the whole command, listing each hole's error, and nothing is stored or ordered. Logic lives in `src/core/mining/ChargeOrder.ts` (core), the console only parses and formats.

- **Vehicle work.** Each `charge_hole` order needs a charging truck and a blasting + `driving.truck` crew member; without them it waits with an availability reason (see `gameplay-vehicle-fleet`).
- **Skip covered.** A hole is covered when charged or holding an outstanding `charge_hole` order; Charge All and auto-charge skip it. A cancelled order is not re-ordered automatically: run Charge All again.
- **Pay on fill.** Orders are free to place; stock and cash are paid when the blaster finishes loading the hole. The claim gate skips an order the player cannot afford; if cash fell short by completion the order is re-queued and nothing loads. Saves older than v37 migrate prepaid orders: refunded, payload fields stripped.
- **Refusals.** `charge hole:*` with no drilled and no planned hole is refused (`mining.charge.nothing_to_charge`); with every drilled hole already charged or ordered and nothing planned, `mining.charge.all_covered`. Only planned holes: succeeds and stores the settings. `blast` with no drilled hole holding a loaded (or loading) charge is refused (`mining.blast.no_charged_holes`); nothing mutates.
- **Per-hole override.** `charge hole:<id>` does not touch the pattern; it re-orders that hole as before.
- **Reset and edge cases.** `resetPlanState` (clear, post-blast) clears the pattern. An explosive the level does not offer clears the pattern; a failing `createCharge` for one hole leaves it uncharged, never throws.
- **Replacing a pattern.** `drill_plan grid` over drilled or charged holes is refused unless `confirm:true` (`mining.drill_plan.confirm_replace`, names the counts); the Drill step opens a ConfirmModal (`replacePatternConfirm.ts`) and re-runs with `confirm:true`. A plan of only ordered-not-yet-drilled holes needs no confirm.
- **Tubing excluded.** `install_tubing` stays a separate per-hole action; it is not part of the pattern.
- **Hole water.** Wetness is per-hole stored water (`state.holeWater`), not "is it raining now": it builds in rain and fades afterwards, slower in porous rock. Tubing blocks new water but does not remove old water; `drain_hole` does, at `HOLE_DRAIN_COST_PER_HOLE`, except an untubed hole in porous rock. Details in `gameplay-game-design` (Weather).
- **Held detonation and rain exposure.** When the zone is clear but `fizzlingHoles` (wet holes carrying a water-sensitive charge) is non-empty, `detonationPhase` reports `held` instead of `ready`: the armed detonation stays pending, tick auto-fire does not fire, and `blast detonate` / the pre-flight modal show the holes with Cancel and Blast anyway (`blast` fires regardless). Evacuating and stranded take precedence. `rainExposedHoles` (charged, untubed, water-sensitive holes while it rains) drives the pre-flight, Fire-step and drain-button rain warnings; tubing or a water-resistant explosive clears them. All read from `GameState`, never re-simulated.

## Undrilled holes at fire time

Firing with ordered-but-undrilled holes (`plannedDrillHoles`) warns in the preflight modal (`warn_undrilled`), never gates FIRE; a successful blast cancels every outstanding `drill_hole` order (`cancelOutstandingDrillActions`) and reports the count. Refused blasts cancel nothing.

## Software Upgrades (Prediction Tools)

| Tier | Name | Shows |
|------|------|-------|
| 0 | None | Energy heatmap only (free, Blast Workshop toggle) |
| 1 | "Fragment Distribution" | Fragment size distribution: average size, oversized count, band volumes (good, fines, dust), value lost to dust |
| 2 | "Projection Risk" | Projection risk zones tinted on the terrain (`ProjectionZoneOverlay`), plus the dry-run figures: predicted rating, thrown share, furthest throw |
| 3 | "Vibration Model" | Vibration at the level's villages |
| 4 | "Charge Optimizer" | Charge optimizer: "Optimize charges" in the Charge step, `optimize_charges` in the console |

Energy is free at every tier through the workshop heatmap. Tier prices stay `SOFTWARE_TIER_COSTS` (500 / 2000 / 5000 / 12000) and a saved game keeps its tier number, so it gets that tier's new content. Tier numbers come from `SOFTWARE_TIER_FRAGMENTS`, `SOFTWARE_TIER_PROJECTIONS`, `SOFTWARE_TIER_VIBRATIONS` and `SOFTWARE_TIER_OPTIMIZER` in `balance.ts`. One dry run (`dryRunBlast`) serves T1 and T2 in `blast_preview`; `fragmentDistributionFrom` reads the T1 figures off it. The Preview step at tier 0 shows no gated stat and points to the heatmap; a locked row reads "Requires blasting software T{n}: <what it shows>", and every row is `explainable`. `lastBlastPreview.shape` (`BLAST_PREVIEW_SHAPE`) marks the content line-up; a save carrying another shape loads the preview as null. The console `preview energy` is ungated; `preview fragments|projections|vibrations` follow the tiers above.

**Charge optimizer (T4, `ChargeOptimizer.ts`).** `optimizeCharges(holes, grid, options)` is pure: it sweeps every offered explosive over `optimizerSweepSteps` stemmings (up to `OPTIMIZER_SWEEP_STEPS` 16, at least `OPTIMIZER_MIN_SWEEP_STEPS`, fewer as hole x explosive count passes `OPTIMIZER_WORK_BUDGET`), each hole filled at the same point of its own `stemmingSweepRangeM`, most explosive first — only stemmings from the full-stemming length up, so a proposal never trades flyrock for fragmentation — as uniform plans through `previewPlanBands`. It keeps per hole the cheapest sample within `OPTIMIZER_GOOD_TOLERANCE` of its best good share; while the total passes the permit kg it steps down the hole losing the least good share per kg saved; then it returns the better of that mix and the best uniform plan by pooled good share. Wet holes never get a water-sensitive explosive; a hole nothing suits (no stemming range, nothing fits) lands in `skippedHoleIds`. `optimizerOptionsFor(state)` reads the level's explosives, wet holes and `permitLimitsFor(grade).maxChargeKg`. The Charge step (`chargeOptimizerBlock.ts`) computes on click and orders nothing until "Apply to all" or a row's "Apply" sends `charge hole:<id> explosive:<id> stemming:<m>m` (the hole filled to its proposed stemming); below T4 it shows only a hint naming the software. Console: `optimize_charges [apply:true]` (T4 gated; without `apply:true` it only reports, one line per hole with explosive, kg and stemming).

Previews run the **same** propagation the blast does (`buildPlanEnergyField`) and the same seeding
and velocity maths. A preview that models the rock differently from the game is worse than no
preview — never reintroduce a separate approximation. Previews also take the wet-hole set (`wetHoleIdsFor`, the same one `executeBlast` receives), so water-sensitive charges in holes holding water (`state.holeWater`) are predicted weakened.

### Detonation and Workshop steps

No detonation sequence exists: every charge fires together at blast start (no per-hole order or delay). The Blast Workshop has 4 steps: Drill, Charge, Preview, Fire. A save carrying a stray `sequenceDelays` key ignores it.

### Village vibration

Villages come from the level's structure set (`PlayableArea.villages()`, the same set the renderer
draws; ids `village-<i>`, ground level). Both `executeBlast` and `previewVibrations` measure from the
mean hole position (distance clamped to 1 m); every charge fires together, so vibration is
`totalChargeKg(holes, charges)^0.7 / distance^1.5 x groundFactor` (scalar over all charged holes) with ground factor = base x `averageVibrationMod`
(charged holes, equal weight, wet holes included), so preview equals blast; callers pass the factor.
The blast report carries `maxVibration`; `blast` lowers neighbour relations (`nuisance`) by `maxVibration x
VILLAGE_VIBRATION_SCORE_GAIN` via `recordVibration`, separate from the projection term
(`BLAST_PROJECTION_NUISANCE_PER_PROJECTION`). For `SCORE_VIBRATION_WINDOW_TICKS` ticks after the blast the tick pipeline
also feeds the same scaled value to `updateScores`. The gain is large (15000) because PPV falls off as
distance^-1.5 (~4e-4 mm/s at 445 m for an ordinary Grumpstone Ridge blast); it targets ~1-3 neighbour-relations
points for an ordinary blast and ~5 for an oversized one.

## Working on this pipeline

- Balance guards live in `tests/integration/blast-balance-matrix.integration.test.ts`. They assert
  *relationships* (more explosive breaks more; tighter spacing gives finer muck; stemming controls
  throw), so retuning constants keeps them meaningful. Run them after touching any constant.
- Danger is covered by `tests/integration/blast-flyrock-danger.integration.test.ts`. Anything that
  moves landed rock after it comes to rest touches this: pulling flyrock a couple of metres back
  toward the pit is enough to stop an unstemmed blast hurting the crew beside it.
- `scripts/verify-blast-visual.ts` photographs a blast before, mid-collapse and settled, and dumps
  the muck pile behind each shot. Its camera looks *into* the site: a blast digs a hole, and from
  eye level the crater's rim hides everything in it. `setOrbit` takes **degrees**.

## Charge cost

Each charge is paid in cash at list price as its hole is loaded (`loadChargeExplosive`, `ChargeLoad.ts`); every cost shown to the player is that list price. `BlastReport.spent` is that cash. Detail in `gameplay-game-design`.

## EST. ORE VALUE

`estimateBlastOreValue(plan, surveys, grid, wetHoleIds)` (`BlastValueEstimate.ts`) values the ore the blast will actually break. It runs the blast's own propagation (`buildPlanEnergyField` + `identifyFragmentedVoxels`, the same code the preview and `executeBlast` use), so the broken volume matches; wet holes are treated as the blast treats them. Each broken 1 m voxel is read from the newest fresh survey covering its column at the voxel's own depth (`oresSurveyedAt`, see `gameplay-survey-system`): value += density x `ORE_DENSITY_KG_M3` x catalog `valuePerKg` x survey `confidence`. Ore a survey did not locate at that depth counts for nothing (aerial counts its top 2 m only). The grid supplies rock geometry only, never ore. Only ore predicted to break out counts: voxels in `predictBreakout`'s `sealedKeys` are excluded from the value and margin and reported apart as `BlastOreEstimate.sealedValue` / `sealedVoxels` (footer line `data-role="footer-sealed"`), matching `BlastResult.totalOreValue` vs `sealedOreValue`. Uncharged holes or an empty plan give 0. The footer and preflight modal memoise it (`oreEstimateMemo.ts`) on holes, charges, wet holes, survey ids/stale flags and the grid's dirty-chunk count.

`BLAST_ESTIMATE_TOLERANCE` (0.35) is the working accuracy target: with a fresh seismic survey (or core samples on every column) covering the pattern, the estimate lands within +-35% of the actual ore value (sandbox at `ore_grade:1`, 3x3, spacing 4, depth 8, each hole filled to `CHARGE_DEFAULT_STEMMING_M`: desert_badlands (36,32) boomite seed 42, green_foothills (32,32) krackle seed 42, alpine_granite (36,32) shatternite seed 13; `tests/integration/survey.integration.test.ts`). Measured: seismic 0.89/0.77/0.94; core samples 0.93/0.92/0.94; aerial 0.10-0.14 by design.

## BURIED HOLES

Progression sites only (`isProgressionSite`; other sites are unchanged). A planned drill hole (`state.plannedDrillHoles`) is **buried** while any `on_ground` fragment covers its cell. A fragment covers cells from `position - halfExtents` to `position + halfExtents`, rounded with `Math.round` (the nav grid's convention), inclusive in x and z; a fragment without `halfExtents` covers one cell. `in_transit` and `stored` fragments never bury. `src/core/mining/BuriedHoles.ts` indexes covered cells once per tick (`buildBuriedCellIndex`, cache keyed on state, tick and fragment count) and answers per hole in O(1) (`buriedHolesOf`, `isHoleBuried`, `fragmentBuriesPlannedHole`). A buried hole's `drill_hole` order stays pending (not claimable, `isHoleOrderClaimable`) with `blockedReason` `buried_under_rubble`, cleared once the rubble is hauled away; a drill already in progress continues. A `haul_debris` or `fragment_debris` of a fragment burying a planned hole gets `BURIED_HOLE_HAUL_PRIORITY_BONUS_TICKS` (64, `balance.ts`) off its sort key like the ore demand bonus (ranking only; set to 0 to reverse; a boulder leaves the hole only once broken), and is exempt from barren-yields-to-ore: planning a pattern over a rubble-strewn floor is how the player has the crew clear exactly those holes first. The console `drill_plan show` tags such holes "buried"; the Blast Workshop Drill step shows "N planned (M buried)" and a warning "Buried" chip on their rows.

**Buried holes wait for the player.** A `buried_under_rubble` hole is never removed or re-planned by core. When its rubble sits on a floor the vehicle network no longer reaches, nothing happens by itself: the player orders a ramp down (or levels the ground), and the existing rubble-first haul priority (`BURIED_HOLE_HAUL_PRIORITY_BONUS_TICKS`) then clears the holes and the driller resumes. See `gameplay-navmesh`, "Crater access is the player's job".

## Pre-Flight building reach

`buildingsInBlastReach` (`BlastPlan.ts`) warns of buildings the planned holes may hit (the Pre-Flight building rows). Its default margin is charge-derived, not the hole spacing:

- `holeBlastReachM(charge, depth) = BLAST_REACH_M_PER_SQRT_ENERGY * sqrt(computeInitialEnergy(charge, depth))` (`balance.ts`, 0.045 m per sqrt energy unit). Stemming efficiency and explosive energy are inside `computeInitialEnergy`; an undefined charge, unknown explosive or 0 kg gives 0.
- Margin = max reach over all holes (simplification: one margin for the whole pattern, not per hole); an uncharged hole contributes 0. An explicit `marginM` overrides.
- The margin grows the holes' bounding box (`computeDangerZone`); a footprint cell at distance D from the box edge is flagged when D <= reach (whole cell, inclusive edge).
- Reference (3x3 grid, 4 m spacing, 8 m deep, 2.4 m stemming): Krackle 8 kg ~2.55 m, Shatternite 11 kg ~3.95 m, Dynatomics 11 kg ~5.38 m.
- Flying rock is not modelled; the reach covers breakage only.

## WALL STABILITY

Progression sites only (`isProgressionSite`; other sites and campaign levels never slump). After a blast that cleared voxels, `fireBlastSteps` runs `applyWallSlumps` (`src/console/commands/mining/wallSlump.ts`) after the occupancy update and before `warmOrderReachability`. Core rule in `src/core/mining/WallStability.ts`.

- **Safe face height.** `RockType.safeFaceHeightM` comes from `hardnessTier` via `WALL_SAFE_FACE_HEIGHT_M_BY_TIER` (12/15/20/25/30 m); `getSafeFaceHeightM(rockId)` reads it (unknown rock = tier 1).
- **Face.** A continuous strict drop between neighbouring columns along one of the four axis directions (column top = `computeVoxelColumnSurfaceY`, 1 m voxels). A flat step of `WALL_BERM_MIN_WIDTH_M` (3) columns, landing column included, ends a face; a 2 m flat does not. A rise or missing column also ends it. Height = crest top - toe top.
- **Fails when** height is strictly greater than the safe height of the weakest rock (minimum over the dominant rock of every wall voxel). Exactly at the height never slumps.
- **Slump.** Material above `toeY + safe` in the crest column, the `WALL_SLUMP_DEPTH_M - 1` columns behind it and the face's own columns is removed and re-deposited as fill on the floor: toe column first, then floor columns at toe level spreading outward (Chebyshev distance, then x, then z, within `WALL_SLUMP_PILE_SEARCH_RADIUS_M`), at most `WALL_SLUMP_PILE_MAX_HEIGHT_M` per column; any remainder stacks on the toe so volume is never lost. Fill voxels keep composition and ores (one-to-one). Never cuts below the toe level. `SlumpReport.volumeM3` is the count of 1 m voxels moved; `toeColumns` is the damage zone.
- **Deterministic, one pass, no cascade.** Faces are applied in sorted order (crest x, z, direction) from one scan; a cut leaves a 2 m ledge, so a very tall wall can slump again after a later nearby blast. Berms (3+ columns) are the cure.
- **Bounded cost.** Only the blast's cleared region plus `WALL_STABILITY_REGION_MARGIN_M` (8) is scanned, column tops read once for all four directions. A 12x12 clear costs about 784 columns and ~2 ms.
- **Effects.** Per slump: `terrain:updated` over the touched voxels (nav grid follows), employees/vehicles/buildings in the toe zone take blast-like damage (`processProjections` with a synthetic rockfall per toe column at `WALL_SLUMP_IMPACT_SPEED_MS`), `state.damage.wallSlumpCount` increments (serialized as `wallSlumpCount`), `mining:wall_slump` `{x, z, volumeM3}` (toe position) raises a warn notification ("The geologist did warn you."), and the blast report gains a `mining.blast.wall_slump` line.
- Digs and ramp cuts do not trigger it in v1.

## Wall warning prediction and overlay

On progression sites the player sees an unstable wall before it falls. `predictWallFaces(plan, grid, wetHoleIds)` (`WallStability.ts`) runs the blast's own propagation and fragmentation read-only (`buildPlanEnergyField` + `identifyFragmentedVoxels`, wet holes honoured), scans a virtual surface with the broken voxels removed over the region `executeBlast` reports as cleared, and runs the slump pass's own face scan (`findFacesAtRisk`, default `WALL_WARN_RATIO` 0.8: warns from 80% of the safe height, so amber-band faces are listed with their `ratio` although they do not slump) so no second rule exists. The Blast Workshop Preview step (`preview-wall-warning`) and the Preflight modal (`preflight-wall-warning`) list each predicted face ("leaves a 22 m face in molite (safe: 15 m). It may slump."); neither gates detonation. The geology overlay (toggle `wall-overlay-toggle` in the Survey panel header, key W, off by default) tints the faces the armed plan would leave plus the site's current at-risk faces: amber from `WALL_WARN_RATIO` (0.8) of the safe height, red at or over it. Off progression sites there is no warning and no overlay entry.

History: docs/context-history/gameplay-blast-system.md
