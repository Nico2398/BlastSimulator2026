# BlastSimulator2026 — Blast System Technical Specification

This document specifies the blast simulation algorithm in detail. The blast system is the **central gameplay mechanic** and must be implemented with care. Every calculation described here must exist as a pure function in `src/core/mining/BlastCalc.ts` and be fully covered by unit tests.

## 1. Overview

When a blast is executed, the following pipeline runs:

```
BlastPlan → Energy Calculation → Fragmentation → Terrain Subtraction → Fragment Generation → Physics Simulation → Damage Assessment → State Update
```

## 2. Energy Calculation

For each hole `i` in the blast plan:

```
E_i = explosive.energyPerKg * chargePlan[i].amountKg
```

The energy field at any point `P` in the rock is the sum of contributions from all holes:

```
E(P) = Σ_i [ E_i / (distance(P, hole_i.position)² + ε) ]
```

Where `ε` is a small constant to avoid division by zero (e.g., 0.01).

### 2.1 Stemming Effect
Stemming (inert material packed at the top of the hole) directs energy downward. If stemming is insufficient:
- Energy bleeds upward → **upward projections**
- Effective energy at depth is reduced

```
stemming_factor = clamp(stemmingHeight / (holeDepth * 0.3), 0, 1)
effective_E_i = E_i * (0.5 + 0.5 * stemming_factor)   // energy at depth
upward_E_i = E_i * (1 - stemming_factor) * 0.7         // energy directed upward (projection risk)
```

### 2.2 Water Effect
If the hole contains water (rain + porous rock + no tubing) and the explosive is water-sensitive:

```
if (hole.isFlooded && explosive.waterSensitive && !hole.hasTubing):
    effective_E_i = effective_E_i * 0.1   // explosive mostly fails
    reliability = 0.1                      // 10% chance it works at all
```

## 3. Fragmentation Model

The terrain volume affected by the blast is determined by the energy field. For each voxel in the blast zone:

### 3.1 Fracture Threshold
Each rock type has a `fractureThreshold` (energy needed to break it).

```
if E(voxel.center) >= rock.fractureThreshold:
    voxel is fractured → becomes a fragment
elif E(voxel.center) >= rock.fractureThreshold * 0.5:
    voxel is cracked → weakened for future blasts (reduce threshold by 30%)
else:
    voxel is unaffected
```

### 3.2 Fragment Size
Fragment size depends on how much energy exceeds the threshold:

```
energy_ratio = E(voxel.center) / rock.fractureThreshold
if energy_ratio >= 1.0 and energy_ratio < 2.0:
    // Good fragmentation
    fragment_size = voxel_size * lerp(1.0, 0.3, (energy_ratio - 1.0))
elif energy_ratio >= 2.0 and energy_ratio < 4.0:
    // Fine fragmentation
    fragment_size = voxel_size * lerp(0.3, 0.1, (energy_ratio - 2.0) / 2.0)
elif energy_ratio >= 4.0:
    // Over-blasted — dust and projections
    fragment_size = voxel_size * 0.05
    // Mark as potential projection
```

### 3.3 Fragment Count
The total volume of fragments must equal the volume of fractured voxels (conservation of mass). Fragment count per voxel:

```
fragments_per_voxel = ceil(voxel_volume / fragment_volume)
```

## 4. Terrain Subtraction

When voxels are fractured:
1. Their density in the VoxelGrid is set to 0 (empty)
2. The marching cubes mesh must be recalculated for the affected region
3. Cracked (but not fractured) voxels have their fracture threshold reduced but remain in the grid

This creates the visual effect of rock being removed from the terrain, leaving a crater or bench.

## 5. Fragment Generation

Each fragment is a data object:

```typescript
interface FragmentData {
    id: string;
    position: Vec3;           // World position
    size: Vec3;               // Bounding box dimensions
    volume: number;           // m³
    mass: number;             // kg (volume * rock.density)
    rockType: string;         // From parent voxel
    oreDensities: OreMap;     // Inherited from parent voxel
    initialVelocity: Vec3;    // From blast energy
    isProjection: boolean;    // If energy_ratio >= 4.0
}
```

### 5.1 Initial Velocity Calculation
Fragment velocity depends on the energy gradient (fragments move away from explosion center):

```
direction = normalize(fragment.position - nearestHole.position)
speed = sqrt(2 * E(fragment.position) / fragment.mass) * projection_factor

// Stemming-deficient holes cause upward projections
if upward_E_i > threshold:
    upward_fragments get velocity with significant Y component
```

For well-designed blasts, fragments should have low velocity (they just crumble down). For over-charged blasts, fragments fly.

