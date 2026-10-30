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

### Depth-resolved estimates

`SurveyResult.depthProfile?` (`"x,z"` → `SurveyDepthBand[]`, `{ fromM, toM, ores }`, built by `buildDepthProfile` in `SurveyDepthProfile.ts`) says at what depth ore sits. Depth is metres below the column's surface anchor (`computeVoxelColumnSurfaceY`, the same datum as the `SURVEY_DEPTH_BELOW_SURFACE` reach; 1 voxel = 1 m). Band thickness is `SURVEY_DEPTH_BAND_METRES`: core sample 1 m (a depth log), seismic 5 m (coarse bands); bands align to multiples of the thickness and the last is clipped to the method's window. Each band is the solid-voxel ore average plus the same Gaussian noise, clamp and 0.05 rounding as `estimates`; zero ores and empty bands are omitted. Aerial surveys stay a surface reading and carry no profile. The profile is built in a second pass after the column loop, so it never alters `estimates`, `confidence` or their RNG draws. No `SAVE_VERSION` bump: a save without `depthProfile` loads, and the Survey panel and hover tag then show no depth line. The panel card shows each ore's depth range (and the core sample's depth log); the hover tag shows up to 3 depth bands (unmerged) for each of the top 3 ores.

### Result card and overlay value

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

**Biome ore progression.** Ore depth windows (`OreCatalog`) are global; biome coverage comes from which rocks host which ores (`RockCatalog.oreProbabilities`). Every biome has a sellable common ore (dirtite/rustite/blingite) in 0-8 m, rarer and richer ore deeper, and no biome is barren in any 8 m slab of 0-40 m. Target over seeds 1, 7, 42 on the 64x64 sandbox: most interior 8x8x8 m blocks hold >= 2 t ore in both the 0-8 m and 24-32 m slabs, and mean ore depth rises with rarity tier. Desert and red-canyon shallow ore stays bit-identical. To extend a biome, add ore entries to its rocks, not new depth windows. Generation stays pure in seed + position (`TERRAIN_GENERATOR_VERSION` unchanged).

**Ore deposits.** Sandbox sites (`oreDeposits` on `LevelDef`/`TerrainConfig`/`WorldState`, `SANDBOX_FIXED_ORE_DEPOSITS`; authored campaign levels leave it off and keep legacy veins bit-identically) gate each ore to localized deposits tens of metres across, separated by barren ground. `OreVeinSampler` builds, per ore, a horizontal low-frequency noise (`ore-deposit:<id>` sub-seed, sampled at x,z * `ORE_DEPOSIT_FREQ`); `depositGain` is 0 below the ore's rarity cutoff (`ORE_DEPOSIT_RARITY_COVERAGE`, higher = rarer = fewer deposits) and smoothsteps over `ORE_DEPOSIT_EDGE_WIDTH` up to `ORE_DEPOSIT_CORE_GAIN`, scaling `oreRichness` in the vein threshold, so cores are far richer than deposit fringes. Ores are independent, so they peak in different places. Generation is a pure function of seed, config and absolute x,z: deposits continue past the starting site, saves regenerate them (flag persisted in `WorldState.oreDeposits` and the voxel-grid gen datum; `TERRAIN_GENERATOR_VERSION` unchanged). Target over seeds 1, 7, 42 on all biomes: >= 30% of interior 8 m blocks hold < 1 t in the 0-8 and 8-16 m slabs. **Starter deposit.** Every `oreDeposits` site also gets one world-gen pocket (`src/core/world/StarterDeposit.ts`, `pickStarterDeposit`/`starterPocketAt`, `STARTER_DEPOSIT_*` in `balance.ts`): an 8 m radius pocket of the softest rock carrying rustite at `STARTER_DEPOSIT_ORE_DENSITY` in a 6 m core to 6 m depth, centred 10-25 m from the site centre on the flat, climbable footprint nearest 18 m from the crew corner. It is real voxel ore, so a survey finds it like any other; the reference grade-0 shot on it yields 27.6-36.7 t (median 35.5 t) at sandbox grade scale over six biomes x seeds 1-9, 42, 12345. Authored campaign levels without `oreDeposits` are untouched; Shareholder Summit (`oreDeposits` on) gets one. The pocket's weathered rock is porous, so untubed flooded holes there cannot be drained.

**Pre-blast estimate coverage.** `estimateBlastOre` counts a broken voxel as covered when its column lies inside any fresh survey's disc (`isColumnInSurveyDisc`), barren or not: a barren surveyed column is surveyed, adds $0 and does not lower coverage. Nothing broken (or a charged plan that fragments nothing) is a neutral state ("—" value, "— n/a" margin, no "No survey" and no survey hint), not "No survey". Before charging, any hole inside a fresh disc (`holeCoverage` > 0) is neutral too; with no surveyed hole and nothing broken it stays "No survey". Value is still priced via `findSurveyForColumn`. View mapping: `oreEstimateDisplay.ts`.

