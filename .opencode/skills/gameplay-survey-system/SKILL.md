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
| Seismic Survey | Detonates small charge + records reflections | `survey.seismic` | 3,000 | 8 | ±15% ore density | 20-cell radius, down to `SURVEY_DEPTH_BELOW_SURFACE.seismic` (25 m) below the surface |
| Core Sample | Drills narrow extraction core | `survey.core_sample` | 800 | 4 | ±5% ore density | Single column, down to `SURVEY_DEPTH_BELOW_SURFACE.core_sample` (40 m, the deepest drill-rig hole) below the surface |
| Aerial Spectroscopy | Drone scans surface mineral signature | `survey.aerial` | 1,500 | 3 | ±25% ore density | 30-cell radius, top `SURVEY_DEPTH_BELOW_SURFACE.aerial` (2) layers only |

The Time (ticks) duration above starts once the assigned surveyor physically arrives at the target site, not when the survey is queued — walking there is separate travel time on top of it, arrival-gated per `dev-architecture`'s arrival-gated-actions convention.

Accuracy improves with surveyor skill level:
```
finalError = baseError * (1 - (skillLevel - 1) * 0.12)
// Skill 5: ≈ ±5% for seismic, ≈ ±1.7% for core sample
```

## Survey Result Data

`src/core/mining/SurveyCalc.ts` declares `SurveyMethod`, `SurveyResult` and `EstimateSurveyParams`, and is the authority on their fields. `estimates` is keyed column-first: `"x,z"` → ore id → estimated density in [0, 1], with zero estimates omitted; `confidence` in [0, 1] comes from surveyor skill and method accuracy.

A survey goes **stale when a blast clears a column inside its coverage disc** (`SurveyResult.stale`, set by `markSurveysStaleByBlast`; time never makes a survey stale). A stale survey drops out of the pre-blast estimate and the post-blast ore report (`freshSurveys`); an older fresh survey still covering a column is used instead. UI renders confidence heatmap overlay, stale points in grey.

### Depth-resolved estimates (#1683)

`SurveyResult.depthProfile?` (`"x,z"` → `SurveyDepthBand[]`, `{ fromM, toM, ores }`, built by `buildDepthProfile` in `SurveyDepthProfile.ts`) says at what depth ore sits. Depth is metres below the column's surface anchor (`computeVoxelColumnSurfaceY`, the same datum as the `SURVEY_DEPTH_BELOW_SURFACE` reach; 1 voxel = 1 m). Band thickness is `SURVEY_DEPTH_BAND_METRES`: core sample 1 m (a depth log), seismic 5 m (coarse bands); bands align to multiples of the thickness and the last is clipped to the method's window. Each band is the solid-voxel ore average plus the same Gaussian noise, clamp and 0.05 rounding as `estimates`; zero ores and empty bands are omitted. Aerial surveys stay a surface reading and carry no profile. The profile is built in a second pass after the column loop, so `estimates` and `confidence` and their RNG draws are unchanged. Additive: no `SAVE_VERSION` bump; an old save has no `depthProfile`, and the Survey panel and hover tag then show no depth line. The panel card shows each ore's depth range (and the core sample's depth log); the hover tag shows up to 3 depth bands (unmerged) for each of the top 3 ores.

### Result card and overlay value (#1684)

