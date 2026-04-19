---
name: survey-system
description: >
  Rock composition and survey system for BlastSimulator2026: 3 survey methods (seismic,
  core sample, aerial), estimation algorithm with Gaussian noise and skill scaling,
  ore grade reporting post-blast, and atomic task breakdown. Use when implementing or
  modifying surveys, ore discovery, voxel composition, or post-blast ore yield mechanics.
---

## Design Goals

Players should not know exactly what ore is in the ground — discovery is rewarding and creates strategic decisions. Before blasting, surveys reveal ore density maps that help choose blast patterns, explosive types, and contract targets. The existing `VoxelGrid` stores `oreDensities` per voxel; this system adds the **player-visible layer**: surveys, reveal mechanics, and estimation error.

## Survey Methods

Three tools with different cost/accuracy/coverage tradeoffs:

| Method | Tool | i18n Key | Cost ($) | Time (ticks) | Accuracy | Coverage |
|--------|------|---------|---------|-------------|---------|---------|
| Seismic Survey | Detonates small charge + records reflections | `survey.seismic` | 3,000 | 8 | ±15% ore density | 20-cell radius, full depth |
| Core Sample | Drills narrow extraction core | `survey.core_sample` | 800 | 4 | ±5% ore density | Single column, full depth |
| Aerial Spectroscopy | Drone scans surface mineral signature | `survey.aerial` | 1,500 | 3 | ±25% ore density | 30-cell radius, surface only (Y=0 to Y=−1) |

Accuracy improves with surveyor skill level:
```
finalError = baseError * (1 - (skillLevel - 1) * 0.12)
// Skill 5: ≈ ±5% for seismic, ≈ ±1.7% for core sample
```

## Survey Result Data

```typescript
export type SurveyMethod = 'seismic' | 'core_sample' | 'aerial';

export interface SurveyResult {
  id: number;
  method: SurveyMethod;
  centerX: number;
  centerZ: number;
  completedTick: number;
  surveyorId: number;
  /** Estimated ore densities: (x,z) → ore_id → estimated density 0–1 */
  estimates: Record<string, Record<string, number>>;
  /** Confidence factor 0–1 based on surveyor skill and method accuracy */
  confidence: number;
}
```

Survey results are **stale after 100 ticks** (terrain disturbed by blasts). UI renders a confidence heatmap overlay.

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

Each voxel stores a mixture of up to 4 rock types with coefficients summing to 1.0:

```typescript
export interface VoxelRockComposition {
  rocks: Array<{ rockId: string; coefficient: number }>;
}
```

Generation: per-rock Simplex noise field + level bias, normalized. This data feeds both texture rendering and blast energy threshold calculation.

## Ore Veins

Ores are not spread homogeneously. Each ore type has a separate Simplex field with a high threshold, producing elongated vein shapes. Surface veins are visible as color tints. Sub-surface veins require survey to detect.

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

## Atomic Task Breakdown

| # | Task | File(s) |
|---|------|---------|
| 4.1 | Add `SurveyMethod`, `SurveyResult` interfaces | `src/core/mining/SurveyCalc.ts` (new) |
| 4.2 | Implement `estimateSurveyResult()` — noise + skill scaling | `src/core/mining/SurveyCalc.ts` |
| 4.3 | Implement `isSurveyStale()` — stale after 100 ticks | `src/core/mining/SurveyCalc.ts` |
| 4.4 | Add `surveyResults: SurveyResult[]` and `nextSurveyId` to `GameState` | `src/core/GameState.ts` |
| 4.5 | Add survey cost constants to `balance.ts` | `src/core/config/balance.ts` |
| 4.6 | Implement `runSurvey()` — validate surveyor, deduct cost, enqueue task | `src/core/mining/SurveyCalc.ts` |
| 4.7 | Implement `computeBlastOreReport()` — yield from destroyed voxels | `src/core/mining/SurveyCalc.ts` |
| 4.8 | Wire ore report events to event system (Lucky Strike, Barren Blast, etc.) | `src/core/events/EventEngine.ts` |
| 4.9 | Add i18n keys for survey methods and events (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` |
| 4.10 | Add `survey` console command (`survey seismic x:10 z:10`) | `src/console/commands/mining.ts` |
| 4.11 | Render survey confidence overlay in terrain | `src/renderer/TerrainMesh.ts` |
