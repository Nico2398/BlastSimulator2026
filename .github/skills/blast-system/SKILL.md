---
name: blast-system
description: >
  Full blast pipeline specification for BlastSimulator2026: 4-step simulation (energy propagation,
  Voronoi fragmentation, fragment shape generation, tiered physics). Covers voxel rock composition,
  Delaunay/Voronoi algorithms, Tier A/B physics, balance constants, and atomic task breakdown.
  Use when working on blast mechanics, mining systems, fragment physics, or voxel grid code.
---

## Pipeline Overview

Four-step physical simulation. All tuning constants in `src/core/config/balance.ts`:

```
Step 1: Energy Propagation through voxel grid
Step 2: Voxel Fragmentation + Collision Mesh Rebuild
Step 3: Fragment Shape Generation (Voronoi)
Step 4: Fragment Projection + Physics Settle
```

## Voxel Data Model

**Voxel size:** 1 m × 1 m × 1 m cells (SI units throughout).

**Rock composition per voxel** — up to 4 rock types with coefficients summing to 1.0:

```typescript
export interface VoxelRockComposition {
  rocks: Array<{ rockId: string; coefficient: number }>;
}
```

Generation: per-rock 3D Simplex noise field + level bias, normalized:
```
raw[r] = simplex3(x * r.noiseFreq, y * r.noiseFreq, z * r.noiseFreq) + r.levelBias
coefficient[r] = max(0, raw[r]) / sum(max(0, raw))
```

**Ore veins** — not homogeneous. Each ore has a separate Simplex field with high threshold, producing elongated veins:
```typescript
export interface VoxelOreComposition {
  ores: Array<{ oreId: string; density: number }>; // density 0–1
}
```

## Step 1 — Energy Propagation

**Per-voxel energy threshold** (weighted by rock composition):
```
T(v) = Σ_r [ coefficient[r] * rockDef[r].energyAbsorption ]
```

**Initial energy** (per charged hole cell):
```
E_init(v) = explosiveDef.energyPerKg * chargeKg * stemmingEfficiency(stemmingM, depthM)
```

**Propagation loop** (iterative, guard at `MAX_PROPAGATION_ITERATIONS = 500`):
```
For each voxel v with overflowEnergy[v] > 0:
  absorbed = min(incoming, T(v) - effectiveEnergy[v])
  effectiveEnergy[v] += absorbed
  leftover = incoming - absorbed
  generatedOverflow[v] += leftover  // used in Step 4

  if leftover > 0:
    distribute share to up to 6 face-adjacent non-air neighbours
```

This naturally models confined blasts (strong rock → energy stays local) + overcharged blasts (energy radiates outward).

## Step 2 — Fragmentation & Damage

**Fragmentation criterion:**
```
if effectiveEnergy[v] >= FRAGMENTATION_MULTIPLIER * T(v):  → voxel becomes air (fragment)
```
`FRAGMENTATION_MULTIPLIER = 1.0` (balance constant).

**Isolated rock islands:** After fragmentation pass, flood-fill from grid boundary. Solid clusters with no path to boundary also fragmented (handles hanging rock arches).

**Entity damage:**
- Employees/vehicles on a fragmented voxel → instantly killed/destroyed
- Buildings: sum `effectiveEnergy` of all voxels beneath footprint. If sum > `buildingDef.structuralResistance` → building destroyed. Occupant survival:
  ```
  deathProbability = clamp((totalEnergy / structuralResistance - 1.0) * 0.5, 0.30, 1.00)
  ```
  Uses seeded PRNG.

**NavMesh update:** All fragmented voxels + new exposed surface cells → submitted as dirty region to NavGrid (Ch.6).

## Step 3 — Fragment Shape Generation (Voronoi)

**Fragmentation score per voxel:**
```
F(v) = FRAGMENTATION_SCORE_SCALE * (effectiveEnergy[v] / T(v))
fragmentCount(v) = max(1, round(F(v)))
```
`FRAGMENTATION_SCORE_SCALE = 3.0`.

**Voronoi seed sampling:** randomly sample `fragmentCount(v)` 3D points inside each fragmented voxel's unit cube. All points form global point cloud P.

