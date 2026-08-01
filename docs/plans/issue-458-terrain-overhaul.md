# Terrain Overhaul Plan — Issue #458

**Status:** Planning complete — ready for phased execution.
**Scope:** Terrain generation, dual world representation, chunked meshing, 3D procedural texturing, post-processing, living-world ambience, level scale-up, scenario audit. Buildings, vehicles, and characters are untouched.
**Executor note:** Tasks are ordered for dependency. Each task states its files, acceptance criteria, and verification channels. Visual tasks require screenshot inspection (open the PNG with the Read tool), not just a green suite. Do not batch visual verification to the end.

---

## 1. Research findings (current state)

Everything below was verified against the codebase at planning time. File:line references are load-bearing for the executor.

### 1.1 Generation (core)

- `src/core/world/TerrainGen.ts` — single 3-octave 2D simplex stack (`computeSurfaceHeight`, :69-92) with hardcoded frequencies (2/5/10) and amplitudes (0.6/0.3/0.1) on **grid-normalized** coordinates: a 400-wide grid gets the same number of hills as a 24-wide one, stretched. Elevation is a fraction of `sizeY`. No biomes, no structures, no erosion.
- Rock composition (`computeComposition`, :114-157) is a per-voxel 3D-noise blend on **absolute** coordinates (scale disagreement with the height field). No stratigraphy: `y` is treated identically to `x/z`; `levelBias` is a constant, not depth-dependent.
- Ore placement (:175-208) shares one 3D noise field for all ores, separated by an integer hash offset. The documented composition-coefficient weighting is not implemented.
- Seeding (:28-34): one `Random` (mulberry32) feeds three noise constructors **sequentially** — adding/reordering any noise field re-rolls all terrain for every seed. Fragile; must move to per-field sub-seeds.
- `density` is hardcoded 1.0 (binary solid/air).
- `MinePreset` (`src/core/world/MineType.ts`) has exactly 6 numeric knobs; `DistantScenery` keys themes off `preset.id`. `LevelDef.mixedRockHardness` (`Level.ts:38-42`) is **dead** — `TerrainGen` never receives a `LevelDef`.
- `isInBorderZone` (:160-167, `borderWidth: 5`) only suppresses ore — the sole existing notion of a margin.

### 1.2 Voxel storage

- `src/core/world/VoxelGrid.ts` — flat `VoxelData[]` of **JS objects**, eagerly allocated even for air (~3 heap objects/voxel, ~200-350 bytes each). 80×40×80 ≈ 75 MB. 300×100×300 ≈ 2.5 GB → OOM. **A typed-array rewrite is a hard prerequisite for larger grids.**
- No iterator API — 7+ consumers hand-roll triple loops. No serialization at all.
- Surface-Y scanning is duplicated in ~7 places with **two different thresholds** (`>= 0.5` vs `> 0`) and **two return conventions** (`y` vs `y+1`).
- Blast/nav/survey code keys voxels/cells with `"x,y,z"` **template-literal strings** in Sets/Maps — string allocation dominates at scale (`BlastCalc.ts:283-303`, `NavGridReachability.ts:130-148`, `Survey.ts:18`).

### 1.3 Events and renderer coupling

- `terrain:updated`, `blast:started`, `blast:ended`, `fragment:created`, `time:tick` are declared in `EventEmitter.ts:7-12` but **never emitted anywhere**. The architecture skill's "core emits, renderer subscribes" contract is aspirational.
- Actual mechanism: command-name string matching in `src/main.ts:164-174` (blast, build_ramp — **drill is missing**, so drilled voxels never remesh) plus grid object-identity comparison in `GameRenderer.ts:87-89`.
- Every blast rebuilds the full terrain mesh **twice** (`main.ts:166-168`).

### 1.4 Meshing and materials

- `src/renderer/TerrainMesh.ts` — hand-rolled marching cubes (tables in `MarchingCubesTables.ts`), `CHUNK_SIZE = 16` but chunking is cosmetic: all chunks append into one `positions[]`/`colors[]` pair → **one Mesh**. `update(dirtyPositions)` ignores its argument and calls `buildAll()` (:160-162). `BLAST_REMESH_RADIUS_CHUNKS` (`balance.ts:315`) is declared and never referenced.
- Emitted vertex attributes: `position` and `color` only. No index buffer (triangle soup → flat facets via `computeVertexNormals`). Composition coefficients, ore densities, hardness are read during meshing and discarded.
- `ProceduralTexture.ts` is a **CPU vertex-color generator** (3 seeded `createNoise3D`, per-rock tuning table, cache wiped every chunk). `FragmentMesh.ts` reuses `sampleRockColor` so fractured faces match terrain — any material migration must carry fragments along.
- **Zero custom GLSL in the repo.** No ShaderMaterial, no onBeforeCompile, no triplanar. All materials are Phong/Basic. No MeshStandardMaterial anywhere.
- `DistantScenery.ts` — prop ring at radius 220, ~60 per-prop materials, no instancing, no seed. At grids ≥ ~300 the mine would engulf the ring.

### 1.5 Rendering pipeline

- `SceneManager.ts` — `WebGLRenderer({ antialias: true })`, **no tonemapping set, no shadow maps anywhere in the repo, no EffectComposer anywhere**. 3 lights; the fill light is anonymous and unreachable. `Fog(SKY_COLOR, 800, 3000)` far-clip hack. Single `renderer.render()` at :91 is the composer insertion point; `gl.finish()` at :94 must stay **after** the final render for screenshot determinism. `onResize` (:108-115) must also size the composer.
- `SkyboxWeather.ts` — 7 weather states → sky color/sun/ambient lerp; `skyHigh` is populated but never read (no gradient sky). Rain = 1500 CPU-integrated points over an 80×80 box. **No clouds, no wind anywhere.** Built with raw `DataTexture` because **renderer classes are constructed under Node in unit tests** — no DOM/canvas/WebGL at construct time is a hard constraint for all new renderer code (`vitest` env is `node`; 16 renderer test files).
- Three.js **r165** pinned. `three/examples/jsm` is importable today, nothing imported yet. Available on disk: `EffectComposer`, `RenderPass`, `OutputPass`, `GTAOPass`, `SAOPass`, `SMAAPass`, `UnrealBloomPass`, `csm/CSM.js`, `objects/Sky.js`.
- r165 composer caveat: adding `EffectComposer` without `OutputPass` shifts all colors (linear render target); the hand-tuned palette will need recalibration once tonemapping lands.

### 1.6 Scale coupling (what breaks when grids grow)

| System | Blocker | Where |
|---|---|---|
| Camera | `ZOOM_MAX = 600` silently clamps framing above span ≈ 520 | `CameraController.ts:13`, `:262` |
| Camera | Initial pos hardcoded for 24³ tutorial; far plane 4000 | `SceneManager.ts:13-17` |
| Pathfinding | `PATHFINDING_NODE_BUDGET_CAP = 500` ≈ 22×22 neighbourhood, then falls back to direct-line | `balance.ts:318`, `Pathfinding.ts:467` |
| Reachability | Full-grid BFS with string keys on every hire/vehicle-buy/haul | `NavGridReachability.ts:130-148` |
| NavGrid | Full O(X·Y·Z) rebuild; `patchNavGrid` reuses stale `maxSurfaceY` | `NavGrid.ts:62-71`, `:139` |
| Physics | `TerrainBody` makes a static body **per column** (400² = 320k bodies) | `TerrainBody.ts:42-67` |
| Save | `navGrid` accidentally serialized (~75 B/cell; 400² ≈ 12 MB/slot) and `moveCost: Infinity` → `null` on load | `GameState.ts:124`, `NavGrid.ts:221-222` |
| Survey | Radius-20/30 discs sample full columns; results serialized per column | `SurveyCalc.ts:150-176` |
| Rest search | `NEED_REST_SEARCH_RADIUS = 20` absolute cells | `balance.ts:653` |
| UI | `TileSelectOverlay` fixed 640×480 canvas → 1.6 px tiles at 400; minimap redraws every cell per frame | `TileSelectOverlay.ts:57-58`, `miniMapLayers.ts:155-160` |
| Benchmarks | `buildNavGrid` < 100 ms @ 100×20×100; survey < 25 ms; blast pipeline < 50 ms | `tests/unit/benchmarks/benchmarks.test.ts` |

### 1.7 Save/load and determinism

- Save = plain `JSON.stringify(GameState)`. **The VoxelGrid is not saved** — regenerated pristine from seed on load, so blast craters, ramps, and drill holes are silently reverted (documented as "accepted" at `saveload.ts:12-14`). Issue #458 assumes volumetric saving ("as today") — this must actually be built. `SAVE_VERSION = 5` with migration hooks in `SaveLoad.ts:43-127`.
- Zero `Math.random()` in core (enforced). `new_game` default seed is `Date.now() % 100000` — only non-deterministic entry point. `simplex-noise` is caret-pinned (`^4.0.3`): pin exactly once terrain output becomes seed-pinned.

### 1.8 Tests and scenarios that will break by design

- `tutorial-terrain-coordinates.integration.test.ts:163-195` asserts the tutorial surface is **perfectly flat** (an accident of rounding on the 24×12×24 desert config).
- `world-commands.test.ts:45-57` pins surface heights for desert@64³ (`inspect 10,5,3` solid, `inspect 10,20,3` air).
- `Level.test.ts` pins the four seeds and grid dims; `MineType.test.ts` asserts preset-vs-generation statistics.
- **106 scenario defs, 82 with hardcoded coordinates** (mostly ≤ 25, max 45); none pass `size:` to `new_game`, so all inherit the 64³ default. 3 playtest defs pin `size:24` but are coordinate-free (tile-space picker, `tile-picker.ts:42-82`).
- Tutorial regions are hardcoded to the 24×24 map (`tutorialStages.ts:48-66`, `tutorialSteps.ts:81,167,199`).
- Weather: `WeatherCycle.ts` has 7 states, seeded, **no wind vector** in core.

---

## 2. Key software decisions

Each decision is final for execution unless a task hits a stated contradiction; record deviations in the PR description (default-and-record).

### D1 — Generator is 2D (layered heightfield), not 3D volumetric

One continuous, deterministic **column sampler** is the single source of truth for the whole world: `sampleColumn(worldX, worldZ) → { height, biome, climate params, rock profile(depth), structure mask }`.

