# Rock Fragmentation Refactor Plan

Status: **approved design, not yet implemented**.
Audience: an implementing agent. This document is self-contained: every algorithm is
specified in enough detail to implement without re-deriving design decisions. When this
document and older docs (`BLAST_SYSTEM.md`, skill `gameplay-blast-system`) disagree,
**this document wins** — it supersedes both for the fragmentation pipeline. Update the
skill at the end of the project (P5).

---

## 1. Goal and non-goals

**Goal.** When a blast fires, the player must *see* the blasted rock break into
fragments and collapse/fly with plausible ("okayish", cartoon-grade) physics — not a
teleport. Game outcomes (where rock lands, who dies, what can be hauled) must be
deterministic, headless-testable, and identical with or without a renderer.

**Non-goals.**
- Not a physically accurate simulation. Visual plausibility only.
- No per-fragment runtime rigid-body simulation. cannon-es is **removed** (decision D1).
- No change to drilling, charging, sequencing, survey, hauling UI flows.

**Player-visible result when done:** detonation → rock face crumbles into discrete
fragments → near-surface high-energy fragments are thrown outward on ballistic arcs
(dangerous), the rest collapse downward into a muck pile → everything settles into
stacked debris that haulers/rock-breakers process exactly as today.

---

## 2. Decision log (already made — do not re-litigate)

| # | Decision |
|---|----------|
| D1 | Drop cannon-es entirely. Cosmetic animation uses closed-form arcs + simple vertical settle. Remove the dependency from `package.json`. |
| D2 | Renderer keeps the 8-variant instanced-box approach in `FragmentMesh`. No per-fragment hull meshes. Fragments get anisotropic scale from their cluster AABB. |
| D3 | **No fragment-count budget.** Fragment size/count result ONLY from blast parameters (energy vs. rock threshold). A high safety cap exists purely as a pathological-input guard (`MAX_FRAGMENTS_PER_BLAST = 50000`), never as a tuning knob. |
| D4 | Physics/animation cost is capped by **projectile grouping**: adjacent fragments moving together are grouped into one "projectile" for ballistics/animation (cap `MAX_ACTIVE_PROJECTILES`). A projectile is re-divided into its member fragments when it becomes stationary. Fragment identity, sizes, and inventory are never altered by grouping. |
| D5 | The spec energy model (iterative voxel propagation) replaces the legacy 1/r² distance field. Single energy model in the codebase. |
| D6 | Authority split: `src/core/` computes all gameplay outcomes analytically (deterministic). The renderer only *plays back* the authoritative result over time. Headless runs (`npm run scenarios`, console) get identical outcomes with zero animation cost. |
| D7 | The crater-excavation hack in `BlastExecution.ts` (force-clearing surface voxels "for a visible crater") is deleted once the propagation model produces real craters (end of P1). |
| D8 | Fragment piles are per-column stacks (a fragment rests in exactly one (x,z) cell, stacked in landing order). Cross-cell leaning/support graphs are cut. Removing a bottom fragment lowers the ones above **without damage** (pile-emptying must be safe). |
| D9 | Dead spec-pipeline tests under `tests/unit/physics/` are deleted with their modules. Logic that survives (ported into core) gets fresh unit tests in the mirrored `tests/unit/` path. |

---

## 3. Current-state audit (as of branch point)

Two parallel pipelines exist. Only the legacy one runs.

### 3.1 Legacy pipeline (RUNNING — to be replaced)

Call chain: `src/console/commands/mining.ts:248 blastCommand` → `executeBlast`
(`src/core/mining/BlastExecution.ts:127`) → renderer `GameRenderer.onBlast`
(`src/renderer/GameRenderer.ts:408`) → `FragmentMesh.spawnFragments`.

- Energy: `calculateEnergyField` (`src/core/mining/BlastCalc.ts:81`) — sums
  `holeEnergy / (distance² + ε)` per voxel. Ignores air, ignores rock absorption along
  the path, no free-face awareness.
- Fragmentation: `calculateFragmentation` (`BlastCalc.ts:114`) — hardcoded ratio bands
  (0.5 / 1.0 / 2.0 / 4.0) → `fragmentSizeFraction`, `isProjection`.
- Fragments: `FragmentData` point records (no shape), N per voxel via
  `calculateFragmentCount`.
- Crater hack: `BlastExecution.ts:253-284` force-clears surface voxels around the blast
  centre regardless of energy.
- Visuals: fragments **teleport**. `computeRenderScatter`
  (`src/renderer/FragmentRenderSampling.ts:49`) places each instanced box at its final
  hash-jittered position in one frame; "projections" are offset by
  `velocity × FRAGMENT_PROJECTION_RENDER_DISTANCE_SCALE` instantly. Nothing falls,
  nothing stacks.

### 3.2 Spec pipeline (DEAD CODE — nothing outside `src/physics/` imports it)

- `propagateEnergy`, `identifyFragmentedVoxels`, `computeBlastEntityDamage`
  (`src/core/mining/BlastCalc.ts:205,264,324`) — written, unused, string-keyed Maps.
- `src/physics/`: Bowyer–Watson Delaunay → Voronoi duals → merge pass → convex hulls →
  cannon-es Tier A / analytic Tier B → support graph. ~2 200 lines, fully tested
  (`tests/unit/physics/*`), never called by the game. Known defects: merge pass takes
  the convex hull of a union (inflates volume, spawns interpenetrating fragments,
  `FragmentSim.ts:189`); `FragmentBody` ignores the hull collision vertices and uses
  boxes anyway (`FragmentBody.ts:85`); the whole simulation resolves offline inside one
  call (`FragmentBody.simulate`) so even wired it would teleport.

### 3.3 Consumers that must keep working unchanged

- Hauling/logistics: `state.logistics`, task type `'fragment_debris'`
  (`src/core/state/GameState.ts:70`), `src/core/economy/HaulingTask.ts`,
  `Logistics.consumeStoredOre`.
- Rock breaker: `fragmentBoulder`, `isOversized`
  (`src/core/mining/BoulderFragmentation.ts`).
- Blast report/scoring: `BlastResult` fields consumed in `mining.ts:255-300`,
  `src/core/scores/ScoreManager.ts`, `BlastOreReport`.
- Software previews: `src/core/mining/Software.ts`, `SoftwarePreview.ts` (energy
  heatmap / fragment-size / projection-risk overlays — P5 re-points them at the new
  model).
- NavGrid patching keyed on `BlastResult.clearedRegion` (`mining.ts` + `main.ts`).
- Save/load: fragments themselves are transient (not persisted); pile state introduced
  by this refactor **is** gameplay state and must be persisted (see §5.4).

---

## 4. Target architecture

```
                      src/core/mining/  (authoritative, deterministic, Node-safe)
  BlastPlan ──► executeBlast()
                  │ A1 propagateEnergy        (typed arrays, damped, 18-neighbour)
                  │ A2 identifyFragmentedVoxels + islands (AABB-scoped)
                  │     + computeBlastEntityDamage
                  │ A3 generateFragments      (seeded clustering, size = f(energy))
                  │ A4 assignFragmentVelocities (free-face + gradient blend)
                  │ A5 groupProjectiles       (cap bodies, not fragments)
                  │ A6 resolveBallistics      (closed-form arcs → landing cells,
                  │                            landing damage, per-cell pile stacks)
                  ▼
              BlastResult { fragments, projectiles, timeline, piles, report }
                  │                                   │
   (headless: done — state already final)             │
                  ▼                                   ▼
        src/console / scenarios                src/renderer/FragmentAnimator  (cosmetic)
                                               A7 plays the timeline over real frames:
                                               arcs, drops, split-on-rest, settle,
                                               then freezes instances at the
                                               authoritative positions.
```