**3D Voronoi decomposition:**
1. **Bowyer–Watson Delaunay tetrahedralization** of point cloud P
2. **Dual Voronoi cells**: circumcentres of Delaunay tetrahedra as vertices
3. **Clip** each cell to the fragmented voxel union bounding box

If `count(P) > MAX_VORONOI_POINTS (2000)`, cull lowest-score voxels first.

**Merging pass** (non-convex, realistic shapes):
```
for each Voronoi cell C:
  if rng.next() < MERGE_PROBABILITY (0.35):
    merge with random face-adjacent neighbour N (union of convex hulls)
```

**RockFragment schema:**
```typescript
export interface RockFragment {
  id: number;
  cx: number; cy: number; cz: number;
  graphicVertices: Float32Array;
  collisionVertices: Float32Array;   // deflated inward by COLLISION_DEFLATE_AMOUNT (0.05m)
  composition: VoxelRockComposition;
  oreComposition: VoxelOreComposition;
  volumeM3: number;
  massKg: number;
  overflowEnergy: number;            // inherited from source voxels
  velocity: Vec3;
  simulationTier: 'projected' | 'collapse';
  state: 'flying' | 'settling' | 'static';
}
```

## Step 4 — Projection Velocity & Physics Settle

**Velocity assignment (energy gradient + surface proximity):**
```
grad_dir = normalize(-computeEnergyGradient(effectiveEnergy, C))
distToAir = distanceToNearestAirVoxel(C)
surfaceProximityFactor = exp(-distToAir * SURFACE_PROXIMITY_DECAY)  // decay = 0.5
v_mag = sqrt(2 * fragment.overflowEnergy / fragment.massKg) * surfaceProximityFactor
v_mag = min(v_mag, MAX_PROJECTION_VELOCITY)  // 80 m/s
F.velocity = grad_dir * v_mag
```

**Classification:** `v_mag > PROJECTION_VELOCITY_THRESHOLD (2.0 m/s)` → `'projected'`; else `'collapse'`.

**Tier A — Projected fragments:**
- Full Cannon-es rigid body with `massKg` and convex hull collision
- Hard cap: `PHYSICS_FRAGMENT_CAP = 200` full bodies; beyond cap → parabolic trajectory (analytic)
- Aggressive sleep: `|velocity| < SLEEP_VELOCITY_THRESHOLD (0.1 m/s)` for `SLEEP_TICKS_REQUIRED (15)` ticks → `'static'`

**Tier B — Collapse fragments:**
- No Cannon-es body. Drops straight down each tick until hitting terrain or static fragment
- Instantaneous landing → registers in surface grid → `'static'` (CPU-free)

**Landing damage (both tiers):** if human, vehicle, or building in impact cell → apply `impactEnergy = massKg * v_mag²`.

**Fragment collection rules:**
```
oversized = fragment.volumeM3 > OVERSIZED_FRAGMENT_THRESHOLD (0.5 m³)
oversized  → must be broken by Rock Fragmenter first
!oversized → Debris Hauler with capacity ≥ fragment.massKg can collect directly
```

## Balance Constants (`src/core/config/balance.ts`)

```typescript
export const MAX_PROPAGATION_ITERATIONS = 500;
export const FRAGMENTATION_MULTIPLIER = 1.0;
export const FRAGMENTATION_SCORE_SCALE = 3.0;
export const MERGE_PROBABILITY = 0.35;
export const COLLISION_DEFLATE_AMOUNT = 0.05;
export const SURFACE_PROXIMITY_DECAY = 0.5;
export const MAX_PROJECTION_VELOCITY = 80;
export const PROJECTION_VELOCITY_THRESHOLD = 2.0;
export const PHYSICS_FRAGMENT_CAP = 200;
export const SLEEP_VELOCITY_THRESHOLD = 0.1;
export const SLEEP_TICKS_REQUIRED = 15;
export const MAX_VORONOI_POINTS = 2000;
export const OVERSIZED_FRAGMENT_THRESHOLD = 0.5;
```

## Blast Quality Rating

