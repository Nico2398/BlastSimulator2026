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

D7 tile/extent numbers, D8 landscape-regenerated-not-stored, D13 exact level sizes and tile-overlay approach, T1.4 landmark picks, T7.3 ambient extras — all chosen by this plan or the executor under default-and-record; list them in the PR description for human review.