Rules:
- `src/core/` never imports `src/physics/`, `src/renderer/` (core-purity rule).
- All randomness through `src/core/math/Random.ts` seeded from the game seed + blast id.
- The renderer never decides an outcome. If animation is skipped (headless, load mid-
  settle), the world is already in its final state.
- `src/physics/` directory is deleted entirely by the end of P0 (D1). `vite.config.ts` /
  `tsconfig.json` need no path changes (plain directory).

---

## 5. Data model

All types live in `src/core/mining/` unless stated. Extend, don't fork: keep the
`FragmentData` name so downstream consumers keep compiling.

### 5.1 `FragmentData` (extended — `BlastExecution.ts`)

```typescript
export interface FragmentData {
  id: number;
  /** Authoritative CURRENT position (initially origin centroid, updated to landing). */
  position: Vec3;
  /** Origin centroid at detonation time (renderer animates from here). */
  origin: Vec3;
  volume: number;              // m³, = subCellCount × SUB_CELL_VOLUME
  mass: number;                // kg, = volume × mass-weighted rock density
  rockId: string;              // dominant rock (kept for compat, = dominantRockOf(composition))
  composition: VoxelRockComposition;   // NEW: full weighted composition
  oreDensities: Record<string, number>;   // volume-weighted grades, never normalized
  initialVelocity: Vec3;
  isProjection: boolean;       // tier: true = 'projected', false = 'collapse'
  oversized: boolean;          // volume > OVERSIZED_FRAGMENT_THRESHOLD
  /** Cluster AABB half-extents, for anisotropic render scale (D2). */
  halfExtents: Vec3;
  /** Deterministic shape-variant seed for the renderer (replaces hash of id). */
  shapeSeed: number;
  projectileId: number;        // -1 if not grouped (collapse tier)
}
```

### 5.2 `Projectile` (new — `src/core/mining/ProjectileGrouping.ts`)

```typescript
export interface Projectile {
  id: number;
  memberFragmentIds: number[];
  massKg: number;              // Σ member masses
  volumeM3: number;            // Σ member volumes
  origin: Vec3;                // mass-weighted centroid at detonation
  velocity: Vec3;              // mass-weighted mean of member velocities
  /** Filled by A6: */
  impactPosition: Vec3;
  flightDurationS: number;     // time from detonation to impact
  impactSpeed: number;         // |velocity at impact|, for damage
}
```

### 5.3 `BlastTimeline` (new — `src/core/mining/BlastExecution.ts`)

The renderer's playback script. Pure data, no logic.

```typescript
export interface FragmentDrop {
  fragmentId: number;
  /** Start Y (origin) and final rest Y (pile-aware). X/Z unchanged for collapse tier. */
  fromY: number;
  toY: number;
  /** Detonation-relative start delay (s) — staggered by depth for a crumble look. */
  delayS: number;
}

export interface BlastTimeline {
  /** Collapse-tier fragments: vertical drops. */
  drops: FragmentDrop[];
  /** Projected-tier projectiles: closed-form arcs (recompute pos(t) from
   *  origin/velocity/flightDurationS — no keyframes stored). */
  projectileIds: number[];
  /** Per fragment of each landed projectile: final scattered rest position. */
  splitRests: Array<{ projectileId: number; fragmentId: number; rest: Vec3 }>;
}
```

### 5.4 Pile state (new — `src/core/mining/DebrisPiles.ts`, persisted)

```typescript
/** One stack per (x,z) cell, bottom-to-top in landing order. */
export interface DebrisPileState {
  /** key "x,z" → ordered fragment ids (bottom first). */
  stacks: Map<string, number[]>;
  /** fragment id → its cell key + height of its base above terrain surface (m). */
  entries: Map<number, { cell: string; baseY: number }>;
}
```

- Lives in `GameState` (new field `state.debrisPiles`), serialized in `SaveLoad.ts`
  (add codec; Maps → arrays). Fragments on the ground ARE gameplay state now (haulers
  pick them, piles have height); persist `FragmentData[]` for unhauled fragments too
  (new `state.groundFragments: FragmentData[]`).
- API: `pushFragment(piles, cellKey, fragmentId, heightM)`,
  `removeFragment(piles, fragmentId)` → returns list of `{fragmentId, newBaseY}` for
  fragments that slid down (no damage, D8), `pileHeightAt(piles, x, z, fragments)`.

### 5.5 `BlastResult` (extended)

Keep every existing field (see §3.3 consumers). Add:

```typescript
  fragments: FragmentData[];        // (existing field, now spec-generated)
  projectiles: Projectile[];        // NEW
  timeline: BlastTimeline;          // NEW
  casualties: number;               // NEW (from computeBlastEntityDamage)
  destroyedVehicleIds: number[];    // NEW
  maxProjectionDistance: number;    // NEW (horizontal metres, replaces speed proxy in rating)
```

---

## 6. Algorithm specifications

Grid conventions: voxels are 1 m³ (`VoxelGrid.CELL_SIZE = 1`). All work happens on the
blast AABB (`calculateBlastZone`, keep as-is, `BlastExecution.ts:410`) with **local flat
typed arrays**: `nx = maxX-minX+1` etc., `idx(x,y,z) = (x-minX) + nx*((y-minY) + ny*(z-minZ))`.
Never use string-keyed maps in the new code (`"x,y,z"` Maps are the single biggest perf
defect of the old spec code).

Air definition (single helper, exported once): a cell is air if out of grid bounds, or
`density <= 0`, or `composition.rocks.length === 0`.

### A1 — Energy propagation (`src/core/mining/EnergyPropagation.ts`, new file)

Replaces both `calculateEnergyField` (legacy) and `propagateEnergy` (dead spec version).

**Inputs:** grid, blast AABB, plan (holes, charges, delays ignored for propagation),
`holeSurfaceYs`.
**Outputs (all `Float32Array` over the AABB):** `effective`, `overflowOut`
(total overflow that ever left each cell — feeds A4), `threshold` (cached), plus
`airMask: Uint8Array`.

1. **Thresholds.** For each non-air cell: `T = Σ coefficient[r] × rockDef[r].energyAbsorption`
   (this is `computeThreshold`, `BlastCalc.ts:23` — keep and reuse it, but fill the
   array once, never call per-iteration).
2. **Charge seeding.** For each hole with a charge:
   `E_raw = explosive.energyPerKg × amountKg × stemmingEfficiency(stemmingM, depth) × waterEffect(...)`
   (reuse existing functions `BlastCalc.ts:52-64`). The charge occupies the column from
   `y = surfaceY − depth` up to `y = surfaceY − stemmingM` (min 1 cell). Split `E_raw`
   equally over those cells into an `overflowCur` array.
3. **Iterate** (double-buffer `overflowCur` → `overflowNext`):
   ```
   for each cell i with overflowCur[i] > EPS:
     absorbed   = min(overflowCur[i], threshold[i] − effective[i])   // ≥ 0
     effective[i] += absorbed
     leftover   = overflowCur[i] − absorbed
     if leftover ≤ EPS: continue
     overflowOut[i] += leftover
     transmit   = leftover × (1 − transmissionLoss(i))               // damping, see below
     // 18 neighbours: 6 face (dist 1) + 12 edge (dist √2)
     valid      = neighbours that are in-AABB, non-air, and effective < threshold
     wTotal     = Σ (1/dist) over valid
     for each valid n: overflowNext[n] += transmit × (1/dist(n)) / wTotal
     // energy sent toward air neighbours is vented (lost); count them:
     airExposure[i] = number of air neighbours (Uint8Array, kept for A4)
   ```
   `transmissionLoss(i)` = `Σ coefficient[r] × rockDef[r].transmissionLoss` — **new
   per-rock field** in `RockCatalog.ts` (see §7). It is the damping that makes energy
   decay with distance and gives round, finite blast radii.
   Terminate when `Σ overflowNext < BLAST_ENERGY_EPSILON` or after
   `MAX_PROPAGATION_ITERATIONS` (keep 500; with damping expect convergence < 60).
   Cells with no valid neighbours dissipate their leftover (vented/lost).
