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
- **Absorption threshold** = rock mix weighted by `energyAbsorption`, × `fractureModifier`, ×
  `confinementFactor(distToAir)`. **Rock near a free face breaks for a fraction of the energy**
  (`UNCONFINED_THRESHOLD_FACTOR`, ramping to full over `CONFINEMENT_FULL_DEPTH`) — this is why bench
  blasting works at all.
- **Spread** goes to the 18 face-and-edge neighbours, weighted by 1/distance and biased toward
  neighbours nearer a free face (`FREE_FACE_BIAS`), losing `transmissionLoss` (derived from rock
  porosity) at each step. Air neither absorbs nor carries: a void shields what is behind it.
- **Energy is conserved.** `seeded == Σ effective + dissipated`. Keep it that way.

Two derived readings matter downstream:

- `effectiveAt` — energy a voxel retained. **Capped at its threshold**, so it is *useless* as a
  measure of violence: every broken voxel reads exactly 1.0× threshold.
- `intensityAt` — `(effective + overflowOut) / threshold`, the energy that passed *through*.
  This is the signal fragment generation seeds from. 1.0 means "just barely broke".

## Step 2 — What Breaks

Three passes, in order:

1. **Energy** — `effective >= FRAGMENTATION_MULTIPLIER × threshold` breaks. Between
   `CRACKED_VOXEL_ENERGY_RATIO` and that, the voxel survives but is weakened
   (`CRACKED_VOXEL_WEAKENING` on its fracture modifier) for the next blast.
2. **Undermined burden** — a cap of intact rock up to `BURDEN_BREAKOUT_MAX` thick over a broken
   zone, with air above it, lifts rather than being crushed. Without this a charge carves a sealed
   cavity under intact ground at *any* size and the player sees nothing happen. Thicker burden still
   holds, which is what makes an over-buried charge visibly fail to break out.
3. **Unsupported rock** — flood-fill the survivors from the box shell; anything the fill never
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

`MuckPileSummary.summariseMuckPile` reads the settled pile back: size and speed spread, and how
much rock rests on nothing. Clearance is per column against **the pile beneath**, not the terrain —
rock stacked in a heap sits metres above the floor and is resting, not floating. Both state bridges
expose it as `muckPile`, so a browser harness and a headless run read the same numbers.

## Damage

- **Standing on the blast** is fatal regardless of the charge — the ground is simply gone.
  `blastCommand` kills employees and destroys vehicles on any cleared column. Evacuating the zone
  first (`Zone.ts`) is the point of the safety drill.
- **Landing impacts** go through `Damage.processProjections`, keyed on where fragments came to rest
  and how fast they were going.
- **Buildings** are destroyed when a cleared voxel falls under their footprint.

## Blast Report and Rating

`BlastResult` carries `clearedVoxels`, `crackedVoxels`, fragment counts and sizes, `projectionCount`,
`maxThrowDistance`, `projectileCount`, `flights`, ore value, vibration, and destroyed buildings.

Rating is driven by **how far rock was actually thrown** (`THROW_DISTANCE_BAD` /
`THROW_DISTANCE_CATASTROPHIC`), projection share and vibration — not by speed. Rock that lands back
in its own muck pile is a good blast however fast it left.

## Playback

`FragmentAnimator` walks each fragment from where it broke to where it settled. Horizontal motion is
straight; the vertical is the parabola joining those points in the flight's own duration under
gravity, so **the animation cannot end anywhere but the fragment's authoritative position**. For a
straight drop it reduces to free fall from rest. Skipping playback entirely is always safe.

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
jittering a box's vertices, whose per-face duplicates tear apart into floating planes. The shear
lives inside the instance matrix, so position updates must write the translation column only; a
TRS decompose/recompose silently strips it.

**The whole blast resolves synchronously inside the click**, so the pipeline's cost is a frame the
player feels. Its hot paths are engineered accordingly — typed-array frontier in propagation, per-
voxel seed-list caching in fragment generation, a spatial hash in projectile grouping, memoised
surface queries under the arcs. Profile before and after touching any of them; a 16-hole blast
budget is ~300 ms.

## Software Upgrades (Prediction Tools)

| Tier | Name | Shows |
|------|------|-------|
| 0 | None | Blind blasting |
| 1 | "BlastView Basic" | Energy heatmap |
| 2 | "FragPredict" | Expected fragment size |
| 3 | "ProjectoScan" | Projection risk zones |
| 4 | "VibroMap Pro" | Vibration at villages |

Previews run the **same** propagation the blast does (`buildPlanEnergyField`) and the same seeding
and velocity maths. A preview that models the rock differently from the game is worse than no
preview — never reintroduce a separate approximation.

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
- Design record, including four defects found in the original spec and why each was changed:
  `docs/plans/rock-fragmentation-refactor.md`.