### 5.2 Projection Classification
A fragment is classified as a **projection** if:
- Its initial speed exceeds `projection_speed_threshold` (configurable, e.g., 15 m/s)
- OR it originates from a voxel where `energy_ratio >= 4.0`

Projections are dangerous and can fly hundreds of meters in extreme cases.

## 6. Detonation Sequence Simulation

Holes don't all fire at once — the sequence defines timing.

### 6.1 Time Steps
The blast is simulated in millisecond steps:
```
for t in range(0, max_delay + blast_duration, dt):
    for each hole with delay == t:
        detonate(hole)  → calculate energy, create fragments
    advance_physics(dt)
```

### 6.2 Free Face Principle
Holes should detonate toward a **free face** (an open surface where rock can move). The sequence should create free faces progressively:
- Front row detonates first → creates free face
- Second row detonates next → rock moves toward the gap left by first row
- And so on...

If a hole detonates with no free face, the rock has nowhere to go:
- Energy converts to **vibrations** instead of fragmentation
- Much worse vibration score impact
- Fragmentation quality is poor (large blocks)

```
free_face_factor = calculateFreeFace(hole, currentTerrainState)
// 0.0 = completely confined, 1.0 = fully open face
effective_fragmentation = base_fragmentation * (0.3 + 0.7 * free_face_factor)
vibration_multiplier = 1.0 + 2.0 * (1.0 - free_face_factor)
```

## 7. Vibration Calculation

Total vibration at a distance `d` from the blast:

```
V(d) = Σ_i [ charge_per_delay_i^0.7 / d^1.5 ] * ground_factor
```

Where `charge_per_delay_i` is the total charge detonating at the same millisecond delay. This is why **spreading the sequence** (not firing many holes simultaneously) reduces vibrations.

`ground_factor` depends on rock type and terrain between blast and measurement point.

### 7.1 Neighbor Impact
Nearby villages/towns have known positions and distance from the mine. The vibration score impact is:

```
nuisance_delta = -vibration_at_village * sensitivity_factor
```

Where `sensitivity_factor` increases if the village has complained before (event history).

## 8. Blast Quality Assessment

After the blast, compute a quality report:

```typescript
interface BlastReport {
    fragmentCount: number;
    averageFragmentSize: number;        // m³
    fragmentSizeStdDev: number;         // uniformity
    oversizedFragments: number;         // > threshold, need secondary blast
    projectionCount: number;
    maxProjectionDistance: number;       // meters
    vibrationAtVillages: VillageVibration[];
    casualties: number;
    buildingsDestroyed: string[];
    vehiclesDestroyed: string[];
    totalRockVolume: number;            // m³ of rock freed
    totalOreValue: number;              // estimated ore value in fragments
    rating: 'perfect' | 'good' | 'mediocre' | 'bad' | 'catastrophic';
}
```

### 8.1 Rating Criteria
- **Perfect:** Good fragmentation, zero projections, low vibrations
- **Good:** Acceptable fragmentation, 0-2 minor projections within safety zone
- **Mediocre:** Some oversized blocks OR some projections beyond safety zone
- **Bad:** Many oversized blocks OR casualties OR building damage
- **Catastrophic:** Multiple deaths OR widespread destruction

## 9. Software Upgrades (Prediction Tools)

Players can purchase software that shows blast predictions BEFORE executing:

| Tier | Name | Shows | Cost |
|------|------|-------|------|
| 0 | None | Nothing — blind blasting | Free |
| 1 | "BlastView Basic" | Energy heatmap (2D top-down) | $ |
| 2 | "FragPredict" | Expected fragment size distribution | $$ |
| 3 | "ProjectoScan" | Projection risk zones (3D overlay) | $$$ |
| 4 | "VibroMap Pro" | Vibration propagation to villages | $$$$ |

Each tier adds a visualization layer to the blast plan UI. The underlying calculations are the same — the software just reveals them to the player.

## 10. Secondary Blasting

If a blast leaves oversized fragments (too big for excavators), the player can:
1. Design a new mini-blast plan targeting the large fragment
2. Use mechanical breaking (slower, costs machine time)
3. Leave it (blocks vehicle paths, wastes space)

## 11. Implementation Priority

The blast system should be implemented in this order:
1. **BlastCalc.ts** — Pure math: energy field, fragmentation, velocity (fully testable)
2. **BlastResult.ts** — Data structures for blast outcomes
3. **VoxelGrid terrain subtraction** — Removing fractured voxels
4. **Fragment generation** — Creating fragment data objects
5. **Sequence simulation** — Time-stepped detonation
6. **Vibration calculation** — Score impact
7. **Physics integration** — Cannon-es bodies for fragments (separate phase)
8. **Collision/damage** — Fragment impacts on entities
9. **Prediction overlays** — Software tier visualizations (renderer phase)