```typescript
interface BlastReport {
  fragmentCount: number;
  averageFragmentSize: number;
  oversizedFragments: number;
  projectionCount: number;
  maxProjectionDistance: number;
  vibrationAtVillages: VillageVibration[];
  casualties: number;
  buildingsDestroyed: string[];
  totalRockVolume: number;
  totalOreValue: number;
  rating: 'perfect' | 'good' | 'mediocre' | 'bad' | 'catastrophic';
}
```

## Software Upgrades (Prediction Tools)

| Tier | Name | Shows |
|------|------|-------|
| 0 | None | Blind blasting |
| 1 | "BlastView Basic" | Energy heatmap (2D top-down) |
| 2 | "FragPredict" | Expected fragment size distribution |
| 3 | "ProjectoScan" | Projection risk zones (3D overlay) |
| 4 | "VibroMap Pro" | Vibration propagation to villages |

## Atomic Task Breakdown

| # | Task | File(s) |
|---|------|---------|
| 5.0 | **Prerequisite:** Change `VoxelCell.rockId` to `VoxelCell.composition: VoxelRockComposition`; update TerrainGen + all callers | `src/core/voxels/VoxelGrid.ts`, `src/core/terrain/TerrainGen.ts` |
| 5.1 | Assert voxel cell size = 1 m | `src/core/voxels/VoxelGrid.ts` |
| 5.2 | Add `energyAbsorption` and `density` constants to each `RockDef` | `src/core/config/RockCatalog.ts` |
| 5.3 | Implement `computeThreshold(voxel)` — weighted sum of rock coefficients × absorption | `src/core/mining/BlastCalc.ts` |
| 5.4 | Implement `computeInitialEnergy(hole)` — explosive × kg × stemming efficiency | `src/core/mining/BlastCalc.ts` |
| 5.5 | Implement `propagateEnergy(grid, initial)` — iterative overflow loop, guard at 500 | `src/core/mining/BlastCalc.ts` |
| 5.6 | Implement `identifyFragmentedVoxels()` — fragmentation criterion + island flood-fill | `src/core/mining/BlastCalc.ts` |
| 5.7 | Entity damage — instant kill for employees/vehicles; building sum + survival roll | `src/core/mining/BlastCalc.ts` |
| 5.8 | Implement `computeFragmentationScore()` and Voronoi seed sampling | `src/physics/VoronoiFrag.ts` (new) |
| 5.9 | Implement Bowyer-Watson Delaunay + dual Voronoi + clip; respect `MAX_VORONOI_POINTS` | `src/physics/VoronoiFrag.ts` |
| 5.10 | Implement Voronoi merging pass (`MERGE_PROBABILITY ≈ 0.35`) | `src/physics/VoronoiFrag.ts` |
| 5.11 | Generate `RockFragment` objects: graphic mesh, deflated collision mesh, `overflowEnergy` | `src/physics/FragmentSim.ts` (new) |
| 5.12 | Implement Step 4 velocity: energy gradient × surface proximity; classify `simulationTier` | `src/physics/FragmentSim.ts` |
| 5.13 | Implement Tier A cannon-es loop — full rigid body, cap, parabolic fallback | `src/physics/FragmentSim.ts` |
| 5.14 | Implement Tier B gravity-drop — straight-down, column stack, immediate static | `src/physics/FragmentSim.ts` |
| 5.15 | Implement aggressive sleep: stationary for `SLEEP_TICKS_REQUIRED` → `'static'` | `src/physics/FragmentSim.ts` |
| 5.16 | Implement fragment support graph and stack-collapse on pickup | `src/physics/FragmentSim.ts` |
| 5.17 | Implement fragment size check and oversized flag | `src/core/mining/BlastCalc.ts` |
| 5.18 | Wire ore reporting: collect fragment → add to `GameState.collectedOre` | `src/core/GameState.ts` |
| 5.19 | Trigger NavMesh dirty-region update after fragmentation pass | `src/core/voxels/NavGrid.ts` |
| 5.20 | Add all balance constants to `balance.ts` | `src/core/config/balance.ts` |
| 5.21 | Add i18n keys for blast damage events, oversized fragment alert (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` |
| 5.22 | Add `blast_preview` console command — prints energy map, fragment count, projected/collapse split | `src/console/commands/mining.ts` |