**Rationale:** an open pit needs no generated overhangs or caves — all 3D complexity comes *after* generation, from blasting, which the voxel grid already handles. A 2D field makes playable/landscape agreement trivial (both zones evaluate the same function), keeps the landscape zone cheap (heightmaps are its native format), and is dramatically simpler to test. The playable voxel volume is derived from the sampler (D5); rock composition below the surface uses 3D noise seeded from the same sub-seed scheme, so cut faces still vary in 3D.
**Rejected:** 3D density-field generation — pays volumetric cost everywhere for benefits (caves, overhangs) the game design doesn't use.

### D2 — Noise fields get independent sub-seeds

Replace the sequential-draw seeding (`TerrainGen.ts:28-34`) with derived sub-seeds: `fieldSeed = hash(levelSeed, 'continentalness')` etc. (splitmix-style integer hash in `src/core/math/`). Adding or reordering fields no longer re-rolls the whole world.

### D3 — Layered generation model (Minecraft-style multi-noise)

Fields, all domain-warped where noted, all in **absolute world metres** (never grid-normalized — fixes the feature-size bug):

| Field | Type | Drives |
|---|---|---|
| `continentalness` | 2D FBM, low freq (~1/800 m), domain-warped | Macro elevation: plains vs highlands vs ranges |
| `erosion` | 2D FBM (~1/400 m) | Flattens or sharpens relief; valley width |
| `peaksValleys` | Ridged 2D (~1/150 m) | Local ridges, hills, gullies |
| `warp` | 2D vector FBM | Domain warp applied to the above (breaks up simplex blobbiness) |
| `temperature`, `humidity` | 2D FBM, very low freq | Biome selection (climate grid lookup) |
| `detail` | 2D FBM high freq | Metre-scale surface roughness |

Height = spline(continentalness, erosion, peaksValleys) per biome, plus detail. Splines are data (control points in the biome definition), not code. `flatness`-style site suitability: the playable zone applies a **pit-suitability mask** — inside the playable rect, relief is gently compressed toward a buildable band (lerp by a smoothstep margin), so gameplay stays viable regardless of biome drama outside.

### D4 — Biomes replace MinePresets

New `src/core/world/BiomeCatalog.ts`: `BiomeDef { id, nameKey, climate range (temp/humidity), height spline params, rock profile (depth-layered), surfacePalette (shader params), ore richness, structure densities (forest/river/village), gradeParams (post color grade), ambient params (cloud tint, bird density, …) }`.
Initial set (≥ 6): `desert_badlands`, `red_canyon`, `alpine_granite`, `green_foothills`, `tropical_karst`, `volcanic_flats`. Campaign levels each pin a **climate override** so their playable zone lands in the intended biome (tutorial → desert_badlands, etc.); the landscape around them blends into neighbouring biomes naturally via the climate fields.
`MineType.ts` is deleted; `LevelDef.mineType` becomes `LevelDef.biome`. `mixedRockHardness` finally wired: it toggles a rock-profile variant interleaving tier-1 and tier-5 layers.
i18n: every biome name/desc gets keys in `en.json` **and** `fr.json`.

### D5 — Rock profile becomes depth-stratified

`computeComposition` is replaced by per-biome **strata**: an ordered list of layers (topsoil → overburden → bedded rock → basement), each layer a rock blend with thickness driven by noise, tilted/warped by a low-freq field for dip. 3D composition noise perturbs layer boundaries so blast cross-sections look geological, not banded. Ore veins: per-ore sub-seeded 3D ridged noise **elongated along strike** (anisotropic frequency), weighted by host-rock affinity and depth window — replaces the shared-field hash-offset scheme. `RockCatalog`/`OreCatalog` keep their gameplay stats; each rock gains shader-facing visual params (see D9).

### D6 — VoxelGrid rewritten as SoA typed arrays with a composition palette

New internal layout (public API preserved where cheap, hot paths migrated):

- `density: Uint8Array` (0/255 today; room for fractional later)
- `compositionId: Uint16Array` — index into a **palette** of deduped `VoxelRockComposition` objects (quantized coefficients dedupe massively across strata)
- `fractureModifier: Uint8Array` (quantized 0-1)
- `oreDensities`: sparse `Map<int packedIndex, Record<oreId, number>>` — only ore-bearing voxels pay

Kept: `getVoxel(x,y,z)` as a **compatibility view** for low-frequency callers (survey inspect, console). Added: direct field accessors (`densityAt`, `dominantRockAt`, `compositionAt`, `oreAt`), a region iterator, and `forEachSolid`. Hot paths (TerrainGen fill, TerrainMesh march, BlastCalc, NavGrid) move to direct accessors and **integer-packed keys** (`x + y*sx + z*sx*sy`) instead of `"x,y,z"` strings.
Budget: ~5-8 bytes/voxel → 160×64×160 = 1.64 M voxels ≈ **12 MB** (vs ~500 MB in the old layout).
Consolidate the 7 surface-Y scans into `computeVoxelColumnSurfaceY` + one documented convention (threshold ≥ 0.5, returns top solid y, −1 if void); delete the `src/core/config/RockCatalog.ts` re-export shim.

### D7 — Landscape zone: core-owned tiled heightmaps

New `src/core/world/LandscapeMap.ts`: tiles of `Float32Array` heights + `Uint8Array` biomeId + `Uint16Array` compositionId (surface rock), sampled from the same `sampleColumn`. Parameters (defaults, executor may tune with recorded reasoning):

- Landscape half-extent: **1600 m** from playable centre (world reads vast at every level size).
- Tile: 128×128 samples at **4 m** resolution (512 m square), ~7×7 tiles. ≈ 800 k samples total, ~5 MB.
- Playable rect is carved out of the tile set; tiles adjacent to it add a skirt ring at **1 m** resolution so geometric detail matches the marching-cubes zone near the boundary.

Boundary agreement is guaranteed by construction (same sampler) and locked by test: for a ring of positions inside/outside the boundary, playable surface Y and landscape height agree within the voxelization quantum (±0.5), and biome/rock ids match exactly. Purely aesthetic: no navmesh, no interaction, never enters `GameState` simulation fields.

### D8 — Save format v6: playable voxels serialized, landscape from seed, navGrid excluded

- **Playable zone:** serialize `density` + `compositionId` + palette + sparse ores + `fractureModifier` with RLE over the flat arrays, base64 into the save JSON. Fixes the standing "craters revert on load" flaw, which #458's dual-representation contract requires anyway. Estimated ≈ 100-600 KB/slot at the new sizes (RLE collapses air and uniform strata).
- **Landscape:** *not* stored — regenerated from seed on load (deterministic by D1/D2, cheap: ~800 k samples). This satisfies the issue's "cheaper to store" intent better than storing; the "saved as heightmaps" wording is honoured by the on-disk *format* being heightmap-shaped whenever it is cached, and the decision is recorded here for review.
- **navGrid:** excluded from serialization (fixing the `Infinity → null` corruption) and rebuilt on load — it is derived state.
- `SAVE_VERSION = 6` migration: v5 saves load with `gridReady: false` → regenerate from seed (legacy behaviour, mutations lost once, acceptable and recorded).

### D9 — One shared terrain material: `MeshStandardMaterial` + `onBeforeCompile` triplanar GLSL

New `src/renderer/terrain/TerrainMaterial.ts` used by **playable chunks, landscape tiles, and fragments**:

- Base: `MeshStandardMaterial` (needed for sane results under ACES tonemapping and AO; Phong is retired for terrain).
- `onBeforeCompile` injects: triplanar projection in world space driven by **hand-written GLSL 3D value-noise/FBM** (no textures, no bitmaps — satisfies the Node-test constraint since no DOM is touched at construct time and shader strings compile lazily at first render).
- Per-vertex attributes emitted by both meshers: `aRockA`, `aRockB` (rock palette indices), `aRockWeight` (blend), `aOre` (dominant ore id + grade, for subtle sparkle/tint on rich voxels). Rock visual params (base albedo, macro/detail scales, vein color/strength, roughness) live in a **uniform array indexed by rock id**, populated from `RockCatalog` visual params.
- The same chunk implements: **boundary shading band** (analytic distance to the playable XZ rect → narrow darkening ramp, ~4 m, uniform-controlled), **cloud shadows** (samples the same FBM that drives the cloud layer, scrolled by the wind uniform), and **wind-time uniforms** shared with vegetation.
- Flat-faceted silhouette is **kept** for the playable zone (triangle soup, no index) — it is part of the cartoon identity; the landscape mesh uses smooth normals from the heightmap for calm distant surfaces. Triplanar detail supplies close-range richness on both.
- `ProceduralTexture.ts` is deleted; `FragmentMesh` migrates to `TerrainMaterial` with per-instance rock attributes.

### D10 — Chunked, event-driven remeshing

- `TerrainMesh` becomes a chunk manager: one `BufferGeometry`+`Mesh` per 16³ chunk, marching only its own cells (1-voxel overlap read for seams, as today).
- Core emits `terrain:updated` with a payload — `GameEventMap` change: `'terrain:updated': { region: { minX, minY, minZ, maxX, maxY, maxZ } }` — from **all** mutators: blast clear/crack passes, crater pass, `drillHole`, `buildRamp`, and full regeneration (whole-grid region).
- Renderer subscribes and re-marches only chunks intersecting the region. The `main.ts:164-174` command-name string matching and the double rebuild are deleted; the missing-drill-remesh bug dies with them. NavGrid patching keys off the same event (and `patchNavGrid` recomputes `maxSurfaceY` over the patch instead of trusting the stale value).
- `BLAST_REMESH_RADIUS_CHUNKS` is deleted (region payload supersedes it).

### D11 — Post-processing stack (three/examples/jsm, no new dependencies)

Composer order: `RenderPass → GTAOPass → AerialPerspectivePass (custom) → UnrealBloomPass (low strength, threshold high) → OutputPass → SMAAPass`.