4. **Invariant (unit-test it):** `Σ effective + Σ dissipated = Σ seeded` within 1e-3
   relative tolerance. Track `dissipated` as a scalar accumulator.

Boundary rule: cells on the AABB shell may not push energy outside the AABB (treat
outside as unavailable, energy dissipates). AABB is already padded by
`BLAST_ZONE_RADIUS`; document in code that clipping there is intended.

### A2 — Fragmented-voxel identification (`EnergyPropagation.ts`)

Port `identifyFragmentedVoxels` (`BlastCalc.ts:264`) onto typed arrays:

1. Cell fragments if `effective[i] ≥ FRAGMENTATION_MULTIPLIER × threshold[i]` (non-air
   cells only).
2. **Island pass, AABB-scoped:** flood-fill over solid non-fragmented cells, seeded from
   every solid non-fragmented cell on the AABB **shell** (those are "attached to the
   world" — conservative). Any solid non-fragmented cell not reached → also fragments
   (hanging arches). Never scan the whole grid.
3. Entity damage: reuse `computeBlastEntityDamage` (`BlastCalc.ts:324`) — it is correct;
   adapt its inputs from Maps to the typed arrays (change its signature; it has one
   test file `tests/unit/mining/BlastCalc.test.ts` to update). Its outputs populate the
   new `BlastResult` fields.
4. Voxel clearing, `clearedRegion`, `terrain:updated` emission: keep the existing
   deferred-clear structure of `executeBlast` (`toClear` list) — only the *selection* of
   voxels changes. **Delete the crater excavation pass** (`BlastExecution.ts:253-284`)
   and constants `CRATER_EXCAVATION_MAX_RADIUS`, `CRATER_EXCAVATION_DEPTH_VOXELS` (D7).

### A3 — Fragment generation (`src/core/mining/FragmentGeneration.ts`, new file)

Replaces Delaunay/Voronoi/merge entirely. Produces fragments whose sizes derive ONLY
from local energy (D3). Uses sub-cell clustering ≈ grid-restricted Voronoi.

Definitions: `SUB = 2` (`SUB_CELL_RESOLUTION`) → each fragmented voxel is split into
`SUB³ = 8` sub-cells of 0.5 m, sub-cell volume `SUB_CELL_VOLUME = 0.125 m³`.

1. **Seed sampling.** For each fragmented voxel `v` with `r = intensityAt(field, v)`
   — total energy through the voxel over its threshold, **not** `effective/threshold`,
   which P1 showed is pinned at 1.0 for every broken voxel (see the P1 record, finding 1):
   ```
   expected = SEEDS_BASE + SEEDS_PER_RATIO × (r − FRAGMENTATION_MULTIPLIER)
   count    = floor(expected) + (rng.chance(frac(expected)) ? 1 : 0)
   count    = min(count, MAX_SEEDS_PER_VOXEL)
   ```
   With `SEEDS_BASE = 0.35`, `SEEDS_PER_RATIO = 2.0`, `MAX_SEEDS_PER_VOXEL = 8`:
   a barely-fractured voxel usually contributes **no seed** (its rock joins a
   neighbour's fragment → multi-voxel boulders emerge naturally), an over-charged voxel
   contributes up to 8 seeds (fine rubble). Each seed = uniform random point inside the
   voxel (seeded `Random`). Iterate voxels in ascending `idx` order for determinism.
2. **Sub-cell assignment.** For every sub-cell centre of every fragmented voxel, find
   the nearest seed within Chebyshev radius `SEED_SEARCH_RADIUS = 3` voxels (search a
   spatial hash of seeds bucketed per voxel; check the 7³ voxel neighbourhood). Assign
   sub-cell → that seed's cluster. Ties: lowest seed index wins (determinism).
3. **Orphans.** Sub-cells with no seed in range: group per 6-connected component (BFS
   over orphan sub-cells); each component becomes one fragment (this is the giant
   low-energy boulder case). If a component exceeds `MAX_ORPHAN_COMPONENT_SUBCELLS`
   (= 8 voxels worth = 64), split it by greedy BFS chunks of that size.
4. **Fragment build.** Per cluster:
   - `volume = subCellCount × SUB_CELL_VOLUME`; `oversized = volume > OVERSIZED_FRAGMENT_THRESHOLD`.
   - `composition` / `oreDensities`: volume-weighted average over the **source voxels**
     of its sub-cells — call `computeAverageRockComposition` /
     `computeAverageOreDensities` from `src/core/mining/FragmentComposition.ts` (landed
     in P0), passing one `VoxelContribution` per source voxel whose `weight` is the
     number of sub-cells the fragment takes from it. `rockId = dominantRockOf(composition)`.
   - `mass = volume × Σ coefficient[r] × rockDef[r].density`.
   - `origin` = mean of sub-cell centres; `halfExtents` = cluster AABB half-extents;
     `shapeSeed = rng.nextInt(0, 2^31)`.
   - `rockId` = highest-coefficient rock (compat).
5. **Safety cap (D3):** if total fragments would exceed `MAX_FRAGMENTS_PER_BLAST`
   (50 000), abort seed sampling early by scaling `SEEDS_PER_RATIO` down for the
   remainder and log a console warning through the command result — never silently drop
   rock volume. (This cap is a guard against absurd inputs, not balance.)
6. **Volume conservation invariant (unit-test):** Σ fragment volumes = fragmented voxel
   count × 1 m³ exactly (every sub-cell belongs to exactly one fragment).

Delete after porting: `MAX_VORONOI_POINTS`, `MERGE_PROBABILITY`,
`COLLISION_DEFLATE_AMOUNT`, `FRAGMENTATION_SCORE_SCALE` (replaced by the seed
constants), `MAX_FRAGMENTS_PER_VOXEL` (subsumed by `MAX_SEEDS_PER_VOXEL`).

### A4 — Velocity assignment (`src/core/mining/FragmentVelocity.ts`, new file)

Port the formulas from `src/physics/FragmentSimVelocity.ts` (they are good) with one
change: blend the energy gradient with the **free-face direction**.

1. **Distance-to-air field** `distAir: Float32Array` over the AABB: multi-source BFS
   from every air cell simultaneously (O(n), 6-connected, distances in metres).
   While building it, also record for each solid cell the direction of its BFS parent
   chain's first step → `airDir` (unit vector toward nearest air, quantized to the 6
   axes; smooth later by normalizing the average over the fragment's source voxels).
2. **Energy gradient** at fragment origin: central differences on `effective`
   (as in `FragmentSimVelocity.ts:33-62`), negated, normalized. Zero-gradient fallback:
   `(0,1,0)`.
3. **Direction:** `dir = normalize( FREE_FACE_WEIGHT × airDir + (1−FREE_FACE_WEIGHT) × gradDir )`,
   `FREE_FACE_WEIGHT = 0.65`. This makes projections come out of the free face —
   under-stemmed/short-burden plans throw rock at the pit, which is the gameplay loop.
4. **Magnitude:** fragment overflow = Σ over its source voxels of
   `overflowOut[voxel] / seedsInThatVoxel` (orphan clusters: 0 → they only collapse).
   ```
   proximity = exp(−distAir(origin) × SURFACE_PROXIMITY_DECAY)      // decay 0.5
   vMag      = min( sqrt(2 × overflow / mass) × proximity, MAX_PROJECTION_VELOCITY )
   ```
5. **Tier:** `isProjection = vMag > PROJECTION_VELOCITY_THRESHOLD` (2.0 m/s).
   Collapse tier gets `initialVelocity = (0,0,0)`.

### A5 — Projectile grouping (`src/core/mining/ProjectileGrouping.ts`, new file)

Caps the number of ballistic bodies (D4). Fragments are grouped, never resized.

1. Input: projected-tier fragments only. If `count ≤ MAX_ACTIVE_PROJECTILES` (256):
   one projectile per fragment; done.
2. Else, greedy agglomeration:
   - Bucket fragments in a spatial hash of cell size `PROJECTILE_GROUP_RADIUS` (2 m).
   - Visit fragments sorted by `vMag` descending (id ascending tie-break).
   - Each unvisited fragment opens a projectile, then absorbs unvisited fragments in
     its own + 26 neighbouring hash cells that satisfy BOTH:
     `dot(dirA, dirB) > PROJECTILE_GROUP_DIR_COS` (0.8) and
     `|vMagA − vMagB| / max(vMagA, vMagB) < PROJECTILE_GROUP_SPEED_TOL` (0.35),
     until the projectile holds `k = ceil(projectedCount / MAX_ACTIVE_PROJECTILES)`
     members or no candidates remain.
   - Leftover singletons above the cap: absorb each into the nearest existing
     projectile (position distance, id tie-break) regardless of similarity — the cap is
     hard.
3. Aggregate: mass/volume sums, mass-weighted centroid + velocity; write
   `projectileId` on members.
4. Collapse-tier fragments are **not** grouped (their "simulation" is a vertical drop,
   cost O(1) each, no cap needed).

### A6 — Authoritative resolution (`src/core/mining/BlastResolve.ts`, new file)

Runs entirely inside `executeBlast`, before it returns. After this step the
`GameState` is final; the timeline is a pure replay script.

1. **Terrain surface function.** `surfaceY(x,z)` = `computeVoxelColumnSurfaceY` on the
   post-clearing grid **plus** current pile height at that cell
   (`DebrisPiles.pileHeightAt`). Piles grow during resolution: process projectiles in
   ascending flight-time order, then drops.
2. **Projectile arcs.** Closed form from `origin`, `velocity v`, gravity
   `g = GRAVITY` (−9.81): march `t` in steps of `BALLISTIC_SAMPLE_DT = 0.05 s`
   (max `BALLISTIC_MAX_T = 12 s`); at each sample compute
   `p(t) = origin + v·t + ½·g·t²` and stop at the first `t` where
   `p.y ≤ surfaceY(p.x, p.z)`. Refine impact by one bisection step. Record
   `impactPosition`, `flightDurationS`, `impactSpeed = |v + g·t|`. Clamp `p.x/p.z` to
   grid bounds (fragments never leave the world; hitting the border wall = impact).
3. **Impact damage.** At the impact cell (and its 8 neighbours at half effect):
   `impactEnergy = ½ × massKg × impactSpeed²`. Kill employees in the cell
   (probability `min(1, impactEnergy / IMPACT_KILL_ENERGY)`, seeded rng), destroy
   vehicles the same way with `IMPACT_VEHICLE_ENERGY`, damage buildings by comparing
   `impactEnergy` against `structuralResistance` (reuse the occupant-casualty formula
   from `computeBlastEntityDamage`). Append results to the same `BlastResult` damage
   fields.
4. **Projectile split-on-rest (D4).** Deposit member fragments around
   `impactPosition`: deterministic sunflower/spiral scatter of radius
   `SPLIT_SCATTER_RADIUS × cbrt(volumeM3)` (constant 0.8, radius clamped to ≥ 1 cell);
   each member lands in the cell under its scatter point, pushed onto that cell's pile
   stack (`baseY` = pile height before push; push raises pile by
   `fragment.volume / (1 m²)` capped at `2 × cbrt(volume)` to avoid absurd single-cell
   towers — overflow into the lowest-pile neighbouring cell instead). Update
   `fragment.position` to its rest position. Fill `timeline.splitRests`.
5. **Collapse drops.** For each collapse-tier fragment, in ascending origin-Y order
   (bottom rocks land first, stack bottom-up): rest cell = its own (x,z); `toY` =
   pile-aware `surfaceY` at that cell + half its own height; push onto pile.
   `delayS = COLLAPSE_STAGGER_PER_METRE × (origin.y − floorY)` gives the crumble
   stagger, where `floorY` = lowest fragmented voxel Y in that column.
6. **Report metrics.** `maxProjectionDistance` = max horizontal distance
   origin→impact over projectiles; `projectionCount` = projected-tier **fragment**
   count (not projectile count — report is about rocks, not physics bodies).
7. Everything mutates only: grid (already cleared in A2), `state.groundFragments`,
   `state.debrisPiles`, damage lists. Haulers/rock-breaker read `groundFragments`
   exactly as they read the old transient list — wire `mining.ts:252-253` to the new
   fields (`ctx.lastBlastFragmentData = result.fragments` stays valid).

### A7 — Cosmetic playback (`src/renderer/FragmentAnimator.ts`, new file)

Consumes `BlastResult.timeline` + `fragments` + `projectiles`. Owns no game logic.

1. On `GameRenderer.onBlast`: hand the result to `FragmentAnimator.begin(result, nowS)`.
   Spawn all fragments in `FragmentMesh` at their **origins** (collapse tier) — but
   projected-tier members are NOT spawned yet; instead spawn one instance per
   *projectile* scaled to `cbrt(projectile.volumeM3)` (a flying clump reads fine at
   cartoon fidelity and keeps instance updates ≤ 256).
2. Per frame (`update(dtS)`), for each active element compute position analytically:
   - Projectile, `t < flightDurationS`: `p(t) = origin + v·t + ½g·t²` + tumble rotation
     (angular velocity from `shapeSeed`, constant).
   - Projectile, `t ≥ flightDurationS`: despawn the clump instance; spawn its member
     fragments at scatter positions slightly above their rests; each plays a
     `SETTLE_DURATION_S = 0.4` drop-and-squash ease to its rest transform, then freezes.
   - Drop, `t > delayS`: fall from `fromY` with gravity, clamp at `toY`, one small
     bounce (10 % height), freeze at rest.
   Elements outside `MAX_RENDERED_FRAGMENTS` (existing 2 000 instance budget in
   `FragmentMesh`) skip animation and appear directly at rest via the existing
   stratified `sampleEvenly` — sampling now happens over the *rest* state.
3. `FragmentMesh` changes: accept per-frame transform updates for a set of instance
   ids (`updateTransforms(list)`), accept anisotropic scale from `halfExtents`, use
   `shapeSeed` (not `id`) for variant/jitter selection, and delete
   `computeRenderScatter` + the projection-offset logic in `FragmentRenderSampling.ts`
   (positions are authoritative now; the file keeps only `sampleEvenly`/`hash01`).
4. When every element is frozen, `FragmentAnimator` goes idle (no per-frame cost).
   Hauling pickup already removes instances by fragment id — keep that path; also call
   `DebrisPiles.removeFragment` results to re-seat instances of fragments that slid
   down (simple downward tween, no physics).
5. Headless/console: `FragmentAnimator` simply never runs; state is already final (D6).

---

## 7. Constants (`src/core/config/balance.ts`)

**Add:**

| Constant | Value | Used by |
|---|---|---|
| `SUB_CELL_RESOLUTION` | 2 | A3 |
| `SEEDS_BASE` | 0.35 | A3 |
| `SEEDS_PER_RATIO` | 2.0 | A3 |
| `MAX_SEEDS_PER_VOXEL` | 8 | A3 |
| `SEED_SEARCH_RADIUS` | 3 | A3 |
| `MAX_ORPHAN_COMPONENT_SUBCELLS` | 64 | A3 |
| `MAX_FRAGMENTS_PER_BLAST` | 50000 | A3 (guard only, D3) |
| `FREE_FACE_WEIGHT` | 0.65 | A4 |
| `MAX_ACTIVE_PROJECTILES` | 256 | A5 |
| `PROJECTILE_GROUP_RADIUS` | 2.0 | A5 |
| `PROJECTILE_GROUP_DIR_COS` | 0.8 | A5 |
| `PROJECTILE_GROUP_SPEED_TOL` | 0.35 | A5 |
| `BALLISTIC_SAMPLE_DT` | 0.05 | A6 |
| `BALLISTIC_MAX_T` | 12 | A6 |
| `SPLIT_SCATTER_RADIUS` | 0.8 | A6 |
| `IMPACT_KILL_ENERGY` | 50000 | A6 (tune in P5) |
| `IMPACT_VEHICLE_ENERGY` | 200000 | A6 (tune in P5) |
| `COLLAPSE_STAGGER_PER_METRE` | 0.04 | A6/A7 |
| `SETTLE_DURATION_S` | 0.4 | A7 |

**Add to `RockCatalog.ts`:** per-rock `transmissionLoss` (0–1). Initial values: soft
rocks (low `energyAbsorption`) 0.10, hard rocks 0.20 — linear map from the existing
absorption range, tuned in P5.

**Keep:** `MAX_PROPAGATION_ITERATIONS`, `FRAGMENTATION_MULTIPLIER`,
`SURFACE_PROXIMITY_DECAY`, `MAX_PROJECTION_VELOCITY`, `PROJECTION_VELOCITY_THRESHOLD`,
`OVERSIZED_FRAGMENT_THRESHOLD`, `BLAST_ZONE_RADIUS`, `BLAST_ENERGY_EPSILON`, `GRAVITY`,
`MAX_RENDERED_FRAGMENTS` (renderer).

**Delete (with their last consumer):** `FRAGMENTATION_SCORE_SCALE`, `MERGE_PROBABILITY`,
`COLLISION_DEFLATE_AMOUNT`, `MAX_VORONOI_POINTS`, `MAX_FRAGMENTS_PER_VOXEL`,
`PROJECTION_SPEED_THRESHOLD`, `PHYSICS_FRAGMENT_CAP`, `PHYSICS_STEP_DT`,
`PHYSICS_MAX_STEPS`, `PHYSICS_TERRAIN_CLEARANCE`, `PHYSICS_SETTLE_SPEED`,
`PHYSICS_SETTLE_FRACTION`, `SLEEP_VELOCITY_THRESHOLD`, `SLEEP_TICKS_REQUIRED`,
`CRATER_EXCAVATION_MAX_RADIUS`, `CRATER_EXCAVATION_DEPTH_VOXELS`,
`FRAGMENT_CRATER_YOFFSET_*`, `FRAGMENT_RENDER_JITTER_RADIUS`,
`FRAGMENT_PROJECTION_RENDER_DISTANCE_SCALE`, `FRAGMENT_PROJECTION_RENDER_MAX_DISTANCE`.
Rock catalog: collapse `fractureThreshold` into `energyAbsorption` (identical values
today — keep `energyAbsorption`, delete `fractureThreshold`, update the two legacy call
sites while they still exist in P0–P2).

---

## 8. Phase plan

Each phase is one PR on its own branch, lands green, and leaves the game playable.
Run the verification gate channels listed per phase; `static` + `logic` always.

### P0 — Dead-code removal and groundwork (small) — ✅ DONE

**Deleted** (with their tests, D9):
- Entire `src/physics/` directory (14 files) and `tests/unit/physics/` (6 files).
- `tests/integration/blast-physics.test.ts` — not anticipated in this plan; it drove the
  deleted layer end-to-end. Its blast-level assertions are re-created in P3 against the
  new authoritative resolution.
- cannon-es from `package.json` + lockfile.
- `fractureThreshold` from `RockCatalog.ts`; `energyAbsorption` is now the single field
  (identical values), and its doc comment states it doubles as the fracture threshold.
  Call sites updated: `SoftwarePreview.ts:53`, `BlastExecution.ts:184`.
- Orphaned balance constants: `FRAGMENTATION_SCORE_SCALE`, `MAX_VORONOI_POINTS`,
  `MERGE_PROBABILITY`, `COLLISION_DEFLATE_AMOUNT`, all six `PHYSICS_*`, both `SLEEP_*`.
  `GRAVITY` and the §7 keep-list constants stay.

**Ported to core:** `src/core/mining/FragmentComposition.ts` +
`tests/unit/mining/FragmentComposition.test.ts` (18 tests).

**Deviations from this plan, and why:**
1. **`propagateEnergy` / `identifyFragmentedVoxels` deletion deferred to P1.** Their
   ~400 lines of tests in `BlastCalc.test.ts` encode exactly the behaviour P1's
   typed-array rewrite must reproduce (air blocking, overflow sharing, island
   detachment). Deleting the functions a phase ahead of their replacement throws that
   away and forces P1 to re-derive it. P1 replaces them in place and migrates the tests.
2. **Helpers landed in `FragmentComposition.ts`, not parked in `FragmentGeneration.ts`.**
   Composition averaging is its own concern with its own tests, and it keeps
   `FragmentGeneration.ts` free for the A3 algorithm under the 300-line convention.
3. **The ported averaging math was wrong and is fixed.** The old
   `computeWeightedAverage` divided each rock's weighted sum by *that rock's own*
   accumulated weight, so a fragment straddling a cruite voxel and a sandite voxel came
   out as 100 % cruite **and** 100 % sandite — coefficients summing to 2.0. The core
   version divides by the total weight across all contributing voxels and normalizes, so
   that fragment is 50/50. Locked in by the "straddling two strata" test.
4. **`VoxelOreComposition` (array form) dropped.** Ores stay
   `Record<string, number>`, matching `FragmentData.oreDensities` — one ore shape in the
   codebase instead of two. `computeAverageOreDensities` returns the record directly.
   §5.1 and A3 read accordingly.
5. **Sources are `VoxelContribution { x, y, z, weight }`**, not seed indices — the
   seed-index model dies with Voronoi. `weight` is the volume the fragment takes from
   that voxel, which is exactly what A3's sub-cell clustering produces.

**Verified:** `static` (typecheck clean), `logic` (239 files / 6816 tests green — down
from 245/7109 purely by deleting the dead layer's own tests), `scenario` (111/111),
`npm run build` clean. Visual/playability channels not applicable — no runtime behaviour
changed.

### P1 — Energy propagation goes live (medium) — ✅ DONE

**Landed:** `src/core/mining/EnergyPropagation.ts` (field, damped 18-neighbour
propagation, charge seeding, distance-to-air, intensity) and
`src/core/mining/VoxelFragmentation.ts` (break / crack / burden-lift / detach passes),
both on flat typed arrays. `executeBlast` now runs them instead of the 1/r² field, and
the forced crater-excavation pass is gone (D7). 43 new unit tests.

**What P1 found that the plan had wrong.** Wiring the spec model up exposed four defects
in the design itself, not just in the old code. Each is a correction to §6, and the
later phases inherit them:

1. **`effective/threshold` is a dead signal.** A1 caps absorption at the voxel's
   threshold, so *every* fragmented voxel retains exactly its threshold and the ratio is
   pinned at 1.0. A3's `F(v) = SCALE × effectiveEnergy/T(v)` therefore assigns every
   voxel the identical fragment count — the original spec's step 3 was degenerate for
   the same reason, and it showed up as fragment counts that were exactly 2× the cleared
   voxel count no matter how the charge changed. **Use `intensityAt` instead**:
   `(effective + overflowOut) / threshold`, which counts what passed *through* a voxel.
   1.0 means "just barely broke"; a voxel beside the charge reads far higher. **A3 must
   seed from intensity, not from retained energy.**
2. **Explosive energy needed an explicit unit conversion.** The catalog's `energyPerKg`
   was tuned against the 1/r² field, whose `+ε` denominator amplified a charge roughly
   4× at point blank. Conservation-based propagation has no such amplifier, so every
   blast fell below threshold and broke *nothing*. `EXPLOSIVE_ENERGY_SCALE` (10.0) makes
   the conversion explicit, calibrated so a stemmed pattern breaks a realistic volume per
   kilogram (powder factor ≈ 0.3 kg/m³). `PROJECTION_ENERGY_TO_KINETIC` does the same for
   turning leftover energy into a speed — without it a 2-tonne fragment could never reach
   a dangerous velocity, and flyrock topped out at 2 m/s.
3. **An isotropic crushing model can never break out to the surface.** This was the big
   one. Spreading overflow evenly and requiring every voxel to individually absorb its
   threshold makes a blast a sphere that dies at a fixed radius: the charge carved a
   sealed cavity four metres under intact ground and *the surface never moved*, at any
   charge size — the player's original complaint in a new form. Real blasting does not
   pulverise its burden, it displaces it toward relief. Three mechanisms now do that
   work, and A3/A4 should assume all three:
   - `confinementFactor` — rock near a free face breaks at
     `UNCONFINED_THRESHOLD_FACTOR` (0.35) of its confined threshold, ramping to full over
     `CONFINEMENT_FULL_DEPTH` (6 m).
   - `FREE_FACE_BIAS` (2.0) — overflow prefers neighbours closer to air, so the burden
     fails *toward* the face instead of equally in all directions.
   - `liftUnderminedBurden` — a cap of intact rock up to `BURDEN_BREAKOUT_MAX` (4 m) over
     a broken zone lifts rather than being crushed. Thicker burden still holds, which is
     what preserves "charge buried too deep fails to break out" as a real, visible
     failure mode.
4. **Stemming only ever *added* energy, never suppressed throw.** With `stemmingEfficiency`
   alone, a well-stemmed blast threw as much rock as a careless one, and the
   under-stemmed shot actually broke *less* (its charge column was longer, diluting
   energy per voxel — an inversion). Fixed on both sides: a charge now occupies the
   length its own mass needs (`CHARGE_KG_PER_METRE`) anchored at the hole bottom, so more
   explosive means a taller worked column rather than a weaker one; and throw energy is
   scaled by `MIN_THROW_FRACTION + (1−MIN) × blowout²`. Measured result — same 8 kg
   charge, varying only stemming: 0 m → 30 m/s and 160 projections (catastrophic);
   1 m → 22 m/s (bad); 2 m → 11 m/s heave, zero dangerous projections (perfect). That
   gradient *is* the gameplay loop the brief asked for.

**Other fixes:** a hole drilled below the world floor silently discarded the part of its
charge that fell outside the grid (a third of the explosive in one test fixture);
`buildHoleSeeds` now clamps to the floor. Voxel thresholds also honour `fractureModifier`,
so rock cracked by an earlier blast really is weaker — the plan omitted this and it would
have silently dropped a shipped feature.

**Scenario/test rebaselines, and why each is honest rather than convenient:**
- `blast-overcharge.json` charged 8 kg with 2 m stemming — under correct physics that is
  a *safe* shot, so the scenario no longer matched its own name. Now unstemmed, which is
  what "overcharge produces flyrock" means when stemming governs throw.
- The `crater excavation guarantee` suite tested the deleted hack. Replaced with the
  property that actually matters: the blast must break through to the surface (asserted
  by counting opened surface voxels), plus a new case proving an over-buried charge
  does *not*.
- `navgrid-patching` asserted a blasted column becomes `void`. 12 kg of the strongest
  explosive does not remove an 18 m column, and even 9×20 kg does not — real benches are
  5–15 m. Replaced with the real invariant: **patched must equal rebuilt** over the
  cleared region, which is immune to physics tuning.
- `NavGrid clearedRegion` asserted the cleared region equalled the searched blast zone.
  It is now the tight AABB of what actually broke — more correct, and the test asserts
  containment and that it covers the hole.
- The tutorial haul test hard-coded fragment id 0 and assumed it carried ore. Ore sits in
  veins; it now picks an ore-bearing fragment, which is what the test's own comment said
  it was checking.

**Verified:** `static` clean; `logic` 6861 tests / 241 files green; `scenario` 111/111
(and the batch went from 175 s to 45 s — typed arrays replacing per-voxel `getVoxel`
allocation); `visual` — before/after screenshots inspected, showing 9 drill markers on
unbroken ground becoming a pale excavated rock face with a grey debris pile in it, holes
consumed, surrounding terrain untouched. Fragments still snap to their rest positions;
animating them is P4.

### P1 — original plan text (superseded by the record above)

- New `src/core/mining/EnergyPropagation.ts`: A1 + A2 on typed arrays.
  `transmissionLoss` added to `RockCatalog.ts`.
- Rewire `executeBlast` step 3: replace the per-voxel
  `calculateEnergyField`/`calculateFragmentation` loop with
  A1 → A2 → `computeBlastEntityDamage` (adapted signature). Fragmented voxels feed the
  existing `toClear` path unchanged. Keep generating legacy `FragmentData` points as a
  **temporary adapter**: per fragmented voxel emit `max(1, round(2·E/T))` point
  fragments with the old radial velocity (`calculateInitialVelocity` from the nearest
  hole) so rendering/hauling behave until P2/P3. `crackedVoxels`: cells with
  `0.5·T ≤ E < FRAGMENTATION_MULTIPLIER·T` keep the `scaleFractureAt(0.7)` weakening.
- Delete the crater hack + its two constants (D7): real craters now come from cleared
  voxels.
- Delete `calculateEnergyField`, `calculateFragmentation`, `calculateFragmentCount`,
  `classifyProjection`, `calculateFreeFace` if now unreferenced.
- **Tests** (`tests/unit/mining/EnergyPropagation.test.ts`): energy conservation
  invariant; single charged cell in uniform rock → monotonically decaying symmetric
  field; air pocket blocks propagation (cell behind an air wall gets ~0);
  over-charged voxel fragments its neighbourhood, under-charged fragments only itself;
  island detachment (arch over a cleared pocket fragments); determinism (two runs,
  same seed, identical arrays). Adapt `BlastCalc.test.ts` and
  `tests/integration/blast-enhanced.integration.test.ts` expectations.
- **Scenario rebaseline** (expected-output updates, judged not blindly recorded):
  `blast-basic`, `blast-overcharge`, `blast-undercharge`,
  `blast-voxel-fragmentation`, `multi-deck-blast`, `survey-then-blast`,
  `blast-report-metrics` (see `scripts/scenario-defs/`). Overcharge must clear MORE
  voxels than basic; undercharge fewer/none — assert the ordering, not just counts.

**Verify:** `static`, `logic`, `scenario`, plus `visual`
(`npm run screenshot -- --name p1-crater --commands "new_game seed:42; <drill/charge/blast commands from blast-basic.json>"`)
— inspect the PNG: crater present, no floating rock.
**Acceptance:** all scenarios green; crater visible without the hack; energy
conservation test green.

### P2 — Spec fragment generation (large) — ✅ DONE

**Landed:** `src/core/mining/FragmentGeneration.ts` — sub-cell dicing, intensity-driven
seeding, nearest-seed clustering, orphan lumps — plus 21 unit tests. `executeBlast` now
emits clustered fragments carrying real `halfExtents`, composition and ore;
`FragmentMesh` scales each instance to the fragment's own bounding box. The Delaunay /
Voronoi / merge machinery this replaces was already deleted in P0, so nothing was ported.

**Deviations and findings:**
1. **Seeding uses `intensityAt`, per P1's finding 1** — `SEEDS_PER_INTENSITY` replaces the
   plan's `SEEDS_PER_RATIO`. Measured: mean fragment volume falls 0.655 → 0.450 → 0.385 m³
   as the charge grows, and the oversized share falls with it. Size is now a readable
   consequence of the plan, with no budget anywhere in the path.
2. **Orphan lumps are grown breadth-first, not depth-first.** DFS snaked through the rock
   and produced stringy fragments whose own centre of mass fell outside them. BFS gives
   compact lumps. Sub-cells queued past the size cap go back into the pool for their own
   lump rather than being dropped.
3. **Render scatter and the crater Y-offset are deleted, not kept as the plan allowed.**
   Both existed to fake variety and crater-depth for point fragments that all shared a
   voxel centre. Fragments now have real distinct centroids inside the removed volume, so
   the fakes are redundant — and keeping them would have fought the real positions P3
   computes. `FRAGMENT_RENDER_JITTER_RADIUS`, `FRAGMENT_PROJECTION_RENDER_*` and
   `FRAGMENT_CRATER_YOFFSET_*` are gone.
4. **Shape variants key off `shapeSeed`, not `id`.** Ids run consecutively, so
   `id % SHAPE_VARIANTS` cycled the eight shapes in lockstep and produced a visibly
   repeating pattern across the pile. Random seeds fill buckets unevenly, so
   `spawnFragments` now falls through to any bucket with room instead of dropping
   fragments once one variant fills.

**A gameplay bug this exposed, fixed here.** Fragments now carry honest masses (median
~1 t, boulders past 4 t) where the old model produced arbitrarily-subdivided crumbs.
`findReachableGroundFragment` picked the *nearest* fragment with no regard for whether it
could ever be stored, so a hauler was dispatched to a boulder heavier than the whole T1
warehouse, loaded it, and was turned away at the depot every tick — the fleet deadlocked
silently and `storedMassKg` never moved. It now skips fragments heavier than the room
left in storage. Worth noting for a future phase: the "oversized fragments must be broken
by a Rock Fragmenter first" rule from the design doc is still not enforced anywhere in
the haul path — haulers will happily take a boulder if the warehouse is big enough.

**Verified:** `static` clean; `logic` 6882 tests / 242 files green; `scenario` 111/111;
`visual` — a strong blast and a weak one inspected side by side. The strong blast leaves a
wide muck pile of visibly distinct angular chunks of varying size and proportion under a
large excavated face; the 2 kg pop_rock blast leaves a small scar and almost no debris.

### P2 — original plan text (superseded by the record above)

- Implement A3 in `src/core/mining/FragmentGeneration.ts`.
- Extend `FragmentData` per §5.1 (add fields; keep old ones). `origin = position` at
  creation.
- Replace the P1 adapter: `executeBlast` now emits clustered fragments. Velocity still
  the legacy radial formula, applied per fragment (P3 replaces it).
- Renderer: `FragmentMesh` reads `halfExtents` (anisotropic scale) + `shapeSeed`;
  spawn at `origin` + hash scatter as today (teleport still allowed until P4).
- Oversized flow: `oversized` now set from real cluster volume; verify rock-breaker
  scenario coverage still passes (`fragmentBoulder` consumes volume/mass only).
- **Tests** (`tests/unit/mining/FragmentGeneration.test.ts`): volume conservation
  invariant; low-ratio field (all voxels r≈1) yields fragments spanning multiple voxels
  (boulder emergence); high-ratio field yields ≥ 4 fragments per voxel with none
  oversized; composition of a fragment straddling two rock strata is the volume-weighted
  mix; determinism; orphan-component splitting; `MAX_FRAGMENTS_PER_BLAST` guard warns
  and degrades instead of dropping volume.
- Scenario rebaseline: fragment-count/size assertions in the blast scenarios
  (overcharge → many small fragments, few oversized; undercharge → few, mostly
  oversized — assert the monotonic relationship).

**Verify:** `static`, `logic`, `scenario`, `visual` (screenshot: fragment size
variety visible — fines near holes, boulders at the blast rim).
**Acceptance:** fragment size distribution demonstrably responds to charge amount in
scenarios; volume conservation test green.

### P3 — Velocity, projectiles, authoritative landing (medium) — ✅ DONE

**Landed:** `FragmentVelocity.ts` (free-face direction + stemming-scaled magnitude),
`ProjectileGrouping.ts` (the capped-body grouping), `BlastResolve.ts` (arc tracing,
pile stacking, playback maths). 45 new unit tests. `executeBlast` now clears the rock
*before* resolving landings, so fragments fall into the hole the blast just made.
`BlastResult` gained `maxThrowDistance`, `projectileCount` and `flights`; the blast
report shows the furthest throw, and the rating uses distance rather than a speed proxy.

**Deviations:**
1. **No `DebrisPiles` state, and no `groundFragments` field.** `state.logistics.fragments`
   already is the fragment registry and is already persisted (serialization is generic
   JSON over `GameState`). A pile is just the fragments sharing a column, ordered by
   height — deriving it from positions removes a parallel structure that could drift out
   of sync, and sidesteps the Map-codec work §5.4 called for. Pile heights are tracked
   only *during* resolution, where the stacking order is decided.
2. **Direction is a free-face/gradient blend, replacing the radial-from-hole direction**
   P1 inherited from the legacy code. Radial was actively wrong: a charge at the bottom
   of a hole flung its deepest fragments down and sideways *into* solid rock.
3. **Playback maths live in core** (`flightPositionAt`, `totalFlightDuration`) rather than
   the renderer, so the arc is unit-testable in Node and the renderer holds no physics.
4. **Landing damage to employees, vehicles and buildings is NOT implemented.** A6 step 3
   called for it; `computeBlastEntityDamage` still handles blast-time damage only. Impact
   damage needs the entity lists threaded into `executeBlast`, which today only receives
   `buildingState`. Recorded as outstanding rather than half-done — see §11.

**Verified:** `static` clean; `logic` 6947 tests / 247 files; `scenario` 111/111.
A nine-hole blast resolves ballistics for 1280 fragments in ~90 ms.

### P4 — Cosmetic playback (large, browser-verified) — ✅ DONE

**Landed:** `src/renderer/FragmentAnimator.ts` plus 20 tests (10 for the core playback
maths, 10 for the animator). `GameRenderer.update` steps it each frame; `onBlast` starts
it with the blast's flights.

**Deviations:**
1. **The animator interpolates to the authoritative resting place rather than replaying
   the launch velocity.** Horizontal motion runs straight from break to rest; the vertical
   is the parabola connecting those points in the flight's own duration under gravity.
   Solving for the launch speed this way means the animation *cannot* end anywhere but
   the fragment's real position — the picture can never drift from game state, however
   the arc was computed. For a straight drop it reduces to exactly free fall from rest.
2. **No tumble rotation, squash, or bounce.** Positions animate; orientation is fixed at
   spawn. Worth adding, but it is polish on top of a collapse that now reads correctly.
3. **No separate flying-clump instance for grouped projectiles.** Members animate
   individually along their own paths, which is simpler and costs nothing extra: the
   instance budget is unchanged and grouping already bounded the ballistics work.

**Verified:** `static`, `logic`, `scenario` all green. `visual` — a frame captured at
detonation and one after settling: at t=0 the fragments sit high and tightly packed
inside the rock they broke from; settled, they have dropped and spread with the excavated
face visible above them. Headless Chrome has no GPU (~6 s/frame), so a true mid-collapse
frame is not reliably capturable locally — the browser CI job is the place for that.

### P3 — original plan text (superseded by the record above)

- Implement A4 (`FragmentVelocity.ts`), A5 (`ProjectileGrouping.ts`),
  A6 (`BlastResolve.ts`, `DebrisPiles.ts`).
- `GameState`: add `groundFragments`, `debrisPiles`; codecs in `SaveLoad.ts`
  (+ round-trip test). Migrate hauling/rock-breaker reads (`mining.ts`,
  `HaulingTask.ts`) from the transient list to `state.groundFragments`; hauling pickup
  and boulder split call `DebrisPiles.removeFragment` / `pushFragment`.
- `BlastResult` gains `projectiles`, `timeline`, `casualties`, `destroyedVehicleIds`,
  `maxProjectionDistance`. Rating (`calculateRating`) now uses
  `maxProjectionDistance` and impact casualties instead of the `speed > 15` proxy —
  keep thresholds simple, final tuning in P5. Delete `calculateInitialVelocity`,
  `findNearestHole` velocity use.
- **Tests**: A4 — fragment beside a vertical free face gets a mostly-horizontal
  velocity out of the face; buried fragment (distAir > 6) stays collapse-tier;
  clamp at `MAX_PROJECTION_VELOCITY`. A5 — ≤ cap ⇒ 1:1; 10 000 projected fragments ⇒
  ≤ 256 projectiles with mass conservation (Σ projectile mass = Σ member mass);
  determinism. A6 — arc lands on flat terrain where the closed form says; landing on a
  pile lands higher; pile stack order matches landing order;
  `removeFragment` bottom-removal reseats upper fragments with **zero** casualties;
  impact on an occupied cell kills with seeded rng; save/load round-trips piles.
- Scenario: extend `blast-overcharge` (or add `blast-projection-damage.json`) —
  employee standing in the throw path of an over-charged, under-stemmed front-row blast
  dies from a *landing* impact, not the blast itself; a good plan produces
  `maxProjectionDistance < spacing × 2`.

**Verify:** `static`, `logic`, `scenario`.
**Acceptance:** blasting, hauling, and rock-breaking a full pile works end-to-end in
console mode; save/load mid-pile is lossless; projection danger reproduces in scenario.

### P4 — Cosmetic playback (large, browser-verified)

- Implement A7 (`FragmentAnimator.ts`), the `FragmentMesh` changes
  (`updateTransforms`, anisotropic scale, `shapeSeed` variants), delete
  `computeRenderScatter` and the projection-offset path, delete the crater-Y-offset
  constants (`FRAGMENT_CRATER_YOFFSET_*` etc.).
- `GameRenderer.onBlast` → `FragmentAnimator.begin`; `GameRenderer.update(dt)` steps it.
  Coordinate with `BlastEffects` (existing dust/flash): reuse its per-hole delay list so
  the crumble starts with the detonation flash.
- Respect sequence delays: offset each fragment/projectile's timeline start by the
  delay of its nearest hole (lookup by horizontal distance) — a sequenced blast ripples.
- **Tests:** unit-test the pure parts (arc evaluation at t, stagger computation,
  instance-budget sampling over rest state) in `tests/unit/` (renderer pure helpers are
  testable in Node — keep DOM/three out of them).
- **Visual channel (the point of the whole refactor):**
  `npm run scenario -- --scenario blast-execution-visual --mode interaction --screenshots`
  plus timed captures: screenshot at detonation +0 s (rock intact / flash), +1 s
  (fragments mid-air, arcs visible), +4 s (settled pile). **Open every PNG with Read**
  and confirm: fragments visibly displaced between frames, pile visible at rest, no
  fragment frozen mid-air, no fragment below terrain. Label the PR `full-ci` (touches a
  player-facing flow → CI runs the browser jobs; do not run the whole suite locally).

**Verify:** `static`, `logic`, `scenario`, `visual` (inspected frames), `playability`
via CI `full-ci`.
**Acceptance:** the three timed screenshots show motion (differences between frames),
and the settled frame matches authoritative positions (spot-check one fragment via
state dump vs. pixel position).

### P5 — Balance, report, previews, docs (small)

- Tune: `transmissionLoss` per rock, `SEEDS_*`, `IMPACT_*`, rating thresholds. Method:
  a scenario matrix over {undercharged, matched, overcharged} × {1 m, 2 m, 4 m spacing}
  asserting monotonic relationships (more charge ⇒ more cleared volume, smaller mean
  fragment, longer max projection).
- Re-point software previews (`SoftwarePreview.ts`): tier-1 heatmap reads the A1
  `effective` array; tier-2 fragment-size prediction runs A3 seed-count math without
  clustering; tier-3 projection risk runs A4 magnitude on surface voxels.
- Update skill `.claude/skills/gameplay-blast-system/SKILL.md` to describe THIS
  pipeline (per the agentic-context-edition conventions); update `BLAST_SYSTEM.md`
  references if present; delete stale constants from the skill.
- Verify `blast-preview-software-tiers`, `blast-report-metrics`, `blast-report-visual`
  scenarios; rebaseline.

**Verify:** `static`, `logic`, `scenario`, `visual` on preview overlays.
**Acceptance:** matrix scenario green; skill matches code; no dangling references to
deleted symbols (`grep` for each deleted constant name → no hits outside git history).

---

## 9. Guardrails for the implementing agent

1. **Core purity** (`.claude/rules/core-purity.md`): everything in §A1–A6 lives in
   `src/core/`, no three.js/cannon/DOM imports, seeded `Random` only, `Result<T>` over
   throws, constants in `src/core/config/`. New exported function ⇒ mirrored unit test.
2. **File size:** 300-line convention — the per-phase file split above is designed for
   it; split further with `*Utils.ts` siblings if needed, never merge phases into one
   giant file.
3. **Determinism:** any iteration over a `Map`/`Set` that feeds rng or output ordering
   must be sorted first (or use arrays). Two identical runs must produce byte-identical
   `BlastResult` JSON — add this as an integration test in P3 if not earlier.
4. **Never trust "tests pass" for visuals** — P1/P2/P4 require opening screenshots with
   the Read tool and describing them (verification gate, visual channel). While a
   browser-driven run is in flight, change no file and start no second harness.
5. **Scenario rebaselining is judged, not recorded:** when a blast scenario's expected
   numbers change, reason about whether the new number is *plausible* (ordering
   relations in §8 per phase) before updating the JSON.
6. **i18n:** any new player-visible string (report fields, warnings) goes through
   `t('key')` with `en.json` + `fr.json` entries.
7. **Don't touch:** drilling/charging UI, survey system, navgrid internals (only feed
   `clearedRegion` as today), `BoulderFragmentation` splitting math, `BlastEffects`
   particles (reused as-is in P4).
8. When a decision is genuinely open, follow `agentic-decision-autonomy`
   (default + record); the decisions in §2 are **not** open.

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Scenario churn: many blast scenarios re-baselined twice (P1, P2) | Batch expectation updates per phase; assert orderings/monotonicity rather than exact counts wherever the schema allows. |
| Pile height changes navgrid walkability | Out of scope: piles do NOT alter the navgrid in this refactor; haulers path to the pile cell as today. Record as a follow-up issue in P3. |
| `groundFragments` growth over a long game | Hauling already consumes fragments; add a debug console command `fragments_stats` in P3 for observability. |
| Renderer instance budget (2 000) vs. 50 000-fragment guard | `sampleEvenly` over rest state keeps coverage; gameplay is unaffected (authoritative state holds all fragments). |
| Sequence-delayed holes vs. single propagation pass | Accepted simplification: propagation treats all charges as simultaneous (energy-wise); delays only affect visuals (A7) and vibration grouping (existing `groupChargesByDelay`). Matches current behaviour. |
