---
name: gameplay-blast-system
description: >
  Full blast pipeline specification for BlastSimulator2026: energy propagation through the voxel
  grid, which voxels break, carving the broken rock into fragments, and where those fragments end
  up. Covers voxel rock composition, the free-face and stemming mechanics, projectile grouping, and
  how the renderer plays a collapse back. Use when working on blast mechanics, mining systems,
  fragment physics, or voxel grid code.
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

The blast plan overlay (ordered-hole ghosts, drilled/charged tubes) is redrawn from the state on every state replacement (save load) and level load, not only after planning commands; an empty state resets it so no old hole stays drawn or clickable (#1877).

## Voxel Data Model

**Voxel size:** 1 m × 1 m × 1 m cells (SI units throughout).

Up to 4 rock types per voxel with coefficients summing to 1.0, generated from per-rock 3D Simplex
noise plus level bias. Ore sits in veins from a separate high-threshold field. A voxel also carries
a `fractureModifier` (< 1.0 where an earlier blast cracked it).

## Step 1 — Energy Propagation

Charges deposit energy into the voxels holding them; each voxel keeps what its rock can absorb and
hands the rest to its neighbours. Runs on flat typed arrays over the blast's bounding box — never
per-voxel objects or string keys, which a blast revisits far too often to afford.

- **Charge column.** The explosive fills the length its own mass needs
  (`CHARGE_KG_PER_METRE`) from the bottom of the hole. Stemming does *not* shorten it; poor stemming
  is priced into `stemmingEfficiency` instead. Clamped to the world floor so an over-deep hole
  cannot lose part of its charge.
- **Hole fit.** Charge column (`amountKg / CHARGE_KG_PER_METRE`) plus stemming must fit the hole depth; `createCharge` refuses an overflow (`mining.charge.column_exceeds_hole`, quoting the max kg that fits, `maxChargeKgForHole`). The Charge step shows the same limit and disables Charge All; the stepper is never clamped.
- **Hole diameter (#1934).** Each hole has a diameter, chosen per drill plan from `DRILL_HOLE_DIAMETER_OPTIONS_M` (89 / 127 / 165 mm, default 89). A hole holds `chargeKgPerMetre(d) = CHARGE_KG_PER_METRE * (d / 0.089)^2` kg per metre (2.0 / ~4.07 / ~6.87), so every fit check (`chargeColumnM`, `maxChargeKgForHole`, `chargeFitsHole`, `maxFittingChargeKg`, `createCharge`) and the energy column (`buildHoleSeeds`: cells = kg / kg-per-metre, min 1) take the hole's diameter. An explosive's catalog min/max kg per hole scale by `holeCapacityFactor` (`explosiveHoleLimits`), exactly 1 at 89 mm. A wider bore needs a stronger rig (`minRigTierForDiameter`, see `gameplay-vehicle-fleet`). Console `drill_plan grid|add diameter:` takes mm or m (`normaliseHoleDiameter`), anything else is refused listing the options. The Charge step bounds the amount by the narrowest drilled hole and fits against the tightest hole.
- **Absorption threshold** = rock mix weighted by `energyAbsorption`, × `fractureModifier`, ×
  `confinementFactor(distToAir)`. **Rock near a free face breaks for a fraction of the energy**
  (`UNCONFINED_THRESHOLD_FACTOR`, ramping to full over `CONFINEMENT_FULL_DEPTH`) — this is why bench
  blasting works at all.
- **Explosive tier shortfall (#1358).** An explosive never refuses rock; rock harder than its
  `minRockTier` just costs more. Per column, the nearest *charged* hole (horizontal distance) names
  the explosive; each rock voxel's threshold is multiplied by
  `TIER_SHORTFALL_THRESHOLD_FACTOR ** max(0, rockTier - minRockTier)` (`ExplosiveRockFit.ts`),
  rock tier = `hardnessTier` of the voxel's dominant rock (air: 0). The factor is applied inside
  `createEnergyField` through an optional per-column lookup, so `EnergyPropagation` stays unaware of
  explosives; `buildBlastEnergyField` builds that lookup, which covers both `executeBlast` and the
  previews (`buildPlanEnergyField`). No charged holes: no lookup, no gating.
- **Charge step warning.** For the selected explosive, the Charge step samples the dominant rock
  along each drilled hole (`dominantRockAlongColumn`, modal rock, higher tier wins ties) and,
  via `weakHoleSummary`, shows `data-warning="weak-explosive"` naming the hardest offending rock and
  "N of M holes". Advisory: Charge All stays enabled.
- **Spread** goes to the 18 face-and-edge neighbours, weighted by 1/distance and biased toward
  neighbours nearer a free face (`FREE_FACE_BIAS`, via `freeFaceWeight`). Air above always pulls; a side
  or lower face pulls only within `FREE_FACE_LATERAL_RANGE_M` (4 m) of the rock, so an excavation beside
  a pattern (an access ramp dug first) cannot drag energy off distant charges and leave pillars (#1793).
  Spread loses `transmissionLoss` (derived from rock
  porosity) at each step. Air neither absorbs nor carries: a void shields what is behind it.
- **Energy is conserved.** `seeded == Σ effective + dissipated`. Keep it that way.

Two derived readings matter downstream:

- `effectiveAt` — energy a voxel retained. **Capped at its threshold**, so it is *useless* as a
  measure of violence: every broken voxel reads exactly 1.0× threshold.
- `intensityAt` — `(effective + overflowOut) / threshold`, the energy that passed *through*.
  This is the signal fragment generation seeds from. 1.0 means "just barely broke".

## Step 2 — What Breaks

Four passes, in order:

1. **Energy** — `effective >= FRAGMENTATION_MULTIPLIER × threshold` breaks. Between
   `CRACKED_VOXEL_ENERGY_RATIO` and that, the voxel survives but is weakened
   (`CRACKED_VOXEL_WEAKENING` on its fracture modifier) for the next blast.
2. **Undermined burden** — a cap of intact rock up to `BURDEN_BREAKOUT_MAX` thick over a broken
   zone, with air above it, lifts rather than being crushed. Without this a charge carves a sealed
   cavity under intact ground at *any* size and the player sees nothing happen. Thicker burden still
   holds, which is what makes an over-buried charge visibly fail to break out.
3. **Floor to grade (#1723)** — sub-drilling. `EnergyField.gradeY` is the world Y of the highest
   charged hole bottom, plus `BLAST_GRADE_FLOOR_OFFSET_M` (null when nothing is charged; `seedEnergy`
   sets it). In every footprint column (one with at least one voxel already broken), `floorToGrade`
   breaks the standing rock below the column's topmost broken voxel down to `gradeY`, but never more
   than `BLAST_GRADE_MAX_CUT_M` below that column's lowest broken voxel, so a deep outlier hole
   cannot gouge the pit. A hole's one-voxel breakout under grade is left standing beside any column
   ending at grade, whichever pass broke it (neighbours read from a pre-lift snapshot; a cut clamped
   above grade does not count), so the floor is flush; a lone hole keeps its pit. The lift floods: an 8-connected group of columns all ending exactly one voxel under grade lifts whole when any member neighbours a column at grade (pre-lift snapshot), so pockets between close holes (3 m spacing) are flush too; **enclosed pillars (#1825)**: an unbroken column with no 4-connected path of unbroken columns to the box shell (the centre of a square of four close holes, 4 m spacing) is floored too, from its highest solid voxel down to the region's floor (`max(gradeY, lowest bordering footprint column - BLAST_GRADE_MAX_CUT_M)`); air is skipped, and only a pillar bordered by a column whose broken zone reaches its own top (the cap lifted off) is floored, so a sealed shot that never broke out stays sealed (#1724); columns touching the shell, a ring with a gap, lone-hole pits and gradeY null are unchanged; a group with no grade neighbour stays, and deeper columns neither lift nor carry the fill. It returns the voxels it added (`FragmentationResult.gradedCount`). The
   marks join the mask, so fragments, cleared voxels, the pre-blast estimate and the ore report
   follow the real broken volume; energy is untouched. Without it a pattern leaves pits under the
   holes and 1-4 m ridges between them, steeper than `NAV_MAX_SLOPE_DEGREES`, and one ramp into the
   crater reaches only its landing. A 3x3, spacing 4, 8 m krackle crater (sandbox `desert_badlands`
   seed 42) ends as one flat floor; a ramp reaches over 90% of its columns. Pits of a light
   charge that do not touch stay separate floors.
4. **Unsupported rock** — flood-fill the survivors from the box shell; anything the fill never
   reaches was standing on nothing and comes down.

## Step 3 — Carving Fragments

Broken voxels are diced into sub-cells (`SUB_CELL_RESOLUTION`), seed points scattered in proportion
to intensity, and each sub-cell joins its nearest seed. The clusters are the fragments.

```
seeds(v) = SEEDS_BASE + SEEDS_PER_INTENSITY × (intensity(v) − FRAGMENTATION_MULTIPLIER)
```

`SEEDS_BASE` is below 1 on purpose: a barely-broken voxel usually contributes **no** seed, so its
rock is swallowed by a neighbouring cluster and comes out as one large boulder. That is where an
undercharged blast's oversize comes from. Rock no seed claims forms its own connected lumps.

**Fragment size follows from the blast alone.** There is no fragment budget anywhere in this path —
`MAX_FRAGMENTS_PER_BLAST` is a guard against pathological input, never a tuning dial. Physics cost
is capped separately, in step 4, by grouping. **Volume is conserved**: Σ fragment volume = broken
voxel count, exactly.

A fragment carries the volume-weighted rock and ore of the voxels it was carved from
(`FragmentComposition.ts`), plus the bounding box the renderer scales it to.

## Step 4 — Throw, Flight and the Muck Pile

**Three things decide whether rock is thrown rather than merely broken:**

| | |
|---|---|
| Leftover energy | Only what *left* the rock can move it; what it absorbed went into breaking it. |
| A free face | Rock near air has somewhere to go; confined rock can only settle. Direction blends the free face with the energy gradient (`FREE_FACE_WEIGHT`). |
| Stemming | `throwFraction = MIN_THROW_FRACTION + (1−MIN) × blowout²`. This is the player's main safety lever. |

Measured, same 8 kg charge, varying only stemming: **0 m → 30 m/s and flyrock; 2 m → 11 m/s heave
and zero dangerous projections.**

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

**Rock that fails to break out stays sealed (#1724).** A fragment whose origin lies in a void with
an intact solid voxel above it in its column never leaves it: it does not fly (`thrown: false`,
never a projectile) and settles inside the void, on the first empty layer above the ground at or
below where it broke, never above the cap. Piles are keyed by (column, layer); a column filled to the
ceiling, or past the angle of repose, spills sideways into the lowest column of the same void. Rock
thrown in from elsewhere still lands on top of the cap, and open columns resolve exactly as before.
`BlastResult.brokeOut` is true when some cleared voxel sat at or above its column's pre-blast top;
a blast that cleared rock but never broke out is reported (`mining.blast.no_breakout`,
`BlastReport.brokeOut`) and capped to bad (`no_breakout`).

Sealed rock gets no `haul_debris`/`fragment_debris` order (#1774) until its void opens to the surface (the column's top solid no longer above it); then it is ordinary debris.

**Defaults break out (#1724).** `CHARGE_DEFAULT_AMOUNT_KG` (7) with `CHARGE_DEFAULT_STEMMING_M` (2.5)
in the default 8 m, 4 m-spaced 3x3 pattern is the smallest charge that opens a crater with every
hole's column lowered on the sandbox flat pad and on `tutorial_pit`, rating at least good, and it
fits the hole (`amount / CHARGE_KG_PER_METRE + stemming <= depth`). The measured sweep sits beside
the constants in `balance.ts`; 4 kg stays under `BURDEN_BREAKOUT_MAX` of cap and fails to break out.

**Placement is physics-only (#1302).** Where fragments and debris land is decided by blast physics
alone and is never adjusted, rejected or relocated for reachability. No reachability query lives in
`src/core/mining` or fragment/physics code. Debris stranded outside the ground crew's reachable set
belongs to the player: connect it (ramp, levelling, another blast) or leave it.

**Levelling a crater (#1723).** A `level_ground` order's work target is the reachable column
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
- **Stuck walker counts as stranded (#1990):** an armed blast never waits on an in-zone employee who
  cannot move. `isStuckWalker` (`DetonationSequence.ts`) = `isMoveStuck` or `moveConsecutiveFailures >=
  DETONATION_STUCK_WALKER_FAILURE_TICKS` (10). `detonationPhase` lists such an employee among the
  stranded names (all stranded, none walking -> `stranded`; mixed stays `evacuating`), and
  `tickDetonation` latches them into `strandedEmployeeIds` every tick so a counter reset by re-evacuation
  cannot revert the verdict. Employees only; vehicles keep the #1746/#1781 rescue logic. Fire anyway and
  Cancel unchanged.
- **Landing impacts** go through `Damage.processProjections`, keyed on where fragments came to rest
  and how fast they were going.
- **Buildings** are destroyed when a cleared voxel falls under their footprint.

- **Secondary crater (#1896):** a stocked Explosive Warehouse destroyed by accident fires its own one-hole blast through this pipeline; spec and decisions in `gameplay-buildings` (Destruction Effects).
## Blast Report and Rating

`BlastResult` carries `clearedVoxels`, `crackedVoxels`, fragment counts and sizes, `projectionCount`,
`maxThrowDistance`, `projectileCount`, `flights`, ore value, vibration, and destroyed buildings.

Rating is driven by **how far rock was actually thrown** (`THROW_DISTANCE_BAD` /
`THROW_DISTANCE_CATASTROPHIC`), projection share and vibration — not by speed. Rock that lands back
in its own muck pile is a good blast however fast it left. `BlastReport.maxProjectionDistanceM` is that
traced `maxThrowDistance`, so the report modal, console and rating agree.

### Rating caps (#1349)

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
player feels. Its hot paths are engineered accordingly — typed-array frontier in propagation, per-
voxel seed-list caching in fragment generation, a spatial hash in projectile grouping, memoised
surface queries under the arcs. Profile before and after touching any of them; a 16-hole blast
budget is ~300 ms.

## Loading a saved plan (#1342)

`blast_plan load name:X` queues orders; it never writes finished holes. Each saved hole becomes a planned hole (fresh unique id, `addHole` skips ids live in `drillHoles`/`plannedDrillHoles`) with one `drill_hole` order; each saved charge becomes one `charge_hole` order (cost deducted, `plannedChargesByHole` filled), Saved holes at an x,z already drilled or planned are skipped; orphan charges are skipped. Pre-checks (claim, `createCharge`, funds) are all-or-nothing. Charge-after-drill gate: `isHoleOrderClaimable` (ActionSelection.ts) keeps a `charge_hole` unclaimable while its hole is still in `plannedDrillHoles`, applied in targeted, pool and starvation claim paths. Removing the planned hole cancels and refunds its charge order.

Hole ids are monotonic (`state.nextHoleId`, saved with the game, v29 migration backfills it) except `drill_plan grid`, which replaces the plan and restarts at H1; removing a hole never reuses an id (#1352).

## Pattern charge settings (#1345)

`charge hole:* explosive:X amount:N stemming:M` stores the settings on the pattern (`state.patternCharge`, repeat overwrites) and orders every drilled hole not yet covered; a hole drilled later is charged automatically the moment it lands (`autoChargeHole`, called by the `drill_hole` completion). Logic lives in `src/core/mining/ChargeOrder.ts` (core), the console only parses and formats.

- **Vehicle work (#1649).** Each `charge_hole` order needs a charging truck and a blasting + `driving.truck` crew member; without them it waits with an availability reason (see `gameplay-vehicle-fleet`).
- **Skip covered.** A hole is covered when charged or holding an outstanding `charge_hole` order; Charge All and auto-charge skip it. A cancelled order is not re-ordered automatically: run Charge All again.
- **Funds per hole.** Cost is paid at order time, hole by hole. A hole the player cannot afford is listed in `state.chargeAwaitingFunds` (nothing ordered, nothing deducted) and retried once per tick (`settleAwaitingFundsCharges`, id order, walks only that list) until affordable. The call still succeeds: "ordered N, skipped M already charged, waiting K". UI: awaiting-funds chip per hole, a reason line, one warn toast per episode.
- **Refusals.** `charge hole:*` with no drilled and no planned hole, or with everything drilled already covered and nothing planned, is refused (`mining.charge.nothing_to_charge`). Only planned holes: succeeds and stores the settings. `blast` with no drilled hole holding a loaded (or loading) charge is refused (`mining.blast.no_charged_holes`); nothing mutates.
- **Per-hole override.** `charge hole:<id>` does not touch the pattern; it re-orders that hole as before.
- **Reset and edge cases.** `resetPlanState` (clear, post-blast) clears the pattern and the waiting list; removing a hole drops its id from the list. An explosive the level does not offer clears the pattern; a failing `createCharge` for one hole leaves it uncharged, never throws.
- **Replacing a pattern.** `drill_plan grid` over drilled or charged holes is refused unless `confirm:true` (`mining.drill_plan.confirm_replace`, names the counts); the Drill step opens a ConfirmModal (`replacePatternConfirm.ts`) and re-runs with `confirm:true`. A plan of only ordered-not-yet-drilled holes needs no confirm.
- **Tubing excluded.** `install_tubing` stays a separate per-hole action; it is not part of the pattern.
- **Hole water (#1350).** Wetness is per-hole stored water (`state.holeWater`), not "is it raining now": it builds in rain and fades afterwards, slower in porous rock. Tubing blocks new water but does not remove old water; `drain_hole` does, at `HOLE_DRAIN_COST_PER_HOLE`, except an untubed hole in porous rock. Details in `gameplay-game-design` (Weather).

## Undrilled holes at fire time (#1346)

Firing with ordered-but-undrilled holes (`plannedDrillHoles`) warns in the preflight modal (`warn_undrilled`), never gates FIRE; a successful blast cancels every outstanding `drill_hole` order (`cancelOutstandingDrillActions`) and reports the count. Default chosen over blocking FIRE; refused blasts cancel nothing.

## Software Upgrades (Prediction Tools)

| Tier | Name | Shows |
|------|------|-------|
| 0 | None | Blind blasting |
| 1 | "BlastView Basic" | Energy heatmap |
| 2 | "FragPredict" | Expected fragment size |
| 3 | "ProjectoScan" | Projection risk zones |
| 4 | "VibroMap Pro" | Vibration at the level's villages |

Previews run the **same** propagation the blast does (`buildPlanEnergyField`) and the same seeding
and velocity maths. A preview that models the rock differently from the game is worse than no
preview — never reintroduce a separate approximation. Previews also take the wet-hole set (`wetHoleIdsFor`, the same one `executeBlast` receives), so water-sensitive charges in holes holding water (`state.holeWater`, #1350) are predicted weakened.

### Detonation and Workshop steps

No detonation sequence exists: every charge fires together at blast start (no per-hole order or delay). The Blast Workshop has 4 steps: Drill, Charge, Preview, Fire. A save carrying a stray `sequenceDelays` key ignores it.

### Village vibration (#1343)

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

## Charge cost: cash vs stock (#1685)

A charge order records `fromStockKg` (the part drawn from warehouse stock at order time) on `plannedChargesByHole`, carried into `chargesByHole` on loading. Every cost shown to the player is the cash part at list price (`recordedChargesCost`; forward preview `stockAwareChargesCost`). `BlastReport.spent` = cash, `BlastReport.spentFromStock` = list value of the stock kg. Detail in `gameplay-buildings`.

## EST. ORE VALUE (#1703)

`estimateBlastOreValue(plan, surveys, grid, wetHoleIds)` (`BlastValueEstimate.ts`) values the ore the blast will actually break. It runs the blast's own propagation (`buildPlanEnergyField` + `identifyFragmentedVoxels`, the same code the preview and `executeBlast` use), so the broken volume matches; wet holes are treated as the blast treats them. Each broken 1 m voxel is read from the newest fresh survey covering its column at the voxel's own depth (`oresSurveyedAt`, see `gameplay-survey-system`): value += density x `ORE_DENSITY_KG_M3` x catalog `valuePerKg` x survey `confidence`. Ore a survey did not locate at that depth counts for nothing (aerial counts its top 2 m only). The grid supplies rock geometry only, never ore. Uncharged holes or an empty plan give 0. The footer and preflight modal memoise it (`oreEstimateMemo.ts`) on holes, charges, wet holes, survey ids/stale flags and the grid's dirty-chunk count.

`BLAST_ESTIMATE_TOLERANCE` (0.35) is the working accuracy target: with a fresh seismic survey (or core samples on every column) covering the pattern, the estimate lands within +-35% of the actual ore value (seed 42, 3x3, spacing 4, depth 8: desert_badlands (32,22) boomite 8 kg, green_foothills (32,32) krackle 8 kg, alpine_granite (36,16) shatternite 4 kg). Measured: seismic 0.86/0.84/0.78; core samples 0.68/0.67/0.40 (alpine misses: dilute rustite rounds out of 1 m core bands); aerial about 0.2-0.26 by design.

## BURIED HOLES (#1937)

Progression sites only (`isProgressionSite`; other sites are unchanged). A planned drill hole (`state.plannedDrillHoles`) is **buried** while any `on_ground` fragment covers its cell. A fragment covers cells from `position - halfExtents` to `position + halfExtents`, rounded with `Math.round` (the nav grid's convention), inclusive in x and z; a fragment without `halfExtents` covers one cell. `in_transit` and `stored` fragments never bury. `src/core/mining/BuriedHoles.ts` indexes covered cells once per tick (`buildBuriedCellIndex`, cache keyed on state, tick and fragment count) and answers per hole in O(1) (`buriedHolesOf`, `isHoleBuried`, `fragmentBuriesPlannedHole`). A buried hole's `drill_hole` order stays pending (not claimable, `isHoleOrderClaimable`) with `blockedReason` `buried_under_rubble`, cleared once the rubble is hauled away; a drill already in progress continues. A `haul_debris` of a fragment burying a planned hole gets `BURIED_HOLE_HAUL_PRIORITY_BONUS_TICKS` (64, `balance.ts`) off its sort key like the ore demand bonus (ranking only; set to 0 to reverse). The console `drill_plan show` tags such holes "buried"; the Blast Workshop Drill step shows "N planned (M buried)" and a warning "Buried" chip on their rows.

## Pre-Flight building reach (#2030)

`buildingsInBlastReach` (`BlastPlan.ts`) warns of buildings the planned holes may hit (#2021 rows). Its default margin is charge-derived, not the hole spacing:

- `holeBlastReachM(charge, depth) = BLAST_REACH_M_PER_SQRT_ENERGY * sqrt(computeInitialEnergy(charge, depth))` (`balance.ts`, 0.045 m per sqrt energy unit). Stemming efficiency and explosive energy are inside `computeInitialEnergy`; an undefined charge, unknown explosive or 0 kg gives 0.
- Margin = max reach over all holes (simplification: one margin for the whole pattern, not per hole); an uncharged hole contributes 0. An explicit `marginM` overrides.
- The margin grows the holes' bounding box (`computeDangerZone`); a footprint cell at distance D from the box edge is flagged when D <= reach (whole cell, inclusive edge).
- Reference (3x3 grid, 4 m spacing, 8 m deep, 2.4 m stemming): Krackle 8 kg ~2.55 m, Shatternite 11 kg ~3.95 m, Dynatomics 11 kg ~5.38 m.
- Flying rock (#1968) is not modelled; the reach covers breakage only.

## WALL STABILITY (#1941)

Progression sites only (`isProgressionSite`; other sites and campaign levels never slump). After a blast that cleared voxels, `fireBlastSteps` runs `applyWallSlumps` (`src/console/commands/mining/wallSlump.ts`) after the occupancy update and before `warmOrderReachability`. Core rule in `src/core/mining/WallStability.ts`.

- **Safe face height.** `RockType.safeFaceHeightM` comes from `hardnessTier` via `WALL_SAFE_FACE_HEIGHT_M_BY_TIER` (12/15/20/25/30 m); `getSafeFaceHeightM(rockId)` reads it (unknown rock = tier 1). Measured: the standard opening (3x3 holes, 8 m, 4 m spacing, floor up to 4 m deeper) leaves a tallest face of 10 m in the biomes where it breaks out (seeds 42/7/13), so no constant was lowered or raised.
- **Face.** A continuous strict drop between neighbouring columns along one of the four axis directions (column top = `computeVoxelColumnSurfaceY`, 1 m voxels). A flat step of `WALL_BERM_MIN_WIDTH_M` (3) columns, landing column included, ends a face; a 2 m flat does not. A rise or missing column also ends it. Height = crest top - toe top.
- **Fails when** height is strictly greater than the safe height of the weakest rock (minimum over the dominant rock of every wall voxel). Exactly at the height never slumps.
- **Slump.** Material above `toeY + safe` in the crest column, the `WALL_SLUMP_DEPTH_M - 1` columns behind it and the face's own columns is removed and re-deposited as fill on the floor: toe column first, then floor columns at toe level spreading outward (Chebyshev distance, then x, then z, within `WALL_SLUMP_PILE_SEARCH_RADIUS_M`), at most `WALL_SLUMP_PILE_MAX_HEIGHT_M` per column; any remainder stacks on the toe so volume is never lost. Fill voxels keep composition and ores (one-to-one). Never cuts below the toe level. `SlumpReport.volumeM3` is the count of 1 m voxels moved; `toeColumns` is the damage zone.
- **Deterministic, one pass, no cascade.** Faces are applied in sorted order (crest x, z, direction) from one scan; a cut leaves a 2 m ledge, so a very tall wall can slump again after a later nearby blast. Berms (3+ columns) are the cure.
- **Bounded cost.** Only the blast's cleared region plus `WALL_STABILITY_REGION_MARGIN_M` (8) is scanned, column tops read once for all four directions. A 12x12 clear costs about 784 columns and ~2 ms.
- **Effects.** Per slump: `terrain:updated` over the touched voxels (nav grid follows), employees/vehicles/buildings in the toe zone take blast-like damage (`processProjections` with a synthetic rockfall per toe column at `WALL_SLUMP_IMPACT_SPEED_MS`), `state.damage.wallSlumpCount` increments (serialized as `wallSlumpCount`), `mining:wall_slump` `{x, z, volumeM3}` (toe position) raises a warn notification ("The geologist did warn you."), and the blast report gains a `mining.blast.wall_slump` line.
- Digs and ramp cuts do not trigger it in v1.
