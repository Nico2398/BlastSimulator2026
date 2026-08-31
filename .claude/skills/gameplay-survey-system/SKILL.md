---
name: gameplay-survey-system
description: >
  Rock composition and survey system for BlastSimulator2026: 3 survey methods (seismic,
  core sample, aerial), estimation algorithm with Gaussian noise and skill scaling,
  and ore grade reporting post-blast. Use when implementing or
  modifying surveys, ore discovery, voxel composition, or post-blast ore yield mechanics.
---

## Design Goals

Players should not know exactly what ore is in ground — discovery is rewarding, creates strategic decisions. Before blasting, surveys reveal ore density maps to help choose blast patterns, explosive types, contract targets. Existing `VoxelGrid` stores `oreDensities` per voxel; this system adds **player-visible layer**: surveys, reveal mechanics, estimation error.

## Survey Methods

Three tools with different cost/accuracy/coverage tradeoffs:

| Method | Tool | i18n Key | Cost ($) | Time (ticks) | Accuracy | Coverage |
|--------|------|---------|---------|-------------|---------|---------|
| Seismic Survey | Detonates small charge + records reflections | `survey.seismic` | 3,000 | 8 | ±15% ore density | 20-cell radius, full depth |
| Core Sample | Drills narrow extraction core | `survey.core_sample` | 800 | 4 | ±5% ore density | Single column, full depth |
| Aerial Spectroscopy | Drone scans surface mineral signature | `survey.aerial` | 1,500 | 3 | ±25% ore density | 30-cell radius, surface only (Y=0 to Y=−1) |

The Time (ticks) duration above starts once the assigned surveyor physically arrives at the target site, not when the survey is queued — walking there is separate travel time on top of it, arrival-gated per `dev-architecture`'s arrival-gated-actions convention.

Accuracy improves with surveyor skill level:
```
finalError = baseError * (1 - (skillLevel - 1) * 0.12)
// Skill 5: ≈ ±5% for seismic, ≈ ±1.7% for core sample
```

## Survey Result Data

`src/core/mining/SurveyCalc.ts` declares `SurveyMethod`, `SurveyResult` and `EstimateSurveyParams`, and is the authority on their fields. `estimates` is keyed column-first: `"x,z"` → ore id → estimated density in [0, 1], with zero estimates omitted; `confidence` in [0, 1] comes from surveyor skill and method accuracy.

Survey results **stale after 100 ticks** (terrain disturbed by blasts). UI renders confidence heatmap overlay.

## Estimation Algorithm (`SurveyCalc.ts`)

1. **Sample true voxel composition** from `VoxelGrid.getVoxel(x, y, z).oreDensities`
2. **Add Gaussian noise** scaled by method's base error and surveyor skill:
   ```
   estimatedDensity = trueDensity + rng.gaussian(0, baseError * (1 - skillBonus))
   estimatedDensity = clamp(estimatedDensity, 0, 1)
   ```
3. **Round to nearest 0.05** (discrete bands: 0%, 5%, 10%… 100%)
4. **Aerial** surveys: only sample Y = surfaceY and surfaceY−1 (shallow horizon)
5. **Seismic**: averages estimates over a 3-voxel vertical smear (coarser vertical resolution)

Always use seeded PRNG (`src/core/math/Random.ts`) — never `Math.random()`.

## Rock Composition (Voxel Data Model, Ch.5 prerequisite)

Each voxel stores a mixture of up to 4 rock types with coefficients summing to 1.0 — empty for air. `VoxelRockComposition` and the `VoxelData` record that holds it are declared in `src/core/world/VoxelGrid.ts`.

Generation: per-rock Simplex noise field + level bias, normalized. Feeds texture rendering + blast energy threshold calculation.

## Ore Veins

Ores not spread homogeneously. Each ore type has separate Simplex field with high threshold → elongated vein shapes. Surface veins visible as color tints. Sub-surface veins require survey to detect.

## Ore Grade Reporting Post-Blast

After a blast, `computeBlastOreReport()` calculates actual ore yield from destroyed voxels and compares to pre-blast survey estimate:

| Condition | Event | Effect |
|-----------|-------|--------|
| Actual yield > 120% of estimate | "Lucky Strike" | +$2,000 bonus, ecology −1 |
| Actual yield < 60% of estimate | "Barren Blast" | No bonus, surveyor morale −10 |
| Treranium ore found (any amount) | "Legendary Vein" | Contract premium ×3 for 20 ticks |
| Absurdium > 30% of yield | "Absurdium Jackpot" | Mafia event probability +40% |

## Survey Visibility Rules

- Un-surveyed voxels: dominant rock color, no ore overlay
- Surveyed voxels: color-coded ore density overlay, opacity = confidence
- Seismic surveys disturb nearby buildings: −10 HP per survey if building within 5 cells