**Site ore grade scale.** Optional per-site lever `oreGradeScale` (0 < s <= `ORE_GRADE_SCALE_MAX` = 1; absent = `ORE_GRADE_SCALE_DEFAULT` = 1) lowers how rich a site's ore is, so a lean site can be played without retuning the catalog. Carried like `pitMask`: `LevelDef` -> `WorldState` -> `TerrainConfig` -> `SerializedTerrainGen`, validated on load by `requireValidOreGradeScale` (`corrupt save: <label> is not a valid ore grade scale`); `TERRAIN_GENERATOR_VERSION` unchanged because absent/1 output is bit-identical. Applied in `OreVeinSampler.densitiesAt`: each stored density is multiplied by the scale AFTER the `MIN_STORED_DENSITY` cut and 2-decimal rounding (no re-round, no re-cut). Scale the density, never `ORE_DENSITY_KG_M3`: fragment mass, stored ore and contract ledgers all derive ore kg from density x that constant, so scaling the constant would split the ledgers. Grade thresholds are defined at scale 1 and scale relatively (`scaledGradeThreshold(base, scale)`, `oreGradeScaleOf(world)` in `economy/OreGrade.ts`): `ORE_DEMAND_MIN_GRADE` / `ORE_DEMAND_FULL_GRADE` (haul urgency) and `SPOIL_BARREN_ORE_FRACTION_THRESHOLD` (barren/spoil split) all multiply by the scale, so a leaner site keeps its relative haul and spoil behaviour. Console: `sandbox start ... ore_grade:<n>` (n in (0, 1], else `sandbox.invalid_ore_grade` and no state is created); omitted by default.

**Depth grade multiplier.** Where sandbox ore deposits are on (`field.deposit`), ore density rises with depth below the natural surface: `oreDepthMultiplier(depth)` in `OreVeins.ts`, bands `ORE_DEPTH_MULTIPLIER_BANDS` (0-10 m x1.0, 10-20 x1.4, 20-35 x1.8, 35+ x2.2), each band reached by a smoothstep ramp of `ORE_DEPTH_BLEND_M` = 3 m starting at its boundary (so exactly 1.0 for 0-10 m, 1.4 from 13 to 20 m, 1.8 from 23 to 35 m, 2.2 from 38 m on; continuous, non-decreasing, negative depth = 1). Applied in `densitiesAt` only to voxels that already passed the `MIN_STORED_DENSITY` cut: `round(min(1, stored * mult) * 100) / 100`, skipped at mult 1, BEFORE the site grade scale, so depth pays at any grade scale. It never creates ore: the same voxels hold ore, only richer. Deposits off (campaign, legacy veins) are untouched. Ratio ceiling: the richest 5 m band of any biome must stay <= `SANDBOX_MAX_RICHNESS_RATIO` (10) x desert surface value per m3 (never raise the ceiling; lower a multiplier instead). Value per m3 (mean over depth bands 0-10, 10-20, 20-35, 35-55 m, seed 42) rises strictly in every biome. Content is sandbox-only, in `SandboxDeepOre.ts` (read by `OreVeinSampler` when deposits are on; the shared `RockCatalog`/`OreCatalog`, campaign levels and Level 1's contract ores are untouched): `SANDBOX_DEEP_ORE_AFFINITY` (one row per rock, each (rock, ore) value REPLACES the catalog host probability: cruite/sandite sparkium 0.22; molite craktonite 0.20, absurdium 0.38; grumpite sparkium 0.20; clunkite sparkium 0.12, craktonite 0.10, absurdium 0.50; obstiite sparkium 0, craktonite 0.06, absurdium 0.44; gnarlite sparkium 0.17; absurdite sparkium 0.15; titanite sparkium 0.08, absurdium 0.75) and `SANDBOX_ORE_DEPTH_WINDOWS` (craktonite 28-45 m, absurdium 30-55 m instead of 18-45 / 25-55, so deep bands out-earn mid bands and tier mean depth still rises with rarity). Rows only touch ores whose sandbox window starts at 15 m or deeper (sparkium 15, craktonite 28, absurdium 30), so 0-10 m ore is byte-identical to the catalog in every biome (guarded by a golden hash in OreVeins.test.ts). Biome traits (the sandbox panel's ore list) read `sandboxOresYieldedByRocks` / `sandboxOreWindow`; the sandbox contract board stays on the catalog ores (`resolveContractOres`), because offering deep ores the opening shot cannot reach starves the opening economy. Asserted by the sandbox-economy-balance integration test.

## Ore Grade Reporting Post-Blast

Post-blast report reads each fragment at its `origin` (never landing `position`): floor-keyed column via `surveyColumnKey`/`findSurveyForColumn`, and the survey's reading at the origin's **depth** via `oresSurveyedAt(survey, x, z, floor(origin.y))` in `SurveyColumn.ts`. A fragment at a depth the survey did not scan (past the method's `SURVEY_DEPTH_BELOW_SURFACE` window, more than one voxel above the surface anchor, a one-voxel cap whose top band holds no ore, or outside aerial's top 2 m) adds 0 estimate and its actual ore is left out of the `yieldRatio` numerator; `totalYieldKg` and `oreYields` stay all-inclusive; ratio is 1.0 when no fragment was scanned.

`SurveyResult.surfaceYs` (`"x,z"` -> anchorY the column was sampled from; every method, aerial included; every column holding ore in its window, even when the whole-window average rounds away) is the datum for depth: `depth = surfaceYs[key] - y`. `oresSurveyedAt` resolves it through `bandOresAtDepth` (band `fromM` inclusive, `toM` exclusive): `undefined` = unscanned, `{}` = scanned with no ore. Aerial has no profile, so it returns the column estimate inside its top window and `undefined` below. Legacy surveys without `depthProfile`/`surfaceYs` fall back to the whole-window column estimate. A column whose whole-window average rounds to 0 gets no `estimates` entry but still gets `surfaceYs` and a profile, so `findSurveyForColumn` covers it. The partial-density cap voxel one above the anchor reads as the top band. `identifyFragmentedVoxels(field, grid, false)` skips the cracked-rock weakening so the pre-blast estimate leaves the grid untouched.

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


Survey price: `surveyCostFor(method, modifiers, tick)` = `SURVEY_COSTS[method]` scaled by live `survey_cost` modifiers, rounded. `runSurvey` checks, charges and books that price and stores it as the action's `orderCost`, so cancelling refunds what was paid; console and Survey panel display the same scaled price.

History: docs/context-history/gameplay-survey-system.md