The Survey panel card lists up to 4 ores by estimated value (`summarizeSurveyOres`, `SurveyOreSummary.ts`). Each shows coverage (share of surveyed area), typical grade (mean over columns that found it), a labelled peak grade (never a bare %), and tonnage and value. All are estimates, with a footnote saying so. Tonnes = columns found x 1 m^2 x `SURVEY_DEPTH_BELOW_SURFACE[method]` x typical grade x `ORE_DENSITY_KG_M3` / 1000; value = tonnes x 1000 x `valuePerKg` x survey confidence (the `BlastValueEstimate` formula, confidence included). Defaults chosen: the depth used for tonnage is the method's whole scan window; the coverage denominator is the nominal `SURVEY_COVERAGE_RADIUS` disc around the survey's `centerX`/`centerZ` (counted with `isColumnInSurveyDisc`, so ore-free columns that `estimateSurveyResult` omits still count; world-edge clipping is not modelled), never below the number of estimate columns, so a core sample is 1 column. Compact figures (`k`/`M`/`B`, `Md` in French) are i18n keys `ui.survey.compact_*`; the per-ore value formula is `oreValuePerM3` (`BlastValueEstimate.ts`). The overlay colours each fresh column by its estimated ore value per m^3 (`columnOreValuePerM3`) on a fixed log scale (`SURVEY_OVERLAY_VALUE_FLOOR`..`CEIL`, red to green); stale columns stay grey; survey confidence modulates quad opacity (`SURVEY_OVERLAY_QUAD_OPACITY_BASE` 0.55 at 0, 1 at 1).

## Estimation Algorithm (`SurveyCalc.ts`)

1. **Sample true voxel composition** from `VoxelGrid.getVoxel(x, y, z).oreDensities`
2. **Add Gaussian noise** scaled by method's base error and surveyor skill:
   ```
   estimatedDensity = trueDensity + rng.gaussian(0, baseError * (1 - skillBonus))
   estimatedDensity = clamp(estimatedDensity, 0, 1)
   ```
3. **Round to nearest 0.05** (discrete bands: 0%, 5%, 10%… 100%)
4. **Depth window:** each method samples `SURVEY_DEPTH_BELOW_SURFACE[method]` layers from the surface down (aerial 2, seismic 25, core sample 40); the panel shows it as "N m deep". Depth vs rarity: aerial sees only the surface layer; seismic (25 m) goes past the common ores into the uncommon ones; core sample (40 m) reaches the deepest a drill can.
5. **Seismic**: averages estimates over 3-voxel vertical groups (coarser vertical resolution; the trailing group may be smaller)

Always use seeded PRNG (`src/core/math/Random.ts`) — never `Math.random()`.

## Rock Composition (Voxel Data Model, Ch.5 prerequisite)

Each voxel stores a mixture of up to 4 rock types with coefficients summing to 1.0 — empty for air. `VoxelRockComposition` and the `VoxelData` record that holds it are declared in `src/core/world/VoxelGrid.ts`.

Generation: per-rock Simplex noise field + level bias, normalized. Feeds texture rendering + blast energy threshold calculation.

## Ore Veins

Ores not spread homogeneously. Each ore type has separate Simplex field with high threshold → elongated vein shapes. Surface veins visible as color tints. Sub-surface veins require survey to detect.

**Biome ore progression (#1677).** Ore depth windows (`OreCatalog`) are global; biome coverage comes from which rocks host which ores (`RockCatalog.oreProbabilities`). Every biome has a sellable common ore (dirtite/rustite/blingite) in 0-8 m, rarer and richer ore deeper, and no biome is barren in any 8 m slab of 0-40 m. Over seeds 1, 7, 42 on the 64x64 sandbox, most interior 8x8x8 m blocks hold >= 2 t ore in both the 0-8 m and 24-32 m slabs, and mean ore depth rises with rarity tier. Desert and red-canyon shallow ore stays bit-identical; only deeper ore was added. To extend a biome, add ore entries to its rocks, not new depth windows. Generation stays pure in seed + position (`TERRAIN_GENERATOR_VERSION` unchanged).

## Ore Grade Reporting Post-Blast

Post-blast report reads estimates at each fragment's `origin` (never landing `position`), floor-keyed column via `surveyColumnKey`/`findSurveyForColumn` in `SurveyColumn.ts`.

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


Survey price (#1568): `surveyCostFor(method, modifiers, tick)` = `SURVEY_COSTS[method]` scaled by live `survey_cost` modifiers, rounded. `runSurvey` checks, charges and books that price and stores it as the action's `orderCost`, so cancelling refunds what was paid; console and Survey panel display the same scaled price.