- **Tonemapping:** `renderer.toneMapping = ACESFilmicToneMapping` handled through `OutputPass`; exposure tuned during the art pass. Every existing color (sky, lights, UI-adjacent meshes) gets recalibrated once — budget a dedicated task, this is known breakage.
- **AO:** `GTAOPass` (present in r165). Half-resolution if needed later, but per the issue: no preemptive optimisation.
- **Aerial perspective:** custom full-screen pass reading depth: distance + **height-aware** density (thicker in valleys), desaturating and lerping toward a per-biome haze color. Replaces `THREE.Fog` (deleted from `SceneManager`). Per-biome grade (lift/gamma/gain + tint) folded into this pass as uniforms fed from the level's biome.
- **AA:** SMAA pass (MSAA is lost behind the composer's render target).
- **Shadows:** `three/examples/jsm/csm/CSM.js`, 3 cascades fitted to the camera over the new world scale; `shadowMap.enabled = true`, PCFSoft. The anonymous fill light becomes a named, weather-modulated field.
- Wiring: composer created in `SceneManager`; `composer.render()` replaces `renderer.render()` at `SceneManager.ts:91` with `gl.finish()` kept after it; `onResize` calls `composer.setSize` and re-applies DPR.
- Headless constraint: `SceneManager` is not constructed in unit tests today (only sub-renderers are) — keep it that way; all new pass wiring stays inside `SceneManager`/new modules that unit tests don't instantiate, and new sub-renderers stay DOM-free at construct time.

### D12 — Wind and ambient life are renderer-only, seeded, weather-driven

- New `src/renderer/ambient/WindState.ts`: single global wind vector (direction + strength), derived from core `WeatherCycleState.current` (target strength per state: storm 1.0 → sunny 0.15) with seeded smooth drift (level seed). Core is untouched — satisfies core-purity and the issue's "purely cosmetic" rule.
- New `src/renderer/ambient/` modules, all reading `WindState` and the level seed, all instanced/billboard/shader-driven, density falling off with distance:
  - `CloudLayer` — instanced chunky cloud clusters (merged low-poly puffs), drifting with wind; the **same FBM + scroll offset** feeds the terrain material's cloud-shadow term so shadows and clouds cannot desync. Integrates with `SkyboxWeather` (cloud coverage/darkness lerped per weather state; rain states → denser, darker layer). `skyHigh` finally used: gradient sky via a large inverted dome with a two-stop gradient shader.
  - `BirdFlocks` — one InstancedMesh, flocks on seeded closed curves; a blast (`blast:started` event, now actually emitted) scatters nearby flocks for a few seconds.
  - `ChimneySmoke` — billboard puff emitters at village chimneys (positions from LandscapeMap structure data), wind-bent.
  - `VegetationSway` — forest trees as InstancedMesh with shader vertex sway (wind uniform); grass patches as star-billboards near the playable rim.
  - `WaterSurface` — river/lake polygons from structure data, scrolling procedural normals, foam sparkle at banks; slow drift with wind.
  - Per-biome extras (pick ≥ 2 in execution): dust devils (desert), fireflies (tropical dusk), falling leaves (foothills), snow glint (alpine).
- `DistantScenery.ts` is deleted; its role is fully replaced by the landscape zone + structures + ambient layer. `FragmentMesh` remains the instancing reference pattern.

### D13 — Level sizes and camera

| Level | Grid (X×Y×Z) | Rationale |
|---|---|---|
| `tutorial_pit` | 32×20×32 | Small on purpose; guided placements re-authored; playtests keep working via tile-space picker |
| `dusty_hollow` | 96×40×96 | First real pit: 3-4 benches at bench height 5 |
| `grumpstone_ridge` | 128×56×128 | Mountain terrain needs headroom |
| `treranium_depths` | 160×64×160 | Flagship: deep multi-bench pit with room to spare |

- `new_game` default stays **64** (cubic) — it is the scenario-suite substrate; churn is contained (§1.8 heights still shift with the new generator). `new_game` gains optional `sizeY:` to break cubic when needed.
- Camera: `ZOOM_MAX` → 1200; far plane → 6000 with the aerial pass hiding the clip; `frameSite` unchanged logic-wise (works once un-clamped); initial hardcoded position replaced by frame-on-grid at boot; pan gets a soft leash to the playable rect ± margin (landscape is viewable, not the play focus).
- Fixed alongside: `RAIN_AREA` scales with viewport distance; minimap and `TileSelectOverlay` render playable rect only, with the overlay canvas sized to keep tiles ≥ 4 px (scroll/zoom at the two largest levels if required — record whichever is chosen).

### D14 — Pathfinding and physics survive the new sizes (correctness-at-scale only)

- `PATHFINDING_NODE_BUDGET_CAP` scales: `max(500, gridX * gridZ / 8)`; A* visited/open sets move to integer keys + typed arrays. No HPA*/hierarchical work — at 160² these bounds hold (record: revisit only if measured).
- `NavGridReachability` flood fills move to `Uint8Array` visited + int queue.
- `NEED_REST_SEARCH_RADIUS` scales with grid (`max(20, gridX/4)`).
- `TerrainBody` builds colliders **only within the blast AABB + margin** (physics runs only during blasts; 320 k static bodies never exist).
- Benchmarks updated to the new sizes with proportionate budgets — they gate regressions, not dreams.

### D15 — Scenario and tutorial migration strategy

- Scenario defs keep `new_game seed:42` @ 64³; the audit (final phase) fixes assertions that pinned old generator output (surface heights, rock at a coordinate, flat-tutorial assumptions). Coordinates ≤ 45 stay valid on 64³.
- The flat-tutorial integration test is rewritten to assert what the tutorial actually needs (a buildable, low-relief start region — via the D3 pit-suitability mask — not literal flatness).
- Tutorial guided regions (`tutorialStages.ts`, `tutorialSteps.ts`) re-authored for 32×32; playtest defs update `size:` and re-verify through the playability channel.

---

## 3. Execution phases and tasks

Verification-channel key: `S` static, `L` logic, `Sc` scenario, `V` visual, `P` playability.
**Every task's algorithmic detail lives in §7 — consult the mapping table in §7.0 before starting a task. Do not invent formulas, constants, or formats that §7 already fixes.**

### Phase 0 — Foundations (no visual change)

**T0.1 — VoxelGrid SoA rewrite (D6).**
Files: `src/core/world/VoxelGrid.ts`, all direct consumers (`TerrainGen`, `BlastCalc`, `BlastExecution`, `NavGrid`, `SurveyCalc`, `BuildingPlacement`, `DrillPlan`, `Ramp`, `WeatherEffects`, `TerrainBody`, `TerrainMesh`, `GameRenderer`, console `world.ts`), `tests/unit/world/VoxelGrid.test.ts`.
Work: typed-array SoA + palette + sparse ores; compatibility `getVoxel` view; direct accessors + iterators; surface-Y consolidation (one function, one convention — fix the `y`/`y+1` callers deliberately); integer voxel keys in blast/nav/survey hot paths; delete config shim.
Accept: full suite green; benchmarks at current sizes improve or hold; heap for 80×40×80 grid < 30 MB (add a memory assertion is not required — verify manually once).
Channels: S, L, Sc.

**T0.2 — Terrain events wired (D10 core half).**
Files: `EventEmitter.ts` (payload type), all six mutators, `main.ts` (delete string matching), `GameRenderer.ts`, `NavGrid` patch path.
Work: emit `terrain:updated {region}` from every mutator; emit `blast:started`/`blast:ended`/`fragment:created` where the pipeline already knows; renderer + navgrid subscribe; `patchNavGrid` recomputes patch-local `maxSurfaceY`; drill now triggers remesh.
Accept: blast/drill/ramp each produce exactly one region-scoped update; unit test asserts emission per mutator.
Channels: S, L, Sc, V (one screenshot: post-blast crater renders after a drill+blast sequence).

**T0.3 — Save v6 (D8).**
Files: `SaveLoad.ts`, `GameState.ts`, `VoxelGrid` (RLE encode/decode), persistence backends untouched.
Work: RLE voxel serialization; navGrid excluded + rebuilt on load; v5 migration; version bump.
Accept: save → blast → save → load round-trips the crater; v5 fixture loads; save size at 64³ post-blast < 1 MB.
Channels: S, L, Sc.

### Phase 1 — Unified generator (core, no renderer work)

**T1.1 — World sampler + layered fields (D1-D3).**
Files: new `src/core/world/WorldGen.ts` (+ `NoiseFields.ts`, `HeightSpline.ts`), new `src/core/math/Hash.ts`, rewrite `TerrainGen.ts` as the voxel-fill consumer of the sampler.
Work: sub-seeded fields, domain warp, spline-composed height in absolute metres, pit-suitability mask over the playable rect, deterministic across calls/order.
Accept: same seed → identical sampled transects; different sub-fields independent (perturbing one field's seed leaves others' output unchanged); pit mask keeps playable relief within the buildable band; feature wavelengths independent of grid size (test two grid sizes, same seed, same world coordinates → same heights).
Channels: S, L. Plus a **data inspection**: dump a 512×512 height/biome PNG via a script (`scripts/` — allowed to use node canvas-free PNG writer or PPM) and eyeball it before proceeding.

**T1.2 — BiomeCatalog + level wiring (D4).**
Files: new `BiomeCatalog.ts`, delete `MineType.ts`, `Level.ts` (biome + climate override + `mixedRockHardness` wiring), `campaign.ts`, `world.ts` (`new_game biome:` arg), i18n `en.json`/`fr.json`, tests.
Accept: ≥ 6 biomes; each campaign level lands in its intended biome inside the playable rect; climate fields blend biomes in the landscape; i18n parity check green.
Channels: S, L, Sc.

**T1.3 — Stratified rock + ore veins (D5).**
Files: `WorldGen.ts` strata module, `RockCatalog.ts` (visual + strata params), ore vein generator, tests.
Accept: vertical cross-section shows ordered strata with warped boundaries; `mixedRockHardness` produces interleaved tiers on level 4; veins elongated and depth-windowed; ore stats within sane bands per biome richness.
Channels: S, L. Data inspection: cross-section dump.

**T1.4 — Natural structures (core).**
Files: new `src/core/world/Structures.ts` (+ river tracer, settlement placer), `WorldGen` integration, `LandscapeMap` structure channels.
Work: rivers (downhill-traced on the coarse height field, carving the sampler's output), mountain range alignment (continentalness ridges), forests (density noise + seeded blue-noise points), villages (suitability: low slope, near water, **strictly outside playable rect** — invariant test), ≥ 2 inventive landmarks per world (e.g. mesa, crater lake, stone arch — executor's pick, recorded).
Accept: invariant test — 1000 seeds × village positions ∩ playable rect = ∅; rivers monotonically descend; determinism per seed.
Channels: S, L.

### Phase 2 — Dual representation (core)

**T2.1 — Playable volume + landscape tiles from one sampler (D7).**
Files: `TerrainGen.ts` (fill from sampler), new `LandscapeMap.ts`, `GameState`/context wiring (landscape handle lives beside `grid` in `GameContext`, not in serialized state), `regenerateGrid` funnel.
Accept: boundary agreement test (ring sampling, ±0.5 height, exact biome/rock match); landscape tiles deterministic; generation time for level 4 sizes < 5 s in Node (guideline, measure and record).
Channels: S, L, Sc.

### Phase 3 — Meshing (renderer)

**T3.1 — Chunked TerrainMesh (D10 renderer half).**
Files: `TerrainMesh.ts` (chunk manager), `GameRenderer.ts`.
Work: per-chunk meshes, dirty-set driven by `terrain:updated`, new vertex attributes (`aRockA/B/Weight`, `aOre`) alongside `position` (colors dropped once D9 lands — keep temporarily for continuity), delete `BLAST_REMESH_RADIUS_CHUNKS`.
Accept: unit test — blast region touching 2 chunks re-marches exactly those (+halo) chunks; full rebuild only on grid identity change; screenshot parity with pre-change look (still vertex colors at this stage).
Channels: S, L, V.

**T3.2 — Landscape mesher.**
Files: new `src/renderer/terrain/LandscapeMesh.ts`; delete `DistantScenery.ts`.
Work: tile meshes from `LandscapeMap` (indexed grids, smooth normals, 1 m skirt ring near playable), same interim material.
Accept: screenshots from 4 compass angles at the boundary — no gap/cliff/discontinuity visible; horizon filled at gameplay zoom and max zoom.
Channels: S, V (inspect each PNG).

### Phase 4 — Materials

**T4.1 — TerrainMaterial: triplanar 3D procedural texturing (D9).**
Files: new `src/renderer/terrain/TerrainMaterial.ts` (+ GLSL chunk strings), `TerrainMesh.ts`, `LandscapeMesh.ts`, `FragmentMesh.ts`; delete `ProceduralTexture.ts`.
Work: as D9 — triplanar FBM detail, rock uniform table, ore sparkle, boundary-band + cloud-shadow + wind hooks (bands/clouds inert until their phases).
Accept: **visual milestone.** Close-range screenshot shows crisp procedural rock detail (no vertex smear); each of the 10 rocks distinguishable in a survey line-up shot; fresh blast cut faces textured correctly (screenshot before/after blast); landscape and playable zone read as one material.
Channels: S, L (material constructs under Node), V — multiple inspected screenshots at close/mid/far.

### Phase 5 — Post-processing and atmosphere

**T5.1 — Composer + tonemapping + AO + AA + shadows (D11).**
Files: `SceneManager.ts`, new `src/renderer/post/PostPipeline.ts`, light rig rework.
Work: composer wiring (render → GTAO → bloom → OutputPass → SMAA), ACES + exposure, CSM shadows, named fill light, delete `THREE.Fog`.
Accept: screenshots before/after inspected; benches and pit walls show contact darkening; silhouettes stop crawling (compare stills); nothing black-crushed or washed out; screenshot pipeline still deterministic (`gl.finish` after final composer render).
Channels: S, V (several inspect-and-tune cycles are expected — budget them).

**T5.2 — Aerial perspective + per-biome grade (D11).**
Files: `post/AerialPerspectivePass.ts`, biome grade uniforms.
Accept: distant ranges visibly desaturate/haze with depth and altitude; valleys haze thicker than peaks; world beyond boundary stays bright; per-level grade visibly distinct across the 4 levels (4 screenshots compared side by side).
Channels: S, V.

**T5.3 — Boundary shading band (D9), tuned against the finished stack.**
Accept: band legible in screenshots under every weather state and at all 4 levels; landscape beyond it not globally darkened; a colleague-shot test — from a screenshot alone, the playable rect is identifiable.
Channels: V.

### Phase 6 — Scale-up

**T6.1 — Level sizes, camera, UI scale (D13).**
Files: `Level.ts`, `CameraController.ts`, `SceneManager.ts`, `SkyboxWeather.ts` (rain area), `MiniMap`/`TileSelectOverlay`, `tutorialStages.ts`, `tutorialSteps.ts`, playtest defs.
Accept: each level frames fully at boot; a 4-bench pit is diggable on level 2 (scenario proving bench count); tile picker clicks land on intended tiles at all sizes; tutorial completes via playtest.
Channels: S, L, Sc, V, **P** (tutorial playtest is mandatory here).

**T6.2 — Pathfinding/physics/benchmarks at scale (D14).**
Files: `balance.ts`, `Pathfinding.ts`, `NavGridReachability.ts`, `TerrainBody.ts`, benchmarks.
Accept: cross-map route on 160² grid found without direct-line fallback; hire/buy on level 4 without visible stall (benchmark bound); blast on level 4 completes within benchmark budget; updated benchmarks green.
Channels: S, L, Sc.

### Phase 7 — Living world

**T7.1 — Wind + clouds + cloud shadows (D12).**
Files: `ambient/WindState.ts`, `ambient/CloudLayer.ts`, `SkyboxWeather.ts` (integration + gradient sky), `TerrainMaterial` shadow term.
Accept: animation-frame capture (`npm run scenario -- --frames 8 --interval 500`) shows clouds drifting and shadow patches sweeping coherently with them; weather transition sunny→storm thickens/darkens the layer; frames inspected.
Channels: S, L (WindState pure math testable), V (frame sequences).

**T7.2 — Birds, smoke, water, vegetation sway (D12).**
Accept: frame captures show flock motion, smoke bending with wind, river scroll, tree sway — all responding to the **same** wind direction; blast scatters nearby flocks (scenario with frames around a blast); density visibly falls off with distance.
Channels: S, V.

**T7.3 — Per-biome ambient extras (≥ 2, executor's pick, recorded).**
Channels: V.

### Phase 8 — Art pass

**T8.1 — Iterative look development.** Lighting, exposure, grade, band, cloud tint, material palettes. Loop: screenshot (4 levels × 3 zooms × 2 weather states) → Read/inspect each → adjust → repeat until the §"bar" of #458 is honestly met. Not a formality — expect many cycles; keep a short log of what changed per cycle in the PR.
Channels: V (primary), P (one full tutorial run at the end to confirm readability didn't regress).

### Phase 9 — Suite migration

**T9.1 — Scenario audit (D15).** All 106 defs: run, triage failures into (a) coordinate/size assumptions, (b) generator-output pins, (c) real regressions — fix (a)/(b), treat (c) as bugs. Update `world-commands`, `tutorial-terrain-coordinates` (rewritten per D15), `Level`, `MineType`→`BiomeCatalog` tests.
Accept: `npm run scenarios` fully green; `npm run playtest` green; `npm run validate` green.
Channels: S, L, Sc, V, P — full gate, stated per channel in the final report.

---

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tonemapping recalibrates every existing color (buildings/vehicles/UI meshes suddenly look wrong) | T5.1 explicitly budgets palette recalibration; before/after screenshots on entity-heavy scenes; out-of-scope meshes may get exposure-compensating material tweaks only (no restyle) |
| Renderer classes constructed under Node break on DOM/WebGL usage | Hard rule restated per task: no canvas/document at construct time; DataTexture/shader-string patterns only; run `npm run test` after every renderer task |
| Seed-pinned tests break in cascades | Phases 1-2 land with their own tests first; suite audit is a dedicated final phase; do not chase scenario failures mid-phase |
| Marching a 160×64×160 grid at load stalls | Chunked build already amortizable; if load time measured > ~3 s, spread chunk builds across frames (recorded fallback, not preemptive) |
| GTAO/CSM cost on large scenes | Issue's stance: measure first. LOD rings for landscape are the sanctioned fallback; half-res AO second |
| Save size balloons | RLE + palette measured at T0.3; if > 2 MB/slot at level 4, add per-chunk dirty-only serialization (record) |
| Boundary band vs haze fighting | T5.3 exists solely to tune band-after-post; acceptance includes per-weather screenshots |
| `simplex-noise` caret drift re-rolls worlds | Pin exact version in T1.1 |

## 5. Explicitly out of scope

Building/vehicle/character restyling; gameplay balance changes beyond what scale forces (rest radius, path budget); audio; DoF (discouraged by issue — not used); WebGPU; LOD systems unless a measured problem triggers the sanctioned fallback.

## 6. Defaulted decisions to surface in the PR

D7 tile/extent numbers, D8 landscape-regenerated-not-stored, D13 exact level sizes and tile-overlay approach, T1.4 landmark picks, T7.3 ambient extras, §7 default constants — all chosen by this plan or the executor under default-and-record; list them in the PR description for human review.

---

## 7. Algorithm specifications

These are prescriptive. Where a constant is given, use it as the starting value; tune only in the art pass (Phase 8) or where a task's acceptance criteria demand it, and record every change. Pseudocode is TypeScript-shaped; GLSL is literal.

### 7.0 Task → spec mapping

| Task | Specs |
|---|---|
| T0.1 | A7 (SoA grid), A8 (palette), A22 (integer keys) |
| T0.2 | A9 (event payload + emission points) |
| T0.3 | A10 (RLE save format) |
| T1.1 | A1 (hash/sub-seeds), A2 (FBM fields), A3 (domain warp), A4 (height composition + splines + vertical datum), A5 (pit mask) |
| T1.2 | A6 (biome selection + blending) |
| T1.3 | A11 (strata), A12 (ore veins) |
| T1.4 | A13 (structure overlay architecture), A14 (rivers), A15 (forests/villages/landmarks) |
| T2.1 | A16 (landscape tiles + seam rule) |
| T3.1 | A17 (chunked remesh + dirty-set math), A18 (vertex attributes) |
| T3.2 | A16 |
| T4.1 | A19 (terrain shader: noise GLSL, albedo, band, cloud shadow, injection points) |
| T5.1 | A20 (composer wiring, CSM) |
| T5.2 | A21 (aerial perspective + grade shader) |
| T5.3 | A19.4 (band function — tuning only) |
| T6.2 | A22 (typed-array A*/BFS), A23 (TerrainBody scoping) |
| T7.1 | A24 (WindState), A25 (clouds + cloud shadows) |
| T7.2 | A26 (birds, smoke, water, sway) |

### A1 — Hash and sub-seed derivation

New `src/core/math/Hash.ts`:

```ts
/** 32-bit avalanche hash (lowbias32). Deterministic, fast, well distributed. */
export function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
/** Combine a seed with a string label into a derived sub-seed. */
export function subSeed(seed: number, label: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) h = hash32(h ^ label.charCodeAt(i));
  return h;
}
/** 2D cell hash for jittered-grid placement. Returns [0,1). */
export function cellRand(seed: number, cx: number, cz: number, salt: number): number {
  return hash32(seed ^ Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca77) ^ salt) / 4294967296;
}
```

Every noise field is constructed as `createNoise2D(() => rng.next())` with `rng = new Random(subSeed(levelSeed, fieldLabel))`. One `Random` per field, never shared. Field labels are the exact strings in the A2 table — changing a label is a world-breaking change.

### A2 — Noise fields (FBM)

```ts
/** Fractal Brownian motion over a simplex-noise 2D field. Output ~[-1, 1]. */
function fbm2(noise: NoiseFunction2D, x: number, z: number, octaves: number,
              baseFreq: number, gain = 0.5, lacunarity = 2.0): number {
  let sum = 0, amp = 1, freq = baseFreq, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}
/** Ridged variant: sharp crests. Output [0, 1]. */
function ridged2(noise: NoiseFunction2D, x, z, octaves, baseFreq, gain = 0.5): number {
  let sum = 0, amp = 1, freq = baseFreq, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * freq, z * freq)); // [0,1], crest at noise==0
    sum += amp * n * n;
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}
```

Field table — **coordinates are always absolute world metres** (`worldX`, `worldZ`), never normalized by grid size:

| Label | Kind | baseFreq | Octaves | Warped (A3)? | Range | Drives |
|---|---|---|---|---|---|---|
| `continentalness` | fbm2 | 1/800 | 4 | yes | [-1,1] | macro elevation |
| `erosion` | fbm2 | 1/400 | 4 | yes | [-1,1] | relief multiplier |
| `peaksValleys` | ridged2 | 1/150 | 5 | yes | [0,1] | ridges/hills |
| `warpX` | fbm2 | 1/600 | 3 | no | [-1,1] | domain warp X |
| `warpZ` | fbm2 | 1/600 | 3 | no | [-1,1] | domain warp Z |
| `temperature` | fbm2 | 1/1200 | 3 | no | [-1,1] | biome climate |
| `humidity` | fbm2 | 1/1100 | 3 | no | [-1,1] | biome climate |
| `detail` | fbm2 | 1/24 | 3 | no | [-1,1] | metre-scale roughness |
| `forest` | fbm2 | 1/90 | 3 | no | [-1,1] | forest density |
| `riverSpring` | fbm2 | 1/300 | 2 | no | [-1,1] | spring candidacy |

### A3 — Domain warp

Applied to `continentalness`, `erosion`, `peaksValleys` only:

```ts
const WARP_AMPLITUDE = 120; // metres
const wx = x + WARP_AMPLITUDE * fbm2(warpXNoise, x, z, 3, 1 / 600);
const wz = z + WARP_AMPLITUDE * fbm2(warpZNoise, x, z, 3, 1 / 600);
// then e.g. continentalness = fbm2(contNoise, wx, wz, 4, 1/800)
```

### A4 — Height composition, splines, vertical datum

**Spline evaluation** — piecewise linear over sorted control points, clamped at both ends:

```ts
type Spline = ReadonlyArray<readonly [input: number, output: number]>;
function evalSpline(s: Spline, t: number): number {
  if (t <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const [t0, v0] = s[i - 1], [t1, v1] = s[i];
      return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
    }
  }
  return s[s.length - 1][1];
}
```

**Base splines** (biomes may override, see A6; these are the neutral defaults). Heights in world metres; sea level = 0:

```ts
const BASE_SPLINE: Spline    = [[-1, -10], [-0.4, 1], [0, 8], [0.4, 22], [0.7, 45], [1, 90]];   // continentalness → base height
const RELIEF_SPLINE: Spline  = [[-1, 1.4], [-0.3, 1.0], [0.2, 0.55], [0.7, 0.25], [1, 0.12]];   // erosion → relief multiplier
```

**Height formula** (before structures, before pit mask):

```
c = continentalness(x, z)         // warped
e = erosion(x, z)                 // warped
pv = peaksValleys(x, z)           // warped, [0,1]
base   = evalSpline(biome.baseSpline, c)
relief = evalSpline(biome.reliefSpline, e)
h = base + relief * biome.pvAmplitude * (pv - 0.35)    // pvAmplitude default 55 m
  + 1.2 * detail(x, z)
```

`(pv - 0.35)` re-centres ridged noise so valleys can dip below `base`.

**Vertical datum (world metres → voxel y).** Computed once at generation, stored on the grid/landscape metadata and reused by the renderer:

```
hCenter = h(playableCenterX, playableCenterZ)            // after pit mask, before structures
groundOffset = floor(sizeY * 0.55) - Math.round(hCenter) // pit gets ~55% of sizeY as digging headroom below start surface
surfaceYvox(x, z) = clamp(Math.round(h(x, z) + groundOffset), 1, sizeY - 1)
```

The landscape renders at `y = h + groundOffset` (float, no rounding) so elevations line up with the voxelized surface within ±0.5 — exactly the tolerance the boundary agreement test allows.

### A5 — Pit-suitability mask

Compresses relief inside the playable rect toward buildable terrain. Applied to `h` before structures:

```ts
const PIT_MASK_MARGIN = 24;      // metres of blend, measured inward from the playable edge
const PIT_RELIEF_KEEP = 0.3;     // 30% of the original relief survives at full compression
// dIn = distance from (x,z) to the nearest playable-rect edge, measured inward; negative outside.
const w = smoothstep(0, PIT_MASK_MARGIN, dIn);            // 0 at edge, 1 deep inside
const hRef = h(centerX, centerZ);                          // single sample, deterministic
hMasked = lerp(h, hRef + (h - hRef) * PIT_RELIEF_KEEP, w);
```

`smoothstep(a, b, t) = s*s*(3-2*s)` with `s = clamp((t-a)/(b-a), 0, 1)` — add to `src/core/math/` if absent. Outside the rect `w = 0`: the landscape is untouched and continuous with the compressed interior through the 24 m blend band.

### A6 — Biome selection and blending

Climate space is `(temperature, humidity) ∈ [-1,1]²`. Each `BiomeDef` carries `climateCenter: [t, h]` and `climateRadius` (default 0.55). Per column:

```ts
// 1. Level climate override: bias climate inside/near the playable rect so the level lands in its intended biome.
//    fade = smoothstep over 300 m outward from the playable rect edge (1 inside → 0 at 300 m out)
t = clamp(tRaw + level.climateBias[0] * fade, -1, 1);
h = clamp(hRaw + level.climateBias[1] * fade, -1, 1);

// 2. Weights: quadratic falloff inside each biome's radius.
wi = max(0, 1 - dist([t,h], biome_i.climateCenter) / biome_i.climateRadius) ** 2;
// If all weights are 0, the nearest-center biome gets weight 1.
// Normalize: wi /= Σw.

// 3. NUMERIC params blend by weight: baseSpline/reliefSpline outputs, pvAmplitude, forestDensity,
//    oreRichness, haze/grade params. (Blend the EVALUATED spline outputs, not control points.)
// 4. CATEGORICAL params take argmax(wi): surface palette id, strata profile id, ambient set.
```

Blending evaluated-spline outputs keeps height continuous across biome boundaries; categorical snapping is acceptable because the numeric fields around it vary smoothly. Each `LevelDef` sets `climateBias` to the vector that lands its intended biome's climate center (e.g. `desert_badlands` center `[0.7, -0.6]` → tutorial bias picks up the difference from the raw fields at its seed — compute once at authoring, hardcode in the level).

Initial biome climate centers (radius 0.55 each): `desert_badlands [0.7,-0.6]`, `red_canyon [0.5,-0.2]`, `alpine_granite [-0.7,0.1]`, `green_foothills [-0.1,0.4]`, `tropical_karst [0.6,0.7]`, `volcanic_flats [0.1,-0.8]`.

### A7 — VoxelGrid SoA layout

```ts
class VoxelGrid {
  static readonly CELL_SIZE = 1.0;
  readonly sizeX: number; readonly sizeY: number; readonly sizeZ: number;
  readonly id: number;                       // keep the identity counter — renderer rebind uses it
  private readonly density: Uint8Array;      // 0 = air, 255 = solid; solid threshold: >= 128
  private readonly compId: Uint16Array;      // palette index; 0 = reserved empty composition
  private readonly fracture: Uint8Array;     // fractureModifier * 255, rounded
  private readonly ores: Map<number, Record<string, number>>; // packedIndex → oreId → density
  readonly palette: CompositionPalette;
  // Index order UNCHANGED from today:
  private idx(x: number, y: number, z: number) { return x + y * this.sizeX + z * this.sizeX * this.sizeY; }
}
```

**New hot-path accessors** (no allocation): `densityAt(x,y,z): number` (0..1 as float, `raw/255`), `isSolidAt(x,y,z): boolean`, `dominantRockAt(x,y,z): string` (palette entry pre-computes its dominant rock at intern time — store `dominantRockId` on the palette entry), `compositionAt(x,y,z): VoxelRockComposition` (returns the **shared palette object — treat as immutable**), `oresAt(x,y,z): Record<string, number> | undefined`, `fractureAt(x,y,z): number`.

**Mutators:** `fillVoxel(x,y,z, compId, ores?)`, `clearVoxelAt(x,y,z)` (density=0, compId=0, delete ores, fracture=255), `setFractureAt(x,y,z, f)`, `scaleFractureAt(x,y,z, factor)`.

**Compatibility:** `getVoxel(x,y,z): VoxelData | undefined` materializes a **copy** (composition deep-copied from palette). It is read-only by contract now — **audit every existing `getVoxel` caller for mutation through the returned object** (the old API returned the live object). Known mutation sites to migrate: `BlastExecution.ts:221-224` (fracture scaling → `scaleFractureAt`), any `setVoxel(x,y,z, mutatedVoxel)` round-trip → `fillVoxel`/`setFractureAt`. `setVoxel(x,y,z, data: VoxelData)` survives as a shim that interns the composition and writes all fields (used by tests).

**Iteration:** `forEachSolid(cb: (x,y,z, compId) => void)` and `forEachSolidInRegion(region, cb)` — plain loops inside the class over the typed arrays; consumers stop hand-rolling triple loops.

**Surface-Y consolidation:** `computeVoxelColumnSurfaceY(grid, x, z)` stays the single canonical scan — top `y` with `density >= 0.5` (raw `>= 128`), returns `-1` if void. Migrate the divergent copies: `BuildingPlacement.getSurfaceY` and `SurveyCalc.getSurfaceY` return `y+1` today — their *call sites* expect "first air cell above ground"; migrate them to `computeVoxelColumnSurfaceY(...) + 1` explicitly so the convention difference is visible at the call site, then delete the local copies. `BlastExecution.getColumnSurfaceY`, `world.ts:172`, `GameRenderer.getTerrainSurfaceY`, `TerrainBody.findSurfaceY` likewise delegate.

### A8 — Composition palette

```ts
class CompositionPalette {
  private entries: Array<{ comp: VoxelRockComposition; dominantRockId: string }> = [
    { comp: { rocks: [] }, dominantRockId: '' },   // index 0 = air/empty, reserved
  ];
  private keyToId = new Map<string, number>();
  intern(comp: VoxelRockComposition): number {
    // Quantize coefficients to 0.01, sort rocks by rockId, build key "cruite:0.62|sandite:0.38".
    // Existing key → return id. New → push entry (compute dominantRockId once), return new id.
  }
  get(id: number) { return this.entries[id]; }
  toJSON() / static fromJSON()               // arrays of {rocks:[{rockId,coefficient}]} — used by A10
}
```

Quantization to 0.01 + strata (A11) generating layer-constant blends keeps palette cardinality small (expect < 2000 entries at level-4 size; `Uint16` gives 65535 headroom — assert `intern` never overflows).

### A9 — Terrain event contract

`GameEventMap` changes:

```ts
'terrain:updated': { region: { minX, minY, minZ, maxX, maxY, maxZ } };  // inclusive voxel coords, clamped to grid
'blast:started':   { originX: number; originY: number; originZ: number };
'blast:ended':     undefined;
'fragment:created': { count: number };   // unchanged
```

Emission points (each exactly once per logical mutation, region = tight AABB of the voxels actually changed):

| Mutator | Emit where |
|---|---|
| `executeBlast` | one `blast:started` before carving; one `terrain:updated` after all three passes (crack + clear + crater) with the union AABB; one `blast:ended` after fragments |
| `drillHole` | after the hole's voxels are cleared |
| `buildRamp` | after the carve band is cleared |
| `regenerateGrid` | full-grid region after generation completes |

The emitter lives on `GameContext.emitter` — mutators that don't currently receive it get it threaded as a parameter (core stays pure; the emitter is core-owned). Renderer subscription happens in `GameRenderer.loadGame` (subscribe) / `clearAll` (unsubscribe): `terrain:updated` → mark dirty chunks (A17) — **remove `main.ts:164-174` string matching in the same commit** so there is never a double path. NavGrid: the existing explicit `patchNavGrid` call sites stay (core→core, no event needed), but `patchNavGrid` gains a patch-local `maxSurfaceY` recomputation: scan the patch region columns; if any patched column's previous height equalled `navGrid.maxSurfaceY` and decreased, do one full `computeMaxSurfaceY` rescan (rare; correctness over cleverness).

### A10 — Save v6 voxel serialization (RLE)

JSON-embedded, byte-level RLE, base64. Format:

```ts
interface SerializedVoxels {
  v: 6;
  sizeX: number; sizeY: number; sizeZ: number;
  palette: Array<{ rocks: Array<{ rockId: string; coefficient: number }> }>;  // index-aligned, entry 0 = empty
  density: string;   // base64(rle(Uint8Array))
  compId: string;    // base64(rle(new Uint8Array(compId.buffer)))  — little-endian u16 bytes
  fracture: string;  // base64(rle(Uint8Array))
  ores: Array<[packedIndex: number, Record<string, number>]>;      // sparse, sorted by index
}
```

RLE codec (bytes → byte pairs):

```ts
function rleEncode(src: Uint8Array): Uint8Array {
  // Emit (count, value) pairs; count 1..255. Long runs split into multiple pairs.
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && src[i + run] === src[i] && run < 255) run++;
    out.push(run, src[i]); i += run;
  }
  return new Uint8Array(out);
}
// rleDecode is the inverse; total decoded length must equal sizeX*sizeY*sizeZ (×2 for compId) — else corrupt save → Result error, not throw.
```

Base64 without DOM (core purity — no `btoa`): implement a small pure base64 encoder/decoder in `src/core/state/Base64.ts` (standard alphabet, no padding tricks). `serialize` embeds `SerializedVoxels` under `state.world.voxels`; `deserialize` v6 rebuilds the `VoxelGrid` from it (grid still constructed by `regenerateGrid`'s funnel — pass the serialized payload down so the funnel either regenerates (v5, no payload) or restores (v6)). NavGrid: add `navGrid` to a `JSON.stringify` replacer skip-list (serialize as `null`); rebuild via `buildGameNavGrid` on every load path.

### A11 — Strata (depth-layered rock)

Each biome references a `strataProfileId`. A profile is an ordered top-down layer list:

```ts
interface StratumDef {
  blend: Array<{ rockId: string; coefficient: number }>;  // the composition for this layer (pre-normalized)
  meanThickness: number;      // metres
  thicknessVariance: number;  // metres, driven by noise
}
```

Default profile shape (per biome, 4-6 layers): topsoil (1-2 m, tier-1 rocks) → overburden (3-6 m, tier-1/2) → bedded (8-20 m, tier-2/3) → deep (rest, tier-3/4/5 per biome). `mixedRockHardness: true` swaps in a variant profile alternating tier-1 and tier-5 layers of 4-6 m.

Per column, layer boundaries:

```
tiltNoise = fbm2(strataNoise_i, x, z, 2, 1/120)          // one sub-seeded field per layer index i
boundaryDepth_i = boundaryDepth_{i-1} + max(0.5, layer_i.meanThickness + layer_i.thicknessVariance * tiltNoise)
```

Voxel at depth `d = surfaceY - y` (metres below surface) belongs to the layer whose `[boundaryDepth_{i-1}, boundaryDepth_i)` contains `d`. **Boundary perturbation** so blast cross-sections don't show flat bands: add `1.5 * noise3d(strataWarp, x*0.06, y*0.06, z*0.06)` to `d` before the lookup (one shared sub-seeded 3D field). Within ±0.75 m of a boundary, blend the two layers' compositions linearly by distance (produces intermediate palette entries — this is where palette cardinality comes from; the quantization in A8 caps it).

### A12 — Ore veins

Per ore, one sub-seeded 3D field (`subSeed(levelSeed, 'ore:' + oreId)`), **anisotropic** to elongate veins along strike:

```ts
// Strike direction per ore per level: angle = cellRand(levelSeed, 0, 0, hash of oreId) * 2π
// Rotate (x,z) into strike space: (u, v) = rotate(x, z, -angle)
n = 1 - Math.abs(noise3d(u * 0.015, y * 0.10, v * 0.10));  // ridged; freq along strike 6.7× lower → elongated
inWindow = ore.depthMin <= d && d <= ore.depthMax;          // depth window per ore (add to OreCatalog: e.g. dirtite 0-8 m, treranium 30+ m)
affinity = hostRockAffinity(compositionAt(x,y,z), ore);     // Σ coefficient_i * rock_i.oreProbabilities[oreId]
threshold = 1 - affinity * biome.oreRichness * 0.9;
if (inWindow && n > threshold) oreDensity = min(1, (n - threshold) * 4);
```

Store when `oreDensity > 0.05` (sparse map stays sparse). This replaces the shared-field hash-offset scheme and honours the composition weighting the old doc-comment promised.

### A13 — Structure overlay architecture

`WorldGen` output must stay a pure deterministic function of `(levelSeed, x, z)`. Structures modify heights, so they are computed **once** at world build into a `StructureSet`, then applied as bounded overlays during sampling:

```ts
interface HeightOverlay {
  bounds: { minX, minZ, maxX, maxZ };          // support region, metres
  apply(x, z, h): number;                       // pure; returns modified height
}
interface StructureSet {
  overlays: HeightOverlay[];                    // ordered: rivers → landmarks → village pads
  spatialIndex: Map<number, number[]>;          // coarse 128 m cell → overlay indices (packed key)
  rivers: RiverPath[]; villages: Village[]; trees: TreePoint[]; landmarks: Landmark[];
}
// sampleColumn(x, z): h = baseHeight(x, z) [A4, A5] → for each overlay whose bounds contain (x,z), h = overlay.apply(x, z, h)
```

Build order is fixed: (1) rivers trace on the **base** height field; (2) landmarks; (3) village pads (flattening) — later overlays see earlier ones' effects only through `apply` chaining, which the fixed order makes deterministic. Trees and house placement run **after** all overlays, sampling final heights.

### A14 — Rivers

All on a coarse 8 m grid over the landscape extent, using base heights (pre-overlay):

1. **Springs:** jittered-grid candidates, cell 400 m: point = cell corner + `(cellRand(..,1), cellRand(..,2)) * 400`. Keep if `h > 35` and `fbm2(riverSpringNoise, x, z, 2, 1/300) > 0.3`. Cap: 6 springs per world, highest-h first.
2. **Trace:** from spring, step to the lowest of the 8 neighbours (8 m step). Stop when: `h < 0.5` (reached sea level), or no neighbour is lower (local minimum → place a **lake**: disc, radius `20 + 20 * cellRand`, water surface at min height + 0.5), or the path leaves the landscape extent, or 2000 steps.
3. **Playable exclusion (default-and-record):** if any traced point enters the playable rect expanded by 32 m, **discard the whole river** (no deflection logic — simplicity wins; rivers are landscape-only like villages).
4. **Smooth:** 2 iterations of Chaikin corner cutting on the point list.
5. **Carve overlay:** width `W(s) = 3 + 5 * s` (s = normalized arc position 0→1), depth `D(s) = 1.5 + 1.5 * s`. For a column at distance `dist` from the nearest path segment (`dist < W`): `h -= D * (1 - (dist/W)²)`. Water surface per segment = carved bed at centreline + 1.0 m, monotonically non-increasing downstream (clamp each segment's water level to ≤ previous).
6. Store `RiverPath { points, widths, waterLevels }` in `StructureSet` for the renderer's `WaterSurface` (A26).

### A15 — Forests, villages, landmarks

**Forests** (after overlays): jittered grid, cell 6 m. Tree at cell point if all: outside playable rect + 8 m; `slope < 0.55 rad` (slope from central differences at 4 m); not within any river `W + 3 m` or lake or village pad; `cellRand(seed, cx, cz, FOREST_SALT) < density` where `density = biome.forestDensity * clamp(fbm2(forestNoise, x, z, 3, 1/90) * 0.5 + 0.5, 0, 1)`. Store `TreePoint { x, z, h, scale: 0.7 + 0.6 * cellRand, variant: floor(3 * cellRand) }`. Expected count order: 5-20 k points — renderer instances them (A26).

**Villages:** jittered grid, cell 600 m. Candidate per cell; **hard reject** if inside playable rect + 100 m (this is the invariant under test — 1000-seed property test lives here). Score = `2 * flatness + riverBonus` where `flatness = 1 - clamp(slope16m / 0.15, 0, 1)` (slope over a 16 m window) and `riverBonus = 1` if a river/lake is within 120 m. Accept `score > 1.2` and `2 < h < 40`. Cap 5 villages. Per village: pad overlay (radius 40 m, `h → lerp(h, hCenter, smoothstep(40, 15, r))`), then 5-12 houses on a jittered ring at 10-30 m from centre, each `House { x, z, rotation, w: 4-6, d: 5-8, h: 3-4, hasChimney: cellRand < 0.8 }`, skipping house sites where local slope after padding > 0.1. Houses are **renderer geometry** (boxes + triangular-prism roofs from these params); core stores only the data.

**Landmarks** (2 per world, ≥ 400 m from playable rect, ≥ 500 m apart, picked by seeded choice from the implemented set — start with these two):

- **Mesa:** radius `R = 60 + 40 * cellRand`, plateau at `hBase + 25`: `h → lerp(h, plateau, smoothstep(R, R * 0.7, r))` — steep smoothstep rim reads as cliffs.
- **Crater lake:** radius `R = 50 + 30 * cellRand`: rim raise `+8 * smoothstep(R, R*0.75, r) * smoothstep(R*0.45, R*0.6, r)`, inner bowl `-10 * smoothstep(R*0.6, 0, r)`, water disc at `hBase - 2`.

### A16 — Landscape tiles and the seam rule

Tile layout (all in world metres, playable rect at `[0..sizeX]×[0..sizeZ]`):

```
extentHalf = 1600 (from playable centre)
TILE_SPAN = 512, COARSE_STEP = 4      → 129×129 samples per tile (fence-post: span/step + 1)
FINE_STEP = 1                          → only for the skirt band (below)
Tiles on a grid aligned to playable centre; skip any tile whose entire span lies inside the playable rect.
```

Per sample: `height` (world h + groundOffset, float), `biomeId` (argmax, Uint8), `surfCompId` (palette id of the surface stratum, Uint16 — interned into the same palette as the grid so shader rock indices agree).

**Seam rule (renderer, T3.2):** the landscape mesh is built for all samples whose position is **outside** the playable rect, **plus a 2 m overlap strip inside it**, with the overlap strip's vertices lowered by `0.15 m`. The marching-cubes surface therefore always covers the landscape in the overlap zone; no gap can open regardless of voxelization rounding, and the boundary band shader (A19.4) sits exactly over the junction. Within 24 m of the playable rect, tiles subdivide to `FINE_STEP = 1` (matching voxel resolution) so silhouette density matches across the seam. Tile geometry: indexed grid, smooth normals from central differences of the height samples. One `Mesh` per tile, all sharing the terrain material.

### A17 — Chunked remesh

Chunk coordinates: `cx = floor(x / 16)` etc. `TerrainMesh` holds `Map<number, ChunkMesh>` keyed `cx + cy * NCX + cz * NCX * NCY`.

**Dirty-set math** for `terrain:updated { region }` — marching a cube at `(x,y,z)` reads corners up to `(x+1,y+1,z+1)`, so a changed voxel at `v` affects cubes from `v-1` to `v`:

```
cxMin = floor((region.minX - 1) / 16), cxMax = floor(region.maxX / 16)   // same for y, z; clamp to grid
```

Re-march exactly those chunks: dispose the chunk's old `BufferGeometry`, march its 16³ cells (cells at the chunk's high edge read into the neighbour chunk's voxels — reads only, so no ordering constraint), build a new geometry, keep the shared material. Full rebuild (`buildAll`) only on grid identity change (`grid.id`). Empty chunks (no triangles) store `null` and add no mesh. Per-chunk `frustumCulled = true` (chunks are small — this is a free win over the old single mesh).

### A18 — Marching-cubes vertex attributes

At each emitted vertex (from `interpVertex` between corner `p1` and corner `p2` with interpolant `t`):

```
aRockA  = rockIndexOf(dominantRockAt(p1))   // float; index into the shader's rock uniform table
aRockB  = rockIndexOf(dominantRockAt(p2))
aRockW  = t                                  // 0 → pure A, 1 → pure B
aOreId  = index of the highest-density ore at the nearer corner (t < 0.5 ? p1 : p2), or -1 if none
aOreAmt = that ore's density (0 if none)
```

`rockIndexOf`: fixed table = `getAllRocks()` order (10 entries today; shader arrays sized 12 for headroom). Air corners (`dominantRockAt === ''`) inherit the other corner's rock. The landscape mesher emits the same attributes from `surfCompId` (A = B = surface rock, W = 0, ore none). `FragmentMesh` supplies them as per-instance attributes (`InstancedBufferAttribute`) from the fragment's source voxel.

### A19 — Terrain shader (TerrainMaterial)

Base `MeshStandardMaterial({ roughness: 0.9, metalness: 0.0 })`; all customization via `onBeforeCompile`. **No triplanar projection is needed**: detail comes from *solid 3D noise* evaluated at the world position, which is UV-free and correct on arbitrary cut faces by construction (this satisfies the issue's intent; note it in code comments). Normal-based blending is still used for a top-surface tint.

**A19.1 — GLSL noise library** (injected into `#include <common>` of the fragment shader):

```glsl
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p){ return (vnoise(p) * 0.5 + vnoise(p * 2.03) * 0.3 + vnoise(p * 4.09) * 0.2); }  // [0,1]
```

**A19.2 — Uniforms and attributes:**

```glsl
uniform vec3 uRockColor[12];      // linear-space albedo per rock (from RockCatalog visual params)
uniform vec4 uRockParams[12];     // x: macroFreq (default 0.05), y: detailFreq (0.35), z: veinStrength (0-0.5), w: contrast (0-0.6)
uniform vec4 uPlayRect;           // minX, minZ, maxX, maxZ
uniform vec2 uCloudOffset;        // accumulated wind scroll (A25)
uniform float uCloudCoverage;     // 0-1 from weather
uniform float uBandStrength;      // default 0.35
attribute float aRockA, aRockB, aRockW, aOreId, aOreAmt;   // declared in vertexShader; passed as flat-ish varyings
varying vec3 vWorldPos;           // assigned in <begin_vertex> via modelMatrix
```

**A19.3 — Albedo** (replaces `#include <color_fragment>`):

```glsl
int ra = int(vRockA + 0.5); int rb = int(vRockB + 0.5);
vec3 base = mix(uRockColor[ra], uRockColor[rb], vRockW);
vec4 pa = mix(uRockParams[ra], uRockParams[rb], vRockW);
float macro = fbm3(vWorldPos * pa.x) - 0.5;                     // ±0.5
float detail = fbm3(vWorldPos * pa.y) - 0.5;
float vein = max(0.0, 1.0 - abs(vnoise(vWorldPos * 0.13) - 0.5) * 8.0);   // thin sheets
float b = macro * pa.w + detail * 0.25 - vein * pa.z;
vec3 col = clamp(base * (1.0 + vec3(b, b * 0.92, b * 0.85)), 0.0, 1.0);   // warm-biased like the CPU version
// Ore sparkle: tint toward the ore color scaled by amount and a high-freq mask.
if (vOreId >= 0.0) col = mix(col, uOreColor[int(vOreId + 0.5)], vOreAmt * 0.35 * step(0.72, vnoise(vWorldPos * 3.1)));
// Top tint (landscape grass/sand cap): geometryNormal.y-weighted blend toward the biome surface tint (uniform), playable zone excluded via uBandStrength path if desired — start simple: apply everywhere, weight = smoothstep(0.75, 0.95, normal.y) * uTopTintStrength.
diffuseColor.rgb = col * cloudShadow(vWorldPos.xz) * boundaryBand(vWorldPos.xz);
```

**A19.4 — Boundary band:**

```glsl
float boundaryBand(vec2 p){
  vec2 dmin = uPlayRect.xy - p, dmax = p - uPlayRect.zw;
  float dOut = length(max(max(dmin, dmax), 0.0));        // 0 inside rect, metres outside
  float band = smoothstep(0.0, 0.5, dOut) * (1.0 - smoothstep(2.5, 5.0, dOut));
  return 1.0 - uBandStrength * band;                      // dark ring ~0.5-5 m outside the edge, normal beyond
}
```

**A19.5 — Cloud shadow:**

```glsl
float cloudShadow(vec2 p){
  float c = fbm3(vec3((p + uCloudOffset) * 0.004, 17.0));
  return 1.0 - 0.25 * uCloudCoverage * smoothstep(0.55, 0.75, c);
}
```

**Injection mechanics** (spell out for the executor): in `onBeforeCompile(shader)`, string-replace: vertexShader `#include <common>` → itself + attribute/varying declarations; `#include <begin_vertex>` → itself + varying assignments (`vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;` — terrain meshes have identity model matrices but keep it correct for fragments). fragmentShader `#include <common>` → itself + noise lib + uniforms + varyings; `#include <color_fragment>` → the A19.3 block. Copy uniform objects into `shader.uniforms` and keep references on the material instance for per-frame updates (`uCloudOffset`, `uCloudCoverage`). `customProgramCacheKey` returns a constant string. **Construct-time rule:** nothing here touches DOM/WebGL — `onBeforeCompile` only runs at first render, so the material is Node-test safe; add a unit test that constructs `TerrainMaterial` and asserts the uniform table matches `getAllRocks()` order.

### A20 — Composer and shadows

```ts
// src/renderer/post/PostPipeline.ts
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;            // tune in art pass
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, w, h);  // defaults first; radius ≈ 2.5, tune in art pass
composer.addPass(gtao);
composer.addPass(aerialPass);                    // A21 — before tonemapping (works in linear HDR-ish space)
const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.6, 0.9); // strength LOW, threshold HIGH
composer.addPass(bloom);
composer.addPass(new OutputPass());              // tonemapping + sRGB conversion happens HERE
composer.addPass(new SMAAPass(w * dpr, h * dpr)); // AA on final LDR output
```

`SceneManager.start` loop: `composer.render()` replaces `renderer.render(...)`; keep `gl.finish()` immediately after. `onResize`: `composer.setSize(w, h)` + `gtao.setSize` + SMAA re-size; re-apply `setPixelRatio`. Remove `antialias: true` from the `WebGLRenderer` options (useless behind a render target) and remove `scene.fog`.

**Shadows (CSM):** `three/examples/jsm/csm/CSM.js` — `new CSM({ maxFar: 1200, cascades: 3, mode: 'practical', parent: scene, shadowMapSize: 2048, lightDirection, camera })`; `csm.setupMaterial(terrainMaterial)` and on other lit materials; `csm.update()` per frame after camera update. The existing `sun` DirectionalLight is retired in favour of CSM's lights; `SkyboxWeather` drives CSM light intensity/color instead (give it a setter interface rather than reaching into `sm.sun`). The anonymous fill light becomes `readonly fill` on `SceneManager`, weather-modulated. If CSM fights `onBeforeCompile` (both patch shaders — CSM must be set up **before** the material's first render; verify visually), fall back to a single `DirectionalLight` shadow with a camera-following ortho frustum sized to 1.5× the view span — record whichever ships.

### A21 — Aerial perspective + grade pass

Full-screen `ShaderMaterial` pass (extend three's `Pass`; read `tDiffuse` + `tDepth` — enable `RenderPass` depth texture or use `composer.readBuffer.depthTexture`):

```glsl
uniform sampler2D tDiffuse, tDepth;
uniform mat4 uProjInv, uViewInv;
uniform vec3 uHazeColor;         // per-biome, weather-lerped
uniform float uDensity;          // 0.0016
uniform float uHeightRef;        // ground mean world-y (groundOffset + hCenter)
uniform float uHeightFalloff;    // 60
uniform float uNearStart;        // 150 — pit stays haze-free
uniform vec3 uLift; uniform vec3 uGain; uniform float uGamma;   // per-biome grade
void main(){
  vec4 col = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 1.0) { gl_FragColor = grade(col); return; }        // sky: grade only, no haze
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjInv * clip; view /= view.w;
  vec3 world = (uViewInv * view).xyz;
  float dist = length(view.xyz);
  float density = uDensity * exp(-max(world.y - uHeightRef, 0.0) / uHeightFalloff);  // thick in valleys, thin on peaks
  float f = 1.0 - exp(-density * max(dist - uNearStart, 0.0));
  f = min(f, 0.85);                                               // never fully swallow the horizon
  vec3 desat = mix(col.rgb, vec3(dot(col.rgb, vec3(0.299, 0.587, 0.114))), f * 0.5);
  vec3 hazed = mix(desat, uHazeColor, f);
  gl_FragColor = grade(vec4(hazed, 1.0));
}
vec4 grade(vec4 c){ return vec4(pow(c.rgb, vec3(uGamma)) * uGain + uLift, c.a); }
```

Per-biome grade defaults: `desert_badlands` gamma 0.96 gain (1.05,1.0,0.92) lift (0.02,0.01,0.0); `alpine` gamma 1.0 gain (0.96,1.0,1.06); `tropical` gamma 0.94 gain (0.98,1.04,0.98); `volcanic` gamma 1.02 gain (1.0,0.96,0.94) — starting points for the art pass. Haze color lerps with weather (sunny: sky-tinted warm; storm: grey). The band (A19.4) is applied in the terrain material *before* haze, so it fades with distance like real shading — that is the intended behaviour (the band matters up close where the player acts).

### A22 — Typed-array pathfinding and reachability

- **A\*** (`Pathfinding.ts`): replace string-keyed maps with flat arrays over `width*height` cells: `gScore: Float64Array`, `cameFrom: Int32Array` (packed cell index, -1 none), `state: Uint8Array` (0 unvisited / 1 open / 2 closed), plus a **generation counter trick** to avoid reallocation: `stamp: Int32Array` + `currentStamp++` per search; a cell is initialized iff `stamp[i] === currentStamp`. Arrays live on a module-level scratch object sized to the largest grid seen (grow-only). Binary-heap open list keyed by `f` (replace array-scan if that's what exists — check first). Budget: `PATHFINDING_NODE_BUDGET_CAP = max(500, Math.floor(gridX * gridZ / 8))` computed where the cap is applied (balance.ts exports the formula's constants, not the product).
- **Reachability BFS** (`NavGridReachability.ts`): `Uint8Array` visited + `Int32Array` ring-buffer queue, packed indices; result set exposed as the same `Set<string>` API if callers depend on it (check `HaulingTask.ts:152` and hire/buy call sites — if they only membership-test, expose a `has(x,z)` wrapper over the typed array instead and migrate).
- `Survey.ts` `surveyedPositions` stays string-keyed (serialized, human-readable, low-frequency) — record as deliberate.

### A23 — TerrainBody scoping

`TerrainBody.build(grid, region)` takes the blast AABB expanded by `2 * BLAST_ZONE_RADIUS` (clamped to grid) and creates static bodies only for columns in that region (same two-surface-layer scheme as today). Call site: physics setup for a blast already knows the blast plan's AABB — thread it through. Assert body count ≤ region area in the unit test; the whole-grid path is deleted.

### A24 — WindState

```ts
// src/renderer/ambient/WindState.ts — pure math, Node-testable.
const TARGET_SPEED: Record<WeatherState, number> = {
  sunny: 0.15, cloudy: 0.3, light_rain: 0.45, heavy_rain: 0.65, storm: 1.0, heat_wave: 0.1, cold_snap: 0.35,
};
class WindState {
  constructor(seed: number) { this.baseAngle = cellRand(seed, 0, 0, WIND_SALT) * Math.PI * 2; this.p1 = ...; this.p2 = ...; } // seeded phases
  update(dt: number, weather: WeatherState): void {
    this.time += dt;
    const targetSpeed = TARGET_SPEED[weather];
    this.speed += (targetSpeed - this.speed) * Math.min(1, 0.1 * dt);          // ~10 s convergence
    this.angle = this.baseAngle + 0.35 * Math.sin(this.time * 0.005 + this.p1)
                                + 0.15 * Math.sin(this.time * 0.013 + this.p2); // slow coherent wander
  }
  get vector(): { x: number; z: number } { return { x: Math.cos(this.angle) * this.speed, z: Math.sin(this.angle) * this.speed }; }
}
```

Owned by `GameRenderer`; updated each frame from `ctx.weatherCycle.current`; every ambient module and the terrain material's `uCloudOffset` accumulator read `windState.vector`. **One instance, one truth.**

### A25 — Clouds and cloud shadows

- Geometry: 5 pre-merged cluster variants (3-7 stretched icospheres/boxes each, flat-shaded, built procedurally — no DOM), one `InstancedMesh` per variant, `MeshStandardMaterial({ transparent: true, opacity: 0.9, depthWrite: false })` in a warm white; `castShadow = false` (shadows come from the shader term, cheaper and art-directable).
- Placement: 40 instances in a 2000 m-radius disc around the playable centre, `y = 180 + 80 * cellRand`, seeded scale 30-90 m.
- Drift: `pos += windVector * 18 * dt` (18 m/s at speed 1); wrap: an instance leaving the disc re-enters at the antipode with a new seeded lateral offset.
- Coverage per weather (drives instance visible-count and `uCloudCoverage`): sunny 0.25, cloudy 0.7, rain states 0.9, storm 1.0 (also darken cloud material color), heat_wave 0.08, cold_snap 0.5. Lerp coverage at the same rate SkyboxWeather lerps sky color.
- **Shadow sync:** CPU accumulates `uCloudOffset += windVector * 18 * dt * SHADOW_PARALLAX` with `SHADOW_PARALLAX = 1.0` — the shader FBM (A19.5) scrolls with the same velocity as the meshes, so shadow patches and clouds move together (they need not align 1:1 spatially; coherent motion is what sells it).
- Gradient sky: replace flat `scene.background` with a `SphereGeometry(3000)` backside dome, 2-stop gradient shader (`skyLow` at horizon → `skyHigh` at zenith — finally using the dormant `skyHigh` values); `SkyboxWeather` keeps lerping both colors. The dome material is a tiny `ShaderMaterial` (fog/lights off) — construct-safe under Node.

### A26 — Birds, smoke, water, vegetation

- **Birds:** one `InstancedMesh` (cone + two flattened-box wings merged, ~30 tris), 6 flocks × 12. Flock path: seeded circle (centre in landscape zone, radius 80-200 m, height 60-120 m, angular speed `0.05-0.1 rad/s`, seeded direction). Bird `i`: `pos = centre + R(cos, 0, sin)(a + i * 0.12) + vec3(0, 1.5 * sin(t * 2 + i), 0)`; heading = path tangent; wing flap = instance scale.y oscillation `1 ± 0.4 * sin(t * 9 + i)`. **Blast scatter:** on `blast:started`, flocks whose centre is within 250 m of the origin get `scatter = 1`, decaying over 4 s; while scattering, radius ×= 1 + scatter, speed ×= 1 + 2*scatter, birds gain outward offset.
- **Chimney smoke:** per chimneyed house, 4 recycled billboard quads (one shared `PlaneGeometry`, `InstancedMesh` across all chimneys, additive-free normal blending, soft round alpha from a `DataTexture` radial ramp). Puff lifecycle (period 6 s, phase-offset per chimney by `cellRand`): `t01 = (t + phase) mod 6 / 6`; `pos = chimneyTop + vec3(0, 8, 0) * t01 + windVector * 6 * t01 * t01`; scale `0.6 + 2.4 * t01`; opacity `0.5 * (1 - t01)`. Camera-facing via instanced quads oriented in the vertex shader (billboard) or per-frame lookAt on a small count — at < 200 instances either is fine; prefer the shader billboard.
- **Water:** river/lake surfaces from `StructureSet` — triangulated strips along `RiverPath` (width `W(s)`, y = waterLevel + groundOffset) and lake discs. `MeshStandardMaterial` base color per biome, `onBeforeCompile`: scroll a 2-octave `vnoise` normal perturbation along the path direction at `0.4 m/s + windVector * 0.2`; sparkle = `step(0.97, vnoise(p * 8 + t))` added to emissive; foam: vertex color painted white within 1 m of banks (computed at build), slight opacity pulse.
- **Vegetation:** trees = 3 merged low-poly variants (cone canopy + cylinder trunk), one `InstancedMesh` per variant fed from `TreePoint`s (5-20 k instances — cap draw distance at 900 m by building only tiles within range; static, no per-frame CPU updates). Sway in the vertex shader (`onBeforeCompile`): `transformed.xz += windVector * pow(max(position.y, 0.0) / canopyHeight, 2.0) * 0.4 * sin(uTime * 1.7 + instanceWorldX * 0.35)` — bend scales with height², phase varies per tree via world X. Grass: star-crossed quad patches (2 quads) instanced near the playable rim (within 60 m outside the rect), same sway uniform, ~2 k instances.
- Uniform plumbing: a single shared `uniform` object `{ uTime, uWind: Vector2 }` created by `GameRenderer`, passed by reference into every ambient material's `onBeforeCompile` uniforms — one update per frame updates all.

### A27 — Determinism guardrails (applies everywhere)

- `Math.random()` allowed **only** in `src/renderer/` for transient jitter that never affects placement (e.g. lightning timing). All *placement* (clouds, flocks, trees, houses, smoke phases) uses `cellRand`/`subSeed` from the level seed — required by the issue ("seeded and stable") and by screenshot-based visual tests.
- Pin `simplex-noise` to an exact version in `package.json` during T1.1.
- Renderer ambient modules must construct without DOM/WebGL (Node tests): geometry from primitives, textures only as `DataTexture`, shaders as strings. Test each new module with a bare `new X(scene, seed)` construction test.
