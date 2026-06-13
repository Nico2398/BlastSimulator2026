# Verification Record — Issue #327: Tutorial Level Survey Yields

**Date:** 2026-06-13  
**Verifier:** Implementer (Green phase)  
**Status:** ✅ All requirements satisfied by existing code — no implementation changes needed.

---

## Test Requirements (from `pipeline/tests-327`)

### 1. Tutorial terrain (seed 42, desert, 24×12×24) has ore-bearing columns near (10,10)

- **Source:** `tests/unit/mining/TutorialSurvey.test.ts` — test #1
- **Requirement:** Generate terrain with `generateTerrain({ sizeX:24, sizeY:12, sizeZ:24, seed:42, preset: getMinePreset('desert') })` and verify at least one column in a 5×5 grid centred on (10,10) has a voxel with `oreDensities` containing at least one ore.
- **Existing API:**
  - `generateTerrain()` in `src/core/world/TerrainGen.ts` — accepts `TerrainConfig` with `sizeX`, `sizeY`, `sizeZ`, `seed`, `preset`
  - `getMinePreset('desert')` in `src/core/world/MineType.ts` — returns desert preset with `dominantRocks: ['cruite', 'sandite', 'molite']`
  - `VoxelGrid.getVoxel()` — returns `VoxelData` with `oreDensities` map
  - Desert rocks define ore probabilities (`oreProbabilities` in `RockCatalog.ts`)
  - `computeOreDensities()` in `TerrainGen.ts` uses 3D simplex noise to populate `oreDensities`
- **Verdict:** ✅ Already satisfied. No code changes needed.

### 2. Seismic survey at (10,10) returns non-empty estimates

- **Source:** `tests/unit/mining/TutorialSurvey.test.ts` — test #2
- **Requirement:** On the same terrain, call `estimateSurveyResult(terrain, { method: 'seismic', centerX:10, centerZ:10, skillLevel:3, ... }, new Random(42))` and verify at least one column estimate with at least one ore type is returned.
- **Existing API:**
  - `estimateSurveyResult()` in `src/core/mining/SurveyCalc.ts` — accepts `(VoxelGrid, EstimateSurveyParams, Random)`, returns `SurveyResult` with `estimates` map
  - `Random.gaussian()` in `src/core/math/Random.ts` — provides noise-scaled estimation
  - `SURVEY_COVERAGE_RADIUS.seismic = 20` — covers the (10,10) area
  - `SURVEY_BASE_ERROR.seismic = 0.15`, `SURVEY_SKILL_BONUS_PER_LEVEL = 0.12`
  - `SURVEY_SEISMIC_GROUP_SIZE = 3`
- **Verdict:** ✅ Already satisfied. No code changes needed.

---

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run` (all 145 test files) | ✅ 2741 tests passed |
| `npx tsc --noEmit` | ✅ No type errors |
| Test APIs present at expected signatures | ✅ Confirmed |
| No source code modifications required | ✅ Confirmed |

## Conclusion

The existing terrain generation and survey estimation code on this branch already satisfies all test requirements defined in `pipeline/tests-327`. No implementation changes are necessary.
