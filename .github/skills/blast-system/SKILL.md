---
name: blast-system
description: >
  Blast physics specification for BlastSimulator2026: energy calculation, fragmentation model,
  terrain subtraction, fragment generation, detonation sequence, vibration, quality assessment,
  and software upgrades. Use when working on blast mechanics, mining systems, or physics code.
---

## Overview

When a blast is executed, the following pipeline runs:

```
BlastPlan → Energy Calculation → Fragmentation → Terrain Subtraction → Fragment Generation → Physics Simulation → Damage Assessment → State Update
```

## Energy Calculation

For each hole `i` in the blast plan:

```
E_i = explosive.energyPerKg * chargePlan[i].amountKg
```

The energy field at any point `P` in the rock is the sum of contributions from all holes:

```
E(P) = Σ_i [ E_i / (distance(P, hole_i.position)² + ε) ]
```

Where `ε` is a small constant to avoid division by zero (e.g., 0.01).

### Stemming Effect
Stemming (inert material packed at the top of the hole) directs energy downward. If stemming is insufficient:
- Energy bleeds upward → **upward projections**
- Effective energy at depth is reduced

```
stemming_factor = clamp(stemmingHeight / (holeDepth * 0.3), 0, 1)
effective_E_i = E_i * (0.5 + 0.5 * stemming_factor)   // energy at depth
upward_E_i = E_i * (1 - stemming_factor) * 0.7         // energy directed upward (projection risk)
```

### Water Effect
If the hole contains water (rain + porous rock + no tubing) and the explosive is water-sensitive:

```
if (hole.isFlooded && explosive.waterSensitive && !hole.hasTubing):
    effective_E_i = effective_E_i * 0.1   // explosive mostly fails
    reliability = 0.1                      // 10% chance it works at all
```

## Fragmentation Model

### Fracture Threshold
Each rock type has a `fractureThreshold` (energy needed to break it).

```
if E(voxel.center) >= rock.fractureThreshold:
    voxel is fractured → becomes a fragment
elif E(voxel.center) >= rock.fractureThreshold * 0.5:
    voxel is cracked → weakened for future blasts (reduce threshold by 30%)
else:
    voxel is unaffected
```

### Fragment Size
Fragment size depends on how much energy exceeds the threshold:

```
energy_ratio = E(voxel.center) / rock.fractureThreshold
if energy_ratio >= 1.0 and energy_ratio < 2.0:
    fragment_size = voxel_size * lerp(1.0, 0.3, (energy_ratio - 1.0))
elif energy_ratio >= 2.0 and energy_ratio < 4.0:
    fragment_size = voxel_size * lerp(0.3, 0.1, (energy_ratio - 2.0) / 2.0)
elif energy_ratio >= 4.0:
    fragment_size = voxel_size * 0.05   // Over-blasted — dust and projections
```

### Fragment Count
Total volume of fragments must equal volume of fractured voxels (conservation of mass):
```
fragments_per_voxel = ceil(voxel_volume / fragment_volume)
```

## Terrain Subtraction

When voxels are fractured:
1. Their density in the VoxelGrid is set to 0 (empty)
2. The marching cubes mesh must be recalculated for the affected region
3. Cracked (but not fractured) voxels have their fracture threshold reduced but remain in the grid

## Fragment Generation

Each fragment is a data object:

```typescript
interface FragmentData {
    id: string;
    position: Vec3;
    size: Vec3;
    volume: number;           // m³
    mass: number;             // kg (volume * rock.density)
    rockType: string;
    oreDensities: OreMap;
    initialVelocity: Vec3;
    isProjection: boolean;    // If energy_ratio >= 4.0
}
```

### Initial Velocity Calculation
```
direction = normalize(fragment.position - nearestHole.position)
speed = sqrt(2 * E(fragment.position) / fragment.mass) * projection_factor
```

A fragment is classified as a **projection** if:
- Its initial speed exceeds `projection_speed_threshold` (configurable, e.g., 15 m/s)
- OR it originates from a voxel where `energy_ratio >= 4.0`

## Detonation Sequence Simulation

### Time Steps
The blast is simulated in millisecond steps:
```
for t in range(0, max_delay + blast_duration, dt):
    for each hole with delay == t:
        detonate(hole)  → calculate energy, create fragments
    advance_physics(dt)
```

### Free Face Principle
Holes should detonate toward a **free face** (an open surface where rock can move). If a hole detonates with no free face:
- Energy converts to **vibrations** instead of fragmentation
- Much worse vibration score impact
- Fragmentation quality is poor (large blocks)

```
free_face_factor = calculateFreeFace(hole, currentTerrainState)
effective_fragmentation = base_fragmentation * (0.3 + 0.7 * free_face_factor)
vibration_multiplier = 1.0 + 2.0 * (1.0 - free_face_factor)
```

## Vibration Calculation

```
V(d) = Σ_i [ charge_per_delay_i^0.7 / d^1.5 ] * ground_factor
```

Where `charge_per_delay_i` is the total charge detonating at the same millisecond delay. Spreading the sequence reduces vibrations.

## Blast Quality Assessment

```typescript
interface BlastReport {
    fragmentCount: number;
    averageFragmentSize: number;
    fragmentSizeStdDev: number;
    oversizedFragments: number;
    projectionCount: number;
    maxProjectionDistance: number;
    vibrationAtVillages: VillageVibration[];
    casualties: number;
    buildingsDestroyed: string[];
    vehiclesDestroyed: string[];
    totalRockVolume: number;
    totalOreValue: number;
    rating: 'perfect' | 'good' | 'mediocre' | 'bad' | 'catastrophic';
}
```

### Rating Criteria
- **Perfect:** Good fragmentation, zero projections, low vibrations
- **Good:** Acceptable fragmentation, 0-2 minor projections within safety zone
- **Mediocre:** Some oversized blocks OR some projections beyond safety zone
- **Bad:** Many oversized blocks OR casualties OR building damage
- **Catastrophic:** Multiple deaths OR widespread destruction

## Software Upgrades (Prediction Tools)

| Tier | Name | Shows | Cost |
|------|------|-------|------|
| 0 | None | Nothing — blind blasting | Free |
| 1 | "BlastView Basic" | Energy heatmap (2D top-down) | $ |
| 2 | "FragPredict" | Expected fragment size distribution | $$ |
| 3 | "ProjectoScan" | Projection risk zones (3D overlay) | $$$ |
| 4 | "VibroMap Pro" | Vibration propagation to villages | $$$$ |

## Implementation Priority

1. **BlastCalc.ts** — Pure math: energy field, fragmentation, velocity
2. **BlastResult.ts** — Data structures for blast outcomes
3. **VoxelGrid terrain subtraction** — Removing fractured voxels
4. **Fragment generation** — Creating fragment data objects
5. **Sequence simulation** — Time-stepped detonation
6. **Vibration calculation** — Score impact
7. **Physics integration** — Cannon-es bodies for fragments
8. **Collision/damage** — Fragment impacts on entities
9. **Prediction overlays** — Software tier visualizations
