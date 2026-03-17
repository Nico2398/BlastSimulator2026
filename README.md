# BlastSimulator2026

**A wacky open-pit mine management game in the spirit of Theme Hospital.** Manage blasting, rubble recovery, contracts, employees, and corruption — all while navigating union strikes, mafia entanglements, and the ever-present risk of launching boulders into nearby villages. A satirical caricature of capitalism. Progress through a world map of increasingly challenging mine sites, from a beginner's quarry to an endgame rare-earth nightmare.

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Language | TypeScript | 5.x (strict) | Type safety for autonomous agent validation |
| Build tool | Vite | 5.x | Fast build, HMR, static HTML output for itch.io |
| 3D Rendering | Three.js | latest | Cartoon 3D graphics |
| Physics | cannon-es | latest | Rigid body simulation for blast fragments |
| Terrain | Marching Cubes | custom impl | Smooth surface generation from voxel grid |
| Noise | simplex-noise | 4.x | Procedural terrain and ore vein generation |
| Testing | Vitest | latest | Unit + integration tests, Node.js native |
| Visual testing | Puppeteer | latest | Headless Chrome screenshot capture |
| Console mode | Node.js + tsx | latest | CLI gameplay for testability without browser |

## Architecture

The codebase is split into strict layers. **The core layer (`src/core/`) is 100% pure TypeScript with zero side effects** — no DOM, no WebGL, no `window`, no I/O. This means all game logic can be tested in Node.js without a browser, and the console mode operates on the exact same logic as the UI.

See `.agent/ARCHITECTURE.md` for the full directory structure and data flow diagrams.

**Key principles:**
- **State-driven**: The entire game is a single serializable `GameState` object
- **Tick-based loop**: Discrete time steps; renderer interpolates between ticks
- **Event-driven rendering**: Core emits events; renderer/UI/audio subscribe
- **Asset replaceability**: All visual assets loaded via an AssetManager with swappable IDs

## Reference Documents

| Document | Contents |
|----------|----------|
| `.agent/GAME_DESIGN.md` | Full game design: mechanics, content, catalogs, tone |
| `.agent/ARCHITECTURE.md` | Tech architecture, directory structure, data flow |
| `.agent/BLAST_SYSTEM.md` | Blast physics algorithm specification |
| `.agent/TESTING.md` | Testing strategy, patterns, acceptance criteria format |
| `.agent/WORKFLOW.md` | Agent workflow rules and task execution procedure |

**Read `.agent/WORKFLOW.md` before starting any work.** It defines the exact procedure for each task.

## Agent Workflow Summary

1. Pick the **next unchecked task** from the task list below
2. Read its acceptance criteria and any referenced `.agent/` documents
3. Write tests for the acceptance criteria
4. Implement the feature
5. Run `bash scripts/validate.sh` — must pass
6. Test via console mode if applicable (`npx tsx src/console.ts`)
7. Take a screenshot if it involves rendering (`npx tsx scripts/screenshot.ts`)
8. Mark the task checkbox as `[x]` in this README
9. Repeat

**Critical rules:**
- Never skip a task unless blocked (leave a `<!-- BLOCKED -->` comment)
- Never break existing tests
- All user-facing text goes through i18n (both `en.json` and `fr.json`)
- All `src/core/` code must be pure — no DOM, no WebGL
- File size limit: 300 lines per file. Split if needed.

## Validation

```bash
# Full validation (run after every task):
bash scripts/validate.sh

# Individual steps:
npx tsc --noEmit              # Type check
npx vitest run                 # Tests
npx vite build                 # Build check
bash scripts/check-tasks.sh    # Task consistency (skips, missing files, i18n sync)

# Console mode:
npx tsx src/console.ts

# Screenshot capture (dev server must be running):
npx tsx scripts/screenshot.ts --name "my-feature"
```

---

## Task List

### Phase 0 — Project Scaffolding

- [x] **0.1: Initialize project**
  Create `package.json` with all dependencies (typescript, vite, three, cannon-es, simplex-noise, vitest, puppeteer, tsx). Add the following npm scripts to `package.json`: `"dev": "vite"`, `"build": "vite build"`, `"console": "tsx src/console.ts"`, `"validate": "bash scripts/validate.sh"`, `"test": "vitest run"`. Create `tsconfig.json` with strict mode. Create `vite.config.ts`. Create `index.html` with a `<canvas id="game-canvas">`. Create a minimal `src/main.ts` that renders a colored cube with Three.js to confirm the pipeline works. Create a minimal `src/console.ts` entry point that prints "BlastSimulator2026 Console Mode" and exits.
  **Acceptance criteria:**
  - [x] `npm install` completes without errors
  - [x] `npx tsc --noEmit` passes
  - [x] `npm run build` produces a `dist/` folder
  - [x] `npm run console` prints "BlastSimulator2026 Console Mode"
  - [x] `npm run validate` runs `scripts/validate.sh` (will partially fail until task 0.2 — that's expected)
  - [x] Opening `index.html` via dev server shows a spinning or static colored cube

- [x] **0.2: Set up testing infrastructure**
  Configure Vitest in `vite.config.ts` or `vitest.config.ts`. Create `tests/unit/` and `tests/integration/` directories. Write a trivial passing test (`tests/unit/smoke.test.ts`) that asserts `1 + 1 === 2`. Make `scripts/validate.sh` executable and functional.
  **Acceptance criteria:**
  - [x] `npx vitest run` finds and passes the smoke test
  - [x] `bash scripts/validate.sh` runs all four steps and reports success

- [x] **0.3: Set up i18n system**
  Implement `src/core/i18n/I18n.ts`: a translation module with `t(key, params?)` function, `setLocale(locale)`, and `getLocale()`. Support string interpolation with `{variable}` syntax. Create `src/core/i18n/locales/en.json` and `src/core/i18n/locales/fr.json` with a few sample keys (e.g., `"game.title": "BlastSimulator2026"`, `"game.subtitle": "Dig. Blast. Profit."` / `"game.subtitle": "Creuse. Explose. Profite."`). Create `src/core/i18n/keys.ts` with typed key constants.
  **Acceptance criteria:**
  - [x] Unit test: `t('game.title')` returns "BlastSimulator2026" in both locales (brand name, untranslated)
  - [x] Unit test: `t('game.subtitle')` returns "Dig. Blast. Profit." when locale is 'en'
  - [x] Unit test: `t('game.subtitle')` returns "Creuse. Explose. Profite." when locale is 'fr'
  - [x] Unit test: `t('blast.fragments', { count: 42 })` returns "42 fragments detected" in en
  - [x] Unit test: switching locale with `setLocale` changes all subsequent `t()` calls
  - [x] `npm run validate` passes

- [x] **0.4: Set up console mode framework**
  Implement `src/console/ConsoleRunner.ts`: a command parser that reads lines from stdin, splits them into command name + arguments, dispatches to registered command handlers, and prints results. Implement `src/console/ConsoleFormatter.ts` for pretty-printing. Register a `help` command that lists all available commands. Wire it in `src/console.ts` so `npx tsx src/console.ts` starts an interactive REPL.
  **Acceptance criteria:**
  - [x] Unit test: `parseCommand('survey 25,30')` returns `{ command: 'survey', args: ['25,30'] }`
  - [x] Unit test: `parseCommand('charge hole:1 explosive:tnt amount:5kg')` parses named args correctly
  - [x] Running `npx tsx src/console.ts` starts an interactive prompt
  - [x] Typing `help` lists registered commands
  - [x] Typing an unknown command prints an error message
  - [x] `npm run validate` passes

---

### Phase 1 — Core Data Structures

- [x] **1.1: Vec3 and math utilities**
  Create `src/core/math/Vec3.ts` with a simple 3D vector type and operations: add, subtract, scale, normalize, distance, dot, cross, length, lerp, clamp. Pure functions, no mutation. Also create `src/core/math/Random.ts` with a seeded PRNG (e.g., mulberry32) so all randomness is reproducible from a seed.
  **Acceptance criteria:**
  - [x] Unit test: Vec3 distance, normalize, lerp produce correct results
  - [x] Unit test: seeded Random produces the same sequence given the same seed
  - [x] Unit test: two different seeds produce different sequences
  - [x] `npm run validate` passes

- [x] **1.2: GameState and GameLoop**
  Define `src/core/state/GameState.ts`: the central state interface containing all game data (initially mostly empty sub-objects). Implement `createGame(config)` factory function. Implement `src/core/state/GameLoop.ts`: a tick-based loop that takes a `GameState` and `dt` and calls update functions for each subsystem (stubs for now). Add `timeScale` to GameState (1x, 2x, 4x, 8x) and `isPaused` flag.
  **Acceptance criteria:**
  - [x] Unit test: `createGame({ seed: 42 })` returns a valid GameState object
  - [x] Unit test: `tick(state, 100)` advances `state.time` by `100 * state.timeScale`
  - [x] Unit test: `tick(state, 100)` with `isPaused = true` does not advance time
  - [x] Unit test: changing `timeScale` to 4 makes time advance 4x faster
  - [x] `npm run validate` passes

- [x] **1.3: Save/Load system**
  Implement `src/core/state/SaveLoad.ts`: `serialize(state) → string` (JSON) and `deserialize(json) → GameState`. Ensure all state is serializable (no functions, no circular references). Add version field for future migration. Define `src/core/state/SaveBackend.ts`: the persistence interface with methods `save(slotId, data)`, `load(slotId)`, `list()`, `delete(slotId)`. This interface lives in `src/core/` because it is a pure type definition with no side effects. Then implement three concrete backends in `src/persistence/` (OUTSIDE of `src/core/`, since they use platform APIs):
  - `src/persistence/FilePersistence.ts`: reads/writes JSON files to a configurable directory (for desktop/local use, uses Node.js `fs`)
  - `src/persistence/IndexedDBPersistence.ts`: uses IndexedDB for web persistence (survives page reloads, no size limit issues)
  - `src/persistence/DownloadPersistence.ts`: fallback for web — exports save as a downloadable `.json` file, imports via file picker (uses DOM APIs)
  The game auto-detects the environment and picks the best backend. Save slots store: serialized GameState, slot name, timestamp, campaign progress snapshot (current level, levels unlocked).
  **Acceptance criteria:**
  - [x] Unit test: `deserialize(serialize(state))` produces an equivalent state
  - [x] Unit test: serialized output is valid JSON
  - [x] Unit test: deserialization of unknown version throws a clear error
  - [x] Unit test: `FilePersistence` can save and load a state from disk (Node.js test)
  - [x] Unit test: `SaveBackend` interface is correctly implemented by all three backends
  - [x] Unit test: save slot metadata (name, timestamp, campaign progress) is stored alongside state
  - [x] Unit test: `list()` returns all saved slots with metadata
  - [x] `src/core/state/SaveBackend.ts` contains ONLY the interface — no platform imports
  - [x] `src/persistence/` implementations do NOT import from `renderer/`, `physics/`, `ui/`, `audio/`
  - [x] `npm run validate` passes

- [x] **1.4: Event emitter**
  Implement `src/core/state/EventEmitter.ts`: a typed event emitter for core→renderer communication. Methods: `on(event, handler)`, `off(event, handler)`, `emit(event, data)`. Define an `EventMap` type listing all game events (initially a small set: `terrain:updated`, `blast:started`, `blast:ended`, `fragment:created`, `time:tick`).
  **Acceptance criteria:**
  - [x] Unit test: subscribing to an event and emitting it calls the handler with correct data
  - [x] Unit test: `off()` removes the handler; subsequent emits don't call it
  - [x] Unit test: multiple handlers on the same event all fire
  - [x] `npm run validate` passes

---

### Phase 2 — World and Terrain

- [x] **2.1: Rock catalog**
  **⚠ CREATIVE CHECKPOINT — Before finalizing, propose the full list of rock names (id + EN name + FR name + short description) to the human for approval. Include the numerical properties (fracture threshold, density, porosity) with a comment explaining the real-world basis.**
  Implement `src/core/world/RockCatalog.ts`. Define 8-12 fictional rock types with humorous names. Each rock type has: id, i18n name key, fracture threshold, porosity (0-1), density (kg/m³), hardness tier (1-5), ore probability distribution (map of ore_id → probability), texture color (placeholder). Provide both starter rocks (low threshold) and endgame rocks (high threshold). Research real-world rock properties (granite: ~2700 kg/m³, limestone: ~2500 kg/m³, etc.) and scale to game units. Add all names in en.json and fr.json.
  **Acceptance criteria:**
  - [x] **Human approved** rock names and descriptions
  - [x] Unit test: `getRock('cruite')` returns valid rock data with all required fields
  - [x] Unit test: all rock IDs are unique
  - [x] Unit test: ore probability distributions sum to ≤ 1.0 for each rock
  - [x] i18n: all rock names exist in both en.json and fr.json
  - [x] At least 8 rocks defined, spanning hardness tiers 1-5
  - [x] All numerical values documented with real-world basis in code comments
  - [x] `npm run validate` passes

- [x] **2.2: Ore catalog**
  **⚠ CREATIVE CHECKPOINT — Propose ore names and values to the human before finalizing.**
  Implement `src/core/world/OreCatalog.ts`. Define 6-10 fictional ore types with humorous names. Each ore has: id, i18n name key, base value per kg, rarity tier, color (for UI display). Include "Treranium" (très rare, very rare, highest value) and common bulk ores. Add all names in en.json and fr.json.
  **Acceptance criteria:**
  - [x] **Human approved** ore names
  - [x] Unit test: `getOre('treranium')` returns valid ore data
  - [x] Unit test: all ore IDs are unique
  - [x] Unit test: ores span a wide value range (cheap to very expensive)
  - [x] i18n: all ore names in both locales
  - [x] `npm run validate` passes

- [x] **2.3: Explosive catalog**
  **⚠ CREATIVE CHECKPOINT — Propose explosive names and descriptions to the human before finalizing. Include energy values with real-world basis (ANFO: ~3.4 MJ/kg, dynamite: ~7.5 MJ/kg, emulsion: ~3.8 MJ/kg) and explain the game-scaled values.**
  Implement `src/core/world/ExplosiveCatalog.ts`. Define 6-10 fictional explosives with humorous names. Each explosive has: id, i18n name key, energy per kg, cost per kg, water sensitivity (boolean), min/max charge per hole, rock tier requirement (minimum hardness it can fracture), blast radius modifier, projection risk modifier, vibration modifier. Range from cheap/weak starters to expensive/powerful endgame ("Dynatomics"). Add all names in en.json and fr.json.
  **Acceptance criteria:**
  - [x] **Human approved** explosive names and descriptions
  - [x] Unit test: `getExplosive('pop_rock')` returns valid explosive data
  - [x] Unit test: all explosive IDs are unique
  - [x] Unit test: explosives sorted by tier have increasing energy per kg
  - [x] Unit test: endgame explosive ("dynatomics") can fracture hardness tier 5 rocks
  - [x] i18n: all explosive names in both locales
  - [x] All energy values documented with real-world basis in code comments
  - [x] `npm run validate` passes

- [x] **2.4: VoxelGrid**
  Implement `src/core/world/VoxelGrid.ts`. A 3D grid where each cell holds: rock type ID (or empty), density (0-1, where 0 = empty/air), ore densities (map of ore_id → 0.0-1.0), fracture threshold modifier (for cracked rock). Methods: `getVoxel(x,y,z)`, `setVoxel(x,y,z,data)`, `clearVoxel(x,y,z)`, `getRegion(min,max)`, `isInBounds(x,y,z)`. Grid dimensions configurable.
  **Acceptance criteria:**
  - [x] Unit test: set and get a voxel at specific coordinates
  - [x] Unit test: `clearVoxel` sets density to 0
  - [x] Unit test: `getRegion` returns all voxels in a bounding box
  - [x] Unit test: `isInBounds` correctly rejects out-of-range coordinates
  - [x] Unit test: grid correctly stores ore density per voxel
  - [x] `npm run validate` passes

- [x] **2.5: Procedural terrain generation**
  Implement `src/core/world/TerrainGen.ts`. Given a seed, grid dimensions, and mine type preset, generate:
  - Surface height using layered simplex noise
  - Rock type distribution using noise-based biomes (transitions between rock types)
  - Ore vein distribution using separate noise layers per ore type, modulated by rock type probability
  - A central rocky extraction zone and a neutral dirt/sand border zone
  Use the seeded PRNG from task 1.1.
  **Acceptance criteria:**
  - [x] Unit test: same seed produces identical terrain
  - [x] Unit test: different seeds produce different terrain
  - [x] Unit test: surface voxels above ground are empty (density=0)
  - [x] Unit test: ore density is zero in the neutral border zone
  - [x] Unit test: ore density distribution roughly matches rock type probabilities over a large sample
  - [x] Integration test: `new_game` console command creates a game with a generated terrain
  - [x] `npm run validate` passes

- [x] **2.6: Mine type presets**
  Implement `src/core/world/MineType.ts`. Define 3-4 mine type presets (e.g., "desert", "mountain", "tropical", "arctic"). Each preset specifies: dominant rock types, ore richness, terrain shape parameters (flatness, elevation range), nearby settlement probability, climate bias. These feed into TerrainGen.
  **Acceptance criteria:**
  - [x] Unit test: each mine type produces terrain with its expected dominant rock
  - [x] Unit test: "desert" preset produces flatter terrain than "mountain"
  - [x] i18n: mine type names and descriptions in both locales
  - [x] Console command: `new_game mine_type:desert seed:42` uses the preset
  - [x] `npm run validate` passes

- [x] **2.7: Console commands — world inspection**
  Implement console commands: `inspect x,y,z` (show voxel data at coordinates), `terrain_info` (show grid dimensions, mine type, surface stats), `survey x,y` (reveal rock type and ore densities at a surface position — only if survey mechanic allows it; for now, allow free surveying). Wire commands in ConsoleRunner.
  **Acceptance criteria:**
  - [x] Integration test: `inspect 10,5,3` on a generated terrain returns rock type and density
  - [x] Integration test: `survey 25,30` returns human-readable rock and ore information
  - [x] Unknown coordinates return an informative error message
  - [x] `npm run validate` passes

---

### Phase 3 — Mining Mechanics (Console Mode)

- [x] **3.1: Survey system**
  Implement `src/core/mining/Survey.ts`. Surveying reveals voxel data at a position. Before surveying, the player does not know what's underground (fog of war on the voxel grid). Track which positions have been surveyed in GameState. Surveying costs money and requires an available surveyor employee (stub employee system for now — always allow). Add `survey x,y` console command that surveys a column of voxels at (x,y) down to a configurable depth.
  **Acceptance criteria:**
  - [x] Unit test: unsurveyed position returns "unknown"
  - [x] Unit test: after `performSurvey(state, x, y)`, the position data is revealed
  - [x] Unit test: surveying deducts cost from finances
  - [x] Unit test: re-surveying an already surveyed position is a no-op (no extra cost)
  - [x] Integration test: `survey 25,30` followed by `inspect 25,30,0` shows data
  - [x] `npm run validate` passes

- [x] **3.2: Drill plan**
  Implement `src/core/mining/DrillPlan.ts`. A drill plan defines a set of holes. Each hole has: position (x,y), depth, diameter. Support grid pattern generation: `createGridPlan(origin, rows, cols, spacing, depth, diameter)`. Also support manual hole placement: `addHole(plan, position, depth, diameter)`. Store the active drill plan in GameState.
  **Acceptance criteria:**
  - [x] Unit test: `createGridPlan({x:0,y:0}, 3, 4, 3, 8, 0.15)` creates 12 holes in correct positions
  - [x] Unit test: `addHole` appends a hole and assigns it a unique ID
  - [x] Unit test: grid spacing is correctly applied (distance between adjacent holes)
  - [x] Console command: `drill_plan grid origin:20,25 rows:3 cols:4 spacing:3 depth:8`
  - [x] Console command: `drill_plan add x:10 y:15 depth:6`
  - [x] Console command: `drill_plan show` lists all holes with positions and depths
  - [x] `npm run validate` passes

- [x] **3.3: Charge plan**
  Implement `src/core/mining/ChargePlan.ts`. For each hole in the drill plan, define: explosive type (from catalog), amount (kg), stemming height (meters). Support batch charging (`charge hole:* explosive:X amount:Y stemming:Z`) and per-hole charging. Validate: explosive must exist in catalog, amount within explosive's min/max range, stemming height ≤ hole depth.
  **Acceptance criteria:**
  - [x] Unit test: charging a hole stores explosive type and amount
  - [x] Unit test: batch charge `hole:*` charges all holes identically
  - [x] Unit test: invalid explosive ID returns an error
  - [x] Unit test: amount outside min/max range returns an error
  - [x] Unit test: stemming exceeding hole depth returns an error
  - [x] Console commands: `charge hole:1 explosive:pop_rock amount:3kg stemming:1.5m`, `charge hole:* ...`
  - [x] Console command: `charge show` lists charge plan per hole
  - [x] `npm run validate` passes

- [x] **3.4: Detonation sequence**
  Implement `src/core/mining/Sequence.ts`. A sequence assigns a delay (ms) to each hole. Support manual assignment and auto-generation. Auto sequence: V-pattern from the free face, with configurable inter-delay. Store sequence in GameState alongside the blast plan.
  **Acceptance criteria:**
  - [x] Unit test: `setDelay(hole:1, 0)`, `setDelay(hole:2, 25)` stores delays correctly
  - [x] Unit test: auto V-pattern generates increasing delays from the free face
  - [x] Unit test: auto sequence with `delay_step:25ms` for a 3x4 grid has correct timing spread
  - [x] Console commands: `sequence set hole:1 delay:0ms hole:2 delay:25ms`
  - [x] Console command: `sequence auto delay_step:25ms`
  - [x] Console command: `sequence show` displays timing for all holes
  - [x] `npm run validate` passes

- [x] **3.5: Blast plan composition**
  Implement `src/core/mining/BlastPlan.ts`. A blast plan combines: drill plan, charge plan, and sequence. It is the complete definition needed to execute a blast. Validate completeness: all holes must have charges and delays. Store as a named plan in GameState (player can have multiple saved plans).
  **Acceptance criteria:**
  - [x] Unit test: creating a blast plan from drill + charge + sequence succeeds when all holes are defined
  - [x] Unit test: validation fails if any hole is missing a charge
  - [x] Unit test: validation fails if any hole is missing a sequence delay
  - [x] Console command: `blast_plan save name:plan1` saves the current plan
  - [x] Console command: `blast_plan load name:plan1` loads a saved plan
  - [x] Console command: `blast_plan validate` checks completeness and reports issues
  - [x] `npm run validate` passes

- [x] **3.6: Blast energy calculation (core algorithm)**
  Implement `src/core/mining/BlastCalc.ts` following the algorithm in `.agent/BLAST_SYSTEM.md`. Implement:
  - `calculateHoleEnergy(charge, explosive)` → effective energy
  - `calculateEnergyField(point, holes)` → total energy at a point
  - `stemmingFactor(stemmingHeight, holeDepth)` → 0-1
  - `waterEffect(hole, explosive, weather)` → energy multiplier
  All pure functions, fully testable.
  **Acceptance criteria:**
  - [x] Unit test: energy decreases with distance from hole (inverse square)
  - [x] Unit test: multiple holes sum their energy at any point
  - [x] Unit test: stemming factor is 1.0 when stemming is adequate, <1.0 when insufficient
  - [x] Unit test: water-sensitive explosive in flooded hole without tubing → energy drops to ~10%
  - [x] Unit test: water-sensitive explosive with tubing → full energy
  - [x] Unit test: non-water-sensitive explosive in flooded hole → full energy
  - [x] `npm run validate` passes

- [x] **3.7: Fragmentation calculation**
  Implement fragmentation logic in `BlastCalc.ts` following `.agent/BLAST_SYSTEM.md`:
  - `calculateFragmentation(energy, rockThreshold)` → fractured/cracked/unaffected + fragment size
  - `calculateFragmentCount(voxelVolume, fragmentSize)` → number of fragments
  - `classifyProjection(initialSpeed, energyRatio)` → boolean
  - `calculateInitialVelocity(fragmentPos, holes, fragmentMass)` → Vec3
  All pure functions.
  **Acceptance criteria:**
  - [x] Unit test: energy below threshold → not fractured
  - [x] Unit test: energy between 0.5x and 1x threshold → cracked (threshold reduced)
  - [x] Unit test: energy between 1x and 2x threshold → good fragmentation (medium fragments)
  - [x] Unit test: energy between 2x and 4x threshold → fine fragmentation (small fragments)
  - [x] Unit test: energy above 4x threshold → dust + projection flag
  - [x] Unit test: fragment count * fragment volume ≈ voxel volume (conservation of mass)
  - [x] Unit test: initial velocity points away from nearest hole
  - [x] Unit test: projection classification threshold works correctly
  - [x] `npm run validate` passes

- [x] **3.8: Free face calculation**
  Implement `calculateFreeFace(holePosition, terrainState, sequence, currentTime)` in `BlastCalc.ts`. A hole has a free face factor based on how many of its neighboring voxels are empty (air or previously blasted). The sequence matters: holes that detonate after neighbors have already fired benefit from the newly created void.
  **Acceptance criteria:**
  - [x] Unit test: hole at terrain edge (open on one side) has free face > 0
  - [x] Unit test: hole completely surrounded by rock has free face ≈ 0
  - [x] Unit test: after simulating earlier holes in sequence, free face increases for later holes
  - [x] Unit test: free face factor affects fragmentation quality and vibration multiplier
  - [x] `npm run validate` passes

- [x] **3.9: Vibration calculation**
  Implement `calculateVibrations(blastPlan, terrainState, villagePositions)` in `BlastCalc.ts`. Use the formula from `.agent/BLAST_SYSTEM.md`: charge per delay, distance decay, ground factor. Calculate vibration levels at each village.
  **Acceptance criteria:**
  - [x] Unit test: single-delay blast (all holes at once) produces maximum vibration
  - [x] Unit test: well-spread sequence produces lower vibration
  - [x] Unit test: vibration decreases with distance from blast to village
  - [x] Unit test: higher charge per delay → higher vibration
  - [x] `npm run validate` passes

- [x] **3.10: Blast execution and result**
  Implement `executeBlast(state)` that orchestrates the full blast pipeline:
  1. Validate blast plan
  2. Time-step simulation: detonate holes per sequence timing
  3. Calculate energy field at each voxel in blast zone
  4. Determine fragmentation per voxel
  5. Generate fragment data objects (with rock type, ore density inherited from voxel)
  6. Subtract fractured voxels from terrain
  7. Calculate vibrations
  8. Produce `BlastResult` with full report (see `.agent/BLAST_SYSTEM.md`)
  9. Update scores (safety, nuisance)
  10. Store fragments in GameState
  **Acceptance criteria:**
  - [x] Integration test: full blast scenario with well-designed plan → fragments, no projections, "good" rating
  - [x] Integration test: overcharged blast → projections, "catastrophic" rating
  - [x] Integration test: undercharged blast on hard rock → unfractured, "bad" rating
  - [x] Integration test: terrain voxels are cleared after blast
  - [x] Integration test: fragment ore densities match parent voxels
  - [x] Console command: `blast` executes the current plan and prints the blast report
  - [x] `npm run validate` passes

- [x] **3.11: Blast preview (software tiers)**
  Implement `src/core/mining/Software.ts`. Track which software tier the player owns. Implement preview functions that calculate but don't execute: `previewEnergy(plan, terrain)`, `previewFragments(plan, terrain)`, `previewProjections(plan, terrain)`, `previewVibrations(plan, terrain, villages)`. Each function only returns data if the player owns the corresponding software tier.
  **Acceptance criteria:**
  - [x] Unit test: `previewEnergy` with tier 0 returns null (no software)
  - [x] Unit test: `previewEnergy` with tier ≥ 1 returns energy field data
  - [x] Unit test: `previewFragments` requires tier ≥ 2
  - [x] Unit test: `previewProjections` requires tier ≥ 3
  - [x] Unit test: `previewVibrations` requires tier ≥ 4
  - [x] Console command: `preview energy`, `preview fragments`, etc.
  - [x] Console command: `buy_software tier:2` purchases an upgrade
  - [x] `npm run validate` passes

- [x] **3.12: Ramp building**
  Implement `src/core/mining/Ramp.ts`. Ramps provide vehicle access to lower levels of the pit. A ramp is defined by start position, direction, and length. Building a ramp modifies the voxel grid (carves a slope). Ramps cost money and take time (ticks).
  **Acceptance criteria:**
  - [x] Unit test: `buildRamp` modifies voxel grid to create a sloped passage
  - [x] Unit test: ramp connects surface level to a lower elevation
  - [x] Unit test: ramp building deducts cost from finances
  - [x] Console command: `build ramp origin:8,12 direction:south length:10`
  - [x] `npm run validate` passes

- [x] **3.13: Weather system**
  Implement `src/core/weather/WeatherCycle.ts`. A state machine cycling through weather states: sunny, cloudy, light rain, heavy rain, storm, heat wave, cold snap. Transitions are probabilistic (seeded). Duration of each state varies. Implement `src/core/weather/WeatherEffects.ts`: rain fills drill holes (based on rock porosity), affecting explosive reliability. Track hole flooding state.
  **Acceptance criteria:**
  - [x] Unit test: weather cycle produces deterministic sequence from a given seed
  - [x] Unit test: weather transitions follow valid state transitions
  - [x] Unit test: heavy rain on porous rock floods unfilled holes
  - [x] Unit test: tubing prevents hole flooding
  - [x] Unit test: flooded hole + water-sensitive explosive → charge fails
  - [x] Console command: `weather` shows current weather
  - [x] Console command: `weather advance` moves to next weather state (for testing)
  - [x] `npm run validate` passes

- [x] **3.14: Tubing / casing system**
  Implement tubing as purchasable equipment. Player can buy tubing units and install them in specific drill holes. Tubing waterproofs the hole. Track tubing inventory and installation in GameState.
  **Acceptance criteria:**
  - [x] Unit test: buying tubing deducts money and adds to inventory
  - [x] Unit test: installing tubing on a hole marks it as waterproofed
  - [x] Unit test: installed tubing prevents water effect on explosives
  - [x] Unit test: cannot install tubing if none in inventory
  - [x] Console commands: `buy tubing amount:10`, `install_tubing hole:3`
  - [x] `npm run validate` passes

---

### Phase 4 — Economy (Console Mode)

- [x] **4.1: Finance system**
  Implement `src/core/economy/Finance.ts`. Track: cash balance, income history, expense history. Functions: `addIncome(state, amount, category, description)`, `addExpense(state, amount, category, description)`, `getBalance(state)`, `getFinancialReport(state, periodTicks)`. Categories: sales, contracts, salaries, equipment, fines, maintenance, fuel.
  **Acceptance criteria:**
  - [x] Unit test: initial balance is set from game config
  - [x] Unit test: addIncome increases balance
  - [x] Unit test: addExpense decreases balance
  - [x] Unit test: financial report correctly sums by category
  - [x] Unit test: balance going below 0 triggers bankruptcy flag
  - [x] Console command: `finances` shows balance and recent transactions
  - [x] `npm run validate` passes

- [x] **4.2: Contract system**
  Implement `src/core/economy/Contract.ts`. Define contract types:
  - Ore sale: sell rubble rich in specific ore for profit
  - Rubble disposal: pay to dispose of plain rubble (or get a buyer at low price)
  - Supply contracts: recurring delivery obligations
  Each contract has: material requirements, quantity, unit price, deadline (in ticks), penalty for breach, bonus for early completion.
  Implement `src/core/economy/Market.ts` to generate available contracts (seeded random, influenced by game progress and scores).
  **Acceptance criteria:**
  - [x] Unit test: generated contracts have valid fields within expected ranges
  - [x] Unit test: contract list refreshes periodically (new contracts appear)
  - [x] Unit test: accepting a contract adds it to active contracts
  - [x] Unit test: delivering materials against a contract updates progress
  - [x] Unit test: completing a contract credits payment
  - [x] Unit test: missing a deadline triggers penalty deduction
  - [x] Console commands: `contract list`, `contract accept 3`, `contract status`, `contract deliver 1 amount:50`
  - [x] `npm run validate` passes

- [x] **4.3: Contract negotiation**
  Implement negotiation in `Contract.ts`. When the player negotiates a contract, the outcome is probabilistic:
  - Success (probability influenced by scores and random): improved terms (better price, longer deadline, lower penalty)
  - Failure: terms stay the same or worsen (lower price, shorter deadline, higher penalty)
  - Negotiation skill could be a future upgrade
  **Acceptance criteria:**
  - [x] Unit test: negotiation with fixed seed produces deterministic outcome
  - [x] Unit test: successful negotiation improves at least one contract term
  - [x] Unit test: failed negotiation can worsen terms
  - [x] Unit test: probability of success is influenced by relevant scores
  - [x] Console command: `contract negotiate 3`
  - [x] `npm run validate` passes

- [x] **4.4: Fragment storage and logistics**
  Implement fragment storage in GameState. Fragments from blasts are initially on the ground. They must be picked up by vehicles and either sold (if matching a contract), stored (in a storage depot), or disposed of. Track: fragments on ground, fragments in storage, fragments in transit.
  **Acceptance criteria:**
  - [x] Unit test: after blast, fragments are in "on_ground" state
  - [x] Unit test: `pickupFragment(vehicle, fragment)` moves fragment to "in_transit"
  - [x] Unit test: delivering fragment to depot moves it to "stored"
  - [x] Unit test: selling fragment against contract credits income and reduces quantity
  - [x] Unit test: no available storage → cannot pick up more fragments (must sell or dispose)
  - [x] Console command: `fragments status` shows count by state
  - [x] `npm run validate` passes

---

### Phase 5 — Entities and Management (Console Mode)

- [x] **5.1: Building system**
  Implement `src/core/entities/Building.ts`. Building types: worker quarters, storage depot, vehicle depot, office, break room, canteen, medical bay, explosives magazine. Each building has: type, position (grid coordinates), size, construction cost, operating cost per tick, capacity (e.g., storage tons, employee slots), effect on scores. Buildings can be placed, relocated (at cost), and destroyed. Buildings hit by projections are destroyed.
  **Acceptance criteria:**
  - [x] Unit test: placing a building deducts cost and adds it to GameState
  - [x] Unit test: building operating costs are deducted each tick
  - [x] Unit test: storage depot increases storage capacity
  - [x] Unit test: worker quarters increase well-being score
  - [x] Unit test: destroying a building removes it and its effects
  - [x] Unit test: cannot place building on occupied space or outside bounds
  - [x] Console commands: `build quarters at:5,10`, `build list`, `build destroy 3`, `build move 3 to:8,12`
  - [x] i18n: all building names and descriptions in both locales
  - [x] `npm run validate` passes

- [x] **5.2: Vehicle system**
  Implement `src/core/entities/Vehicle.ts`. Vehicle types: truck, excavator, drill rig, bulldozer. Each vehicle has: type, purchase cost, maintenance cost per tick, fuel cost per tick, capacity (tons for trucks, dig rate for excavators), speed, current position, current task (idle/moving/working), health. Vehicles can be purchased, assigned to tasks, moved, and are destroyable by projections. Excavators are the key bottleneck — limited count, essential for loading rubble.
  **Acceptance criteria:**
  - [x] Unit test: purchasing a vehicle deducts cost and adds it to fleet
  - [x] Unit test: vehicle maintenance/fuel costs accumulate per tick
  - [x] Unit test: assigning a truck to transport rubble changes its state
  - [x] Unit test: excavator loading rate matches its capacity stat
  - [x] Unit test: destroyed vehicle is removed from fleet
  - [x] Console commands: `vehicle buy truck`, `vehicle list`, `vehicle assign 1 task:transport from:pit to:depot`, `vehicle move 1 to:20,15`
  - [x] i18n: vehicle type names in both locales
  - [x] `npm run validate` passes

- [x] **5.3: Employee system**
  Implement `src/core/entities/Employee.ts`. Employees have: name (generated), role (driller, blaster, driver, surveyor, manager), salary, morale (0-100), union status (boolean), injury status, alive status. Roles determine what tasks the employee can perform. Hiring costs money; salaries are ongoing expenses. Employees can receive raises (affects morale and well-being score). Unionized employees cannot be fired (unless... mafia path). Employee names generated from i18n name lists.
  **Acceptance criteria:**
  - [x] Unit test: hiring adds employee and deducts hiring cost
  - [x] Unit test: salaries are paid each pay cycle (configurable tick interval)
  - [x] Unit test: giving a raise increases salary and morale
  - [x] Unit test: low morale reduces employee effectiveness
  - [x] Unit test: injured employee cannot work until healed
  - [x] Unit test: unionized employee cannot be fired (returns error)
  - [x] Console commands: `employee hire role:driller`, `employee list`, `employee raise 3 amount:500`, `employee fire 5`
  - [x] `npm run validate` passes

- [x] **5.4: Score system**
  Implement `src/core/scores/ScoreManager.ts` and individual score modules: `WellBeing.ts`, `Safety.ts`, `Ecology.ts`, `Nuisance.ts`. Each score is 0-100, updated each tick based on current state. Score formulas account for: buildings, employee treatment, accident history, equipment investment, blast vibrations, dust, waste, etc. Scores influence event probabilities and contract terms.
  **Acceptance criteria:**
  - [x] Unit test: initial scores are at a neutral starting point (e.g., 50)
  - [x] Unit test: building worker quarters increases well-being
  - [x] Unit test: an accident decreases safety score
  - [x] Unit test: blast vibrations decrease nuisance score
  - [x] Unit test: investing in safety equipment increases safety score
  - [x] Unit test: scores are clamped to 0-100
  - [x] Console command: `scores` shows all four scores
  - [x] `npm run validate` passes

- [x] **5.5: Damage and casualty system**
  Implement damage processing: when a fragment (projection) hits a building, vehicle, or employee position, calculate damage based on fragment mass and velocity. Buildings have HP; vehicles have HP; employees can be injured or killed. Deaths trigger lawsuit events. Track accident history in GameState.
  **Acceptance criteria:**
  - [x] Unit test: fast heavy fragment hitting a building reduces its HP
  - [x] Unit test: building at 0 HP is destroyed
  - [x] Unit test: fragment hitting employee position injures/kills based on energy
  - [x] Unit test: death is recorded in accident history
  - [x] Unit test: death triggers a "lawsuit pending" flag
  - [x] Integration test: overcharged blast near buildings → building damage
  - [x] `npm run validate` passes

- [x] **5.6: Zone clearing and evacuation**
  Implement zone management: player can define a safety zone before a blast and order evacuation. All employees and vehicles within the zone are moved out. Failure to evacuate before blasting risks casualties. Implement `clearZone(state, bounds)` and `isZoneClear(state, bounds)`.
  **Acceptance criteria:**
  - [x] Unit test: `clearZone` moves all entities out of the defined area
  - [x] Unit test: `isZoneClear` returns true when no entities remain
  - [x] Unit test: blasting without clearing zone + projections → casualties
  - [x] Unit test: blasting after clearing zone → no casualties even with projections in the zone
  - [x] Console commands: `zone clear x1:10 y1:10 x2:30 y2:30`, `zone status`
  - [x] `npm run validate` passes

---

### Phase 6 — Event System (Console Mode)

- [x] **6.1: Event system engine**
  Implement `src/core/events/EventSystem.ts`. The engine manages event categories, each with its own timer. Each tick, timers count down. When a timer fires: check available events in the category, roll probability-weighted selection, fire the selected event. Timer reset value, probability weights, and event values are all functions of player scores. Implement `src/core/events/EventCategory.ts` and `src/core/events/EventPool.ts`.
  **Acceptance criteria:**
  - [x] Unit test: event timer counts down each tick
  - [x] Unit test: when timer reaches zero, an event is selected and fired
  - [x] Unit test: event selection respects probability weights
  - [x] Unit test: player scores modify probability weights correctly
  - [x] Unit test: unavailable events (prerequisites not met) are excluded from selection
  - [x] Unit test: timer reset interval depends on player scores
  - [x] `npm run validate` passes

- [x] **6.2: Event resolution system**
  Implement `src/core/events/EventResolver.ts`. Each event presents 2-4 decision options. Each option has consequences: score changes, financial effects, state changes (e.g., employee fired, building destroyed), and potential follow-up event triggers. Implement `resolveEvent(state, eventId, optionIndex)`.
  **Acceptance criteria:**
  - [x] Unit test: resolving an event with option 0 applies option 0's consequences
  - [x] Unit test: score changes from resolution are applied
  - [x] Unit test: financial effects from resolution are applied
  - [x] Unit test: follow-up events are queued when specified
  - [x] Console command: when an event fires, it prints options and waits for `event choose 2`
  - [x] `npm run validate` passes

- [x] **6.3: Union events (50-100 events)**
  **⚠ CREATIVE CHECKPOINT — Before generating all events, write 5 sample events with full structure (id, i18n text EN+FR, prerequisites, probability formula, severity scaling, 2-4 decision options with consequences). Present them to the human for tone/humor validation. Only proceed to generate the remaining 45-95 events after human approval.**
  Implement `src/core/events/UnionEvents.ts`. Create 50-100 union events ranging from realistic to absurd. Examples: strike threats, wage demands, safety complaints, overtime protests, holiday requests, ergonomic chair demands, mandatory karaoke night, protest against "casual Friday" abolition, demand for artisanal coffee machine, solidarity with foreign mine workers, etc. Each event has score-dependent severity, probability, and decision options with varied consequences. Add all text to i18n files.
  **Acceptance criteria:**
  - [x] **Human approved** sample events before mass generation
  - [x] At least 50 unique union events defined
  - [x] Each event has 2-4 decision options with distinct consequences
  - [x] Event severity/values scale with worker well-being and safety scores
  - [x] Low well-being → more frequent and severe union events
  - [x] i18n: all event text in both en.json and fr.json
  - [x] Unit test: at least 3 representative events tested for triggering and resolution
  - [x] `npm run validate` passes

- [x] **6.4: Political and external events (50-100 events)**
  **⚠ CREATIVE CHECKPOINT — Same process as 6.3: write 5 sample events, present to human, get approval before generating the rest.**
  Implement `src/core/events/PoliticsEvents.ts`. Events: war affecting suppliers (price spikes), competitor mine opening (contract price drops), eco blockades, government regulation changes, tax audits, diplomatic incidents, export bans, labor law reforms, election results affecting mining policy, international ore price fluctuations, etc. Mix realistic and satirical.
  **Acceptance criteria:**
  - [x] **Human approved** sample events before mass generation
  - [x] At least 50 unique political/external events
  - [x] Each event has 2-4 decision options
  - [x] Events affect finances, contract availability, and scores
  - [x] i18n: all text in both locales
  - [x] Unit test: at least 3 representative events tested
  - [x] `npm run validate` passes

- [x] **6.5: Weather events (50-100 events)**
  **⚠ CREATIVE CHECKPOINT — Same process as 6.3: write 5 sample events, present to human, get approval before generating the rest.**
  Implement `src/core/events/WeatherEvents.ts`. These are triggered by the weather system interacting with game state. Events: flooding of pit level, lightning strikes, mudslides, equipment frozen, worker heatstroke, drought affecting dust levels, unexpected frost damaging equipment, tornado warning, acid rain (industrial neighbor), etc.
  **Acceptance criteria:**
  - [x] **Human approved** sample events before mass generation
  - [x] At least 50 unique weather events
  - [x] Events are influenced by current weather state
  - [x] Each event has decision options
  - [x] i18n: all text in both locales
  - [x] Unit test: at least 3 representative events tested
  - [x] `npm run validate` passes

- [x] **6.6: Mafia events (50-100 events)**
  **⚠ CREATIVE CHECKPOINT — Same process as 6.3: write 5 sample events, present to human, get approval before generating the rest.**
  Implement `src/core/events/MafiaEvents.ts`. Only available after player has engaged in corruption. Events: protection racket offers, smuggling opportunities, blackmail, rival gang interference, informant risks, witness disappearances, money laundering opportunities, FBI investigation rumor, undercover agent infiltration, etc. High risk/reward, escalating danger.
  **Acceptance criteria:**
  - [x] **Human approved** sample events before mass generation
  - [x] At least 50 unique mafia events
  - [x] Events only available after corruption flag is set
  - [x] Escalation: early events are mild, later ones are dangerous
  - [x] Decision options include risk/reward tradeoffs
  - [x] i18n: all text in both locales
  - [x] Unit test: mafia events don't appear without corruption prerequisite
  - [x] Unit test: at least 3 representative events tested
  - [x] `npm run validate` passes

- [x] **6.7: Lawsuit events (50-100 events)**
  **⚠ CREATIVE CHECKPOINT — Same process as 6.3: write 5 sample events, present to human, get approval before generating the rest.**
  Implement `src/core/events/LawsuitEvents.ts`. Triggered by accidents, deaths, environmental damage. Events: family lawsuit, class action, government investigation, environmental agency audit, worker compensation claims, wrongful death suit, property damage claim from neighbors, corporate negligence charge, etc. Include corruption option (bribe judge).
  **Acceptance criteria:**
  - [x] **Human approved** sample events before mass generation
  - [x] At least 50 unique lawsuit events
  - [x] Events triggered by accident history and score thresholds
  - [x] Settlement/trial/corruption decision options
  - [x] Financial consequences scale with severity
  - [x] Too many lawsuits → game-ending criminal charges
  - [x] i18n: all text in both locales
  - [x] Unit test: at least 3 representative events tested
  - [x] `npm run validate` passes

- [x] **6.8: Corruption system**
  Implement `src/core/economy/Corruption.ts`. Player can attempt corruption in specific contexts: lawsuit (bribe judge), union (bribe leader), inspection (bribe inspector). Each attempt is a probability roll: success → problem solved, failure → scandal (worse consequences than original problem). Corruption attempts cost money. Track corruption history; too much corruption opens mafia storyline and increases risk of exposure.
  **Acceptance criteria:**
  - [x] Unit test: corruption attempt deducts cost
  - [x] Unit test: successful corruption removes the original problem
  - [x] Unit test: failed corruption triggers a scandal event
  - [x] Unit test: corruption history accumulates and increases failure probability
  - [x] Unit test: reaching corruption threshold unlocks mafia events
  - [x] Console command: `corrupt target:judge cost:50000`
  - [x] `npm run validate` passes

- [x] **6.9: Mafia gameplay mechanics**
  Implement mafia-specific actions: arranging "accidents" for troublesome unionized employees, framing employees for crimes to justify firing, smuggling operations for side income. Each action has: cost, success probability, exposure risk, consequences of failure.
  **Acceptance criteria:**
  - [x] Unit test: "accident" arrangement removes the targeted employee if successful
  - [x] Unit test: failed "accident" triggers investigation event
  - [x] Unit test: framing an employee requires planting evidence (cost + time)
  - [x] Unit test: smuggling generates income but increases exposure risk
  - [x] Unit test: exposure leads to criminal charges (potential game over)
  - [x] Console commands: `mafia accident employee:5`, `mafia frame employee:3`, `mafia smuggle`
  - [x] `npm run validate` passes

- [x] **6.10: Time acceleration**
  Implement time controls in GameLoop. Player can set speed to 1x, 2x, 4x, 8x or pause. Some events auto-pause the game (blast execution, event resolution requiring player decision). Ensure all systems (timers, weather, costs) scale correctly with time.
  **Acceptance criteria:**
  - [x] Unit test: at 4x speed, event timers count down 4x faster
  - [x] Unit test: costs accumulate 4x faster at 4x speed
  - [x] Unit test: blast event triggers auto-pause
  - [x] Unit test: event requiring decision triggers auto-pause
  - [x] Console commands: `time pause`, `time resume`, `time speed 4x`
  - [x] `npm run validate` passes

---

### Phase 7 — Campaign, World Map, and Win/Lose Conditions

- [x] **7.1: Level definition system**
  **⚠ CREATIVE CHECKPOINT — Propose the 3 level names, descriptions (EN+FR), and difficulty parameters to the human for approval before finalizing.**
  Implement `src/core/campaign/Level.ts`. A level represents a single mine site with specific parameters. Each level defines: id, i18n name and description, mine type preset, terrain seed, grid dimensions, starting cash, available rock types, available explosives (some locked until later levels), unlock threshold (cumulative profit needed to complete the level), difficulty modifiers (event frequency multiplier, contract price multiplier, score decay rate). Define **3 levels** with progressive difficulty:
  - **Level 1 — "Dusty Hollow"**: Small desert quarry, soft rocks, basic explosives, generous contracts, low event frequency, forgiving scores. Tutorial-friendly. Unlock threshold: low profit target.
  - **Level 2 — "Grumpstone Ridge"**: Medium mountain site, mixed rock hardness, mid-tier explosives, tighter contracts, moderate events, neighboring village (nuisance matters). Unlock threshold: medium profit.
  - **Level 3 — "Treranium Depths"**: Large tropical site, hard rocks including endgame, all explosives, demanding contracts, frequent events, multiple villages, mafia presence, weather complications. Unlock threshold: high profit.
  Add all level names and descriptions in en.json and fr.json.
  **Acceptance criteria:**
  - [x] **Human approved** level names, descriptions, and difficulty curve
  - [x] Unit test: `getLevel('dusty_hollow')` returns valid level data with all required fields
  - [x] Unit test: all 3 levels defined with increasing difficulty modifiers
  - [x] Unit test: level 1 has lower unlock threshold than level 2, which has lower than level 3
  - [x] Unit test: level 3 includes all explosive types, level 1 only includes starter explosives
  - [x] i18n: all level names and descriptions in both locales
  - [x] `npm run validate` passes

- [x] **7.2: Campaign state and progression**
  Implement `src/core/campaign/Campaign.ts`. Campaign state tracks: which levels are unlocked, which are completed, cumulative profit per level, current active level. At game start, only level 1 is unlocked. Completing a level (reaching its profit threshold) unlocks the next level. The player can replay any unlocked level. Campaign state is saved alongside game state (included in save slots).
  **Acceptance criteria:**
  - [x] Unit test: new campaign has only level 1 unlocked
  - [x] Unit test: reaching profit threshold on level 1 unlocks level 2
  - [x] Unit test: reaching profit threshold on level 2 unlocks level 3
  - [x] Unit test: completing all 3 levels is tracked as campaign complete
  - [x] Unit test: player can start a new game on any unlocked level
  - [x] Unit test: campaign state serializes/deserializes correctly with SaveLoad
  - [x] Console command: `campaign status` shows unlocked levels and progress per level
  - [x] `npm run validate` passes

- [x] **7.3: Level completion and transition**
  When a level's profit threshold is reached, trigger a `level:complete` event. The player receives a completion summary (total profit, blasts performed, casualties, scores). They can then choose to continue playing the current level or return to the world map to start the next one. Starting a new level creates a fresh GameState with the level's parameters but retains the campaign progression data.
  **Acceptance criteria:**
  - [x] Unit test: profit reaching threshold triggers level complete flag
  - [x] Unit test: level completion summary contains correct stats
  - [x] Unit test: starting a new level resets GameState but preserves campaign state
  - [x] Unit test: continuing after completion allows further play on same level
  - [x] Console command: `campaign complete` (debug) force-completes current level
  - [x] Console command: `campaign start level:grumpstone_ridge` starts a specific unlocked level
  - [x] `npm run validate` passes

- [x] **7.4: Bankruptcy**
  If cash balance drops below a configurable threshold for a sustained period (e.g., 100 ticks), trigger game over for the current level. The player is returned to the world map and can retry the level. Provide warnings at low balance.
  **Acceptance criteria:**
  - [x] Unit test: sustained negative balance triggers bankruptcy
  - [x] Unit test: temporary negative balance followed by income does not trigger
  - [x] Unit test: warning event fires when balance is low
  - [x] Unit test: bankruptcy does not reset campaign progression (only current level fails)
  - [x] `npm run validate` passes

- [x] **7.5: Criminal arrest**
  If corruption/mafia exposure reaches critical level, trigger arrest and game over for the current level. Player returns to world map.
  **Acceptance criteria:**
  - [x] Unit test: exposure level above threshold triggers arrest
  - [x] Unit test: arrest ends the current level (not the campaign)
  - [x] `npm run validate` passes

- [x] **7.6: Ecological disaster**
  If ecology score stays at 0 for a sustained period, government shuts down the mine. Game over for the current level.
  **Acceptance criteria:**
  - [x] Unit test: sustained 0 ecology → shutdown game over
  - [x] Unit test: recovering ecology in time prevents shutdown
  - [x] `npm run validate` passes

- [x] **7.7: Worker revolt**
  If well-being score stays at 0 for a sustained period, permanent strike — game over for the current level.
  **Acceptance criteria:**
  - [x] Unit test: sustained 0 well-being → revolt game over
  - [x] `npm run validate` passes

- [x] **7.8: Success tracking per level**
  Track per-level statistics: total wealth accumulated, mine depth reached, unique ore types extracted, total rock volume blasted, blasts performed, casualties, best scores achieved. These display on the world map for completed levels and contribute to a star/medal rating system (e.g., 1-3 stars based on efficiency, safety, profit margin).
  **Acceptance criteria:**
  - [x] Unit test: wealth tracker accumulates over time within a level
  - [x] Unit test: depth tracker updates after blasts
  - [x] Unit test: ore extraction tracker counts unique types
  - [x] Unit test: star rating calculated correctly from stats (e.g., 3 stars = high profit, zero casualties, good ecology)
  - [x] Console command: `stats` shows all success metrics for current level
  - [x] `npm run validate` passes

---

### Phase 8 — Physics Integration

- [x] **8.1: Physics world setup**
  Implement `src/physics/PhysicsWorld.ts`. Wrapper around Cannon-es world. Methods: `init()`, `step(dt)`, `addBody(shape, mass, position)`, `removeBody(id)`, `clear()`. Physics runs only during blast events.
  **Acceptance criteria:**
  - [x] Unit test: creating a physics world and stepping it doesn't crash
  - [x] Unit test: adding a body and stepping → body falls due to gravity
  - [x] Unit test: `clear()` removes all bodies
  - [x] `npm run validate` passes

- [x] **8.2: Terrain collision body**
  Implement `src/physics/TerrainBody.ts`. Creates a static collision shape from the voxel grid surface. Must be updated after each blast (terrain has changed).
  **Acceptance criteria:**
  - [x] Unit test: a dynamic body dropped onto terrain collider comes to rest above surface
  - [x] Unit test: after terrain modification, collider updates accordingly
  - [x] `npm run validate` passes

- [x] **8.3: Fragment physics bodies**
  Implement `src/physics/FragmentBody.ts`. For each fragment from a blast, create a Cannon-es rigid body with appropriate mass, shape (box approximation), and initial velocity. Let them simulate until they settle (velocity below threshold).
  **Acceptance criteria:**
  - [x] Unit test: fragment with upward velocity follows ballistic arc
  - [x] Unit test: fragment settles on terrain after some time
  - [x] Unit test: fragment final position is stored back in GameState
  - [x] `npm run validate` passes

- [x] **8.4: Collision damage handler**
  Implement `src/physics/CollisionHandler.ts`. When a fragment collides with a building, vehicle, or employee position, calculate damage based on impact energy (mass * velocity²). Apply damage to the hit entity.
  **Acceptance criteria:**
  - [x] Unit test: high-energy collision destroys building
  - [x] Unit test: low-energy collision damages but doesn't destroy
  - [x] Unit test: fragment hitting employee position triggers casualty
  - [x] Unit test: collision events are recorded in GameState
  - [x] `npm run validate` passes

- [x] **8.5: Full blast physics integration test**
  Create a comprehensive integration test that:
  1. Sets up a game with terrain, buildings, and employees
  2. Designs a deliberately overcharged blast plan
  3. Executes the blast through the full pipeline (core calc → physics sim → damage)
  4. Verifies: fragments exist, projections flew, building damaged, casualty recorded
  **Acceptance criteria:**
  - [x] Integration test passes with deterministic seed
  - [x] Blast report matches expected outcome
  - [x] State is consistent after blast (no dangling references)
  - [x] `npm run validate` passes

---

### Phase 9 — 3D Rendering

- [x] **9.1: Scene manager and console bridge**
  Implement `src/renderer/SceneManager.ts`. Initialize Three.js: scene, perspective camera, directional + ambient lights, renderer targeting the canvas element. Implement a render loop that runs at 60fps independently of game ticks. Cartoon-style lighting (simple, bright, minimal shadows initially). Also in `src/main.ts`, expose `window.__gameConsole(cmd: string)` — a global function that routes commands to the same `ConsoleRunner` used in CLI mode. This bridge is required for the screenshot script (`scripts/screenshot.ts`) to execute game commands in headless Chrome.
  **Acceptance criteria:**
  - [x] The game renders an empty scene with a sky-colored background
  - [x] Camera is positioned to overlook the terrain area
  - [x] `window.__gameConsole('help')` is callable from the browser console and returns command list
  - [x] Visual test: screenshot shows empty scene with correct lighting
  - [x] `npm run validate` passes

- [x] **9.2: Camera controller**
  Implement `src/renderer/CameraController.ts`. Orbit, pan, zoom controls. Mouse drag to orbit, right-drag or middle-drag to pan, scroll to zoom. Touch support for mobile.
  **Acceptance criteria:**
  - [x] Camera responds to orbit/pan/zoom inputs
  - [x] Camera has min/max zoom limits
  - [x] Camera cannot go below terrain surface
  - [x] `npm run validate` passes

- [x] **9.3: Terrain mesh (marching cubes)**
  Implement `src/renderer/TerrainMesh.ts`. Convert the VoxelGrid to a Three.js mesh using marching cubes algorithm. Support chunk-based rendering (divide grid into chunks; only re-mesh modified chunks). Apply rock-type-based colors to vertices. Terrain updates when voxels change (after blasts).
  **Acceptance criteria:**
  - [x] Visual test: generated terrain renders as a smooth, hilly surface
  - [x] Visual test: different rock types show different colors
  - [x] After clearing voxels (simulating blast), mesh updates to show crater
  - [x] Performance: re-meshing a single chunk takes < 50ms
  - [x] `npm run validate` passes

- [x] **9.4: Procedural rock textures**
  Implement `src/renderer/ProceduralTexture.ts`. Generate 3D procedural textures for rock types using noise functions. Textures are coherent in 3D space so that after fragmentation, fragment surfaces show consistent texture (not random). Different rock types have different texture patterns and colors. Textures interpolate at rock type boundaries.
  **Acceptance criteria:**
  - [x] Visual test: terrain surface has varied, natural-looking texture per rock type
  - [x] Visual test: rock type boundaries show smooth color transitions
  - [x] Fragment meshes (when added) inherit texture from their parent voxel location
  - [x] `npm run validate` passes

- [x] **9.5: Fragment meshes**
  Implement `src/renderer/FragmentMesh.ts`. Render each fragment as a rough-shaped mesh (irregular box or low-poly shape). Fragments are colored based on rock type and show ore streaks for high-ore-density fragments. Fragment meshes are synchronized with physics positions during blast simulation.
  **Acceptance criteria:**
  - [x] Visual test: after blast, terrain crater is filled with visible fragment meshes
  - [x] Fragments are sized proportionally to their data
  - [x] Ore-rich fragments are visually distinguishable
  - [x] During physics sim, fragments move in real-time
  - [x] `npm run validate` passes

- [x] **9.6: Building meshes (placeholders)**
  Implement `src/renderer/BuildingMesh.ts`. Each building type has a simple placeholder mesh: colored boxes, cylinders, etc. Different colors per building type. Buildings appear at their grid position with correct footprint.
  **Acceptance criteria:**
  - [x] Visual test: placing a building shows its placeholder mesh at correct position
  - [x] Different building types have visually distinct placeholders
  - [x] Destroyed buildings are removed from the scene
  - [x] `npm run validate` passes

- [x] **9.7: Vehicle meshes (placeholders)**
  Implement `src/renderer/VehicleMesh.ts`. Placeholder meshes: truck = yellow box on wheels, excavator = yellow box with arm (cylinder), drill rig = tall cylinder, bulldozer = low box with blade. Vehicles move along paths and animate working actions (simplified).
  **Acceptance criteria:**
  - [x] Visual test: vehicles render at their positions with identifiable shapes
  - [x] Vehicles move smoothly when assigned tasks
  - [x] Different vehicle types are visually distinct
  - [x] `npm run validate` passes

- [x] **9.8: Character meshes (placeholders)**
  Implement `src/renderer/CharacterMesh.ts`. Minion-style placeholder: capsule body, sphere head, solid color. Employees stand at their work positions. Injured employees could have a different color. Characters evacuate during zone clearing.
  **Acceptance criteria:**
  - [x] Visual test: employees render as Minion-like shapes at work positions
  - [x] Characters move when zone clearing is activated
  - [x] Different roles could have different colors (optional for placeholder phase)
  - [x] `npm run validate` passes

- [x] **9.9: Skybox and weather visuals**
  Implement `src/renderer/SkyboxWeather.ts`. Sky color changes based on weather state: sunny = blue, cloudy = gray, rain = dark gray with particle effect (rain drops), storm = very dark with flashes. Simple weather particle systems.
  **Acceptance criteria:**
  - [x] Visual test: sky color matches current weather state
  - [x] Rain shows falling particle effect
  - [x] Weather transition is smooth (gradual color change)
  - [x] `npm run validate` passes

- [x] **9.10: Blast visual effects**
  Implement blast visuals: explosion flash, dust cloud (particle system), flying fragments, screen shake. Synchronize with the physics simulation timing. Detonation sequence should be visible (holes fire at their designated times with visual flash per hole).
  **Acceptance criteria:**
  - [x] Visual test: blast shows sequential flashes per hole
  - [x] Dust cloud particle effect appears post-blast
  - [x] Fragments fly visually during physics simulation
  - [x] Camera shakes proportionally to blast energy
  - [x] `npm run validate` passes

- [x] **9.11: Distant scenery**
  Implement decorative distant scenery: low-poly mountains, plains, forests, fields placed far from the interactive zone. These are purely cosmetic, no interaction. Generated based on mine type.
  **Acceptance criteria:**
  - [x] Visual test: horizon shows mountains/terrain features
  - [x] Scenery varies by mine type preset
  - [x] Scenery does not affect performance (very low poly, static)
  - [x] `npm run validate` passes

- [x] **9.12: Blast plan visualization overlays**
  When the player is editing a blast plan, show visual overlays on the terrain:
  - Drill holes as cylinders/lines
  - Charge amounts as color-coded indicators
  - Sequence delays as numbered labels
  - Software tier previews: energy heatmap (tier 1), fragment size overlay (tier 2), projection arcs (tier 3), vibration waves (tier 4)
  **Acceptance criteria:**
  - [x] Visual test: drill holes render as markers on terrain
  - [x] Visual test: charge plan shows color-coded hole fills
  - [x] Visual test: sequence numbers visible on holes
  - [x] Visual test: energy heatmap overlay (if software owned) shows on terrain
  - [x] `npm run validate` passes

---

### Phase 10 — User Interface

- [ ] **10.1: HUD**
  Implement `src/ui/HUD.ts`. HTML overlay showing: cash balance, current time/date, time speed, all four scores as bars, active event notification, current weather icon. Positioned at screen edges, non-intrusive.
  **Acceptance criteria:**
  - [ ] HUD displays current balance updated in real-time
  - [ ] Score bars reflect current score values
  - [ ] Time speed indicator shows current setting and is clickable to change
  - [ ] Weather icon matches current weather
  - [ ] `npm run validate` passes

- [ ] **10.2: Blast plan editor UI**
  Implement `src/ui/BlastPlanUI.ts`. Interactive interface for designing blast plans:
  - Click terrain to place drill holes, or use grid tool
  - Select holes to set charges (dropdown for explosive type, slider for amount)
  - Sequence editor: drag to reorder, set delays
  - Preview button (triggers software overlays if owned)
  - Execute button (with confirmation dialog)
  **Acceptance criteria:**
  - [ ] Can place holes by clicking on terrain
  - [ ] Can set charge type and amount per hole via UI controls
  - [ ] Sequence editor allows setting delays
  - [ ] Preview button activates overlay if software is owned
  - [ ] Execute button triggers blast with confirmation
  - [ ] All UI text uses i18n
  - [ ] `npm run validate` passes

- [ ] **10.3: Contract UI**
  Implement `src/ui/ContractUI.ts`. Show available contracts in a list. Each contract shows: material, quantity, price, deadline, penalty. Buttons: accept, negotiate, decline. Active contracts panel shows progress toward delivery.
  **Acceptance criteria:**
  - [ ] Available contracts render with all details
  - [ ] Accept/negotiate/decline buttons work correctly
  - [ ] Negotiation result is shown with updated terms
  - [ ] Active contracts show progress bars
  - [ ] All text uses i18n
  - [ ] `npm run validate` passes

- [ ] **10.4: Build menu**
  Implement `src/ui/BuildMenu.ts`. Grid of available building types with icons, names, costs. Click to enter placement mode (ghost building follows cursor on terrain). Click to place, right-click to cancel. Tooltip shows building effects.
  **Acceptance criteria:**
  - [ ] Building menu shows all building types with costs
  - [ ] Placement mode shows ghost building at cursor position
  - [ ] Valid placement locations highlighted in green, invalid in red
  - [ ] Placing a building updates GameState and renders the building
  - [ ] `npm run validate` passes

- [ ] **10.5: Vehicle management panel**
  Implement `src/ui/VehiclePanel.ts`. List of owned vehicles with type, status, current task, health. Buttons: buy new, assign task, move, scrap. Task assignment shows available tasks (transport, dig, drill, build).
  **Acceptance criteria:**
  - [ ] Vehicle list shows all fleet vehicles
  - [ ] Can buy new vehicles
  - [ ] Can assign vehicles to tasks
  - [ ] Vehicle status updates in real-time
  - [ ] `npm run validate` passes

- [ ] **10.6: Employee management panel**
  Implement `src/ui/EmployeePanel.ts`. List of employees with name, role, salary, morale, union status, health. Buttons: hire, fire, raise. Sorting and filtering by role.
  **Acceptance criteria:**
  - [ ] Employee list shows all employees
  - [ ] Can hire new employees by role
  - [ ] Fire button works (except for unionized employees — show error)
  - [ ] Raise button adjusts salary and morale
  - [ ] `npm run validate` passes

- [ ] **10.7: Event dialog**
  Implement `src/ui/EventDialog.ts`. When an event fires, show a popup dialog with: event title, narrative text, 2-4 decision buttons. Each button shows a brief description of the option. After choosing, show outcome text. Auto-pauses the game.
  **Acceptance criteria:**
  - [ ] Event dialog appears when an event fires
  - [ ] Game pauses while dialog is open
  - [ ] Decision buttons trigger event resolution
  - [ ] Outcome text is displayed after resolution
  - [ ] Dialog can be dismissed to resume game
  - [ ] All text uses i18n
  - [ ] `npm run validate` passes

- [ ] **10.8: Survey UI**
  Implement `src/ui/SurveyUI.ts`. Click terrain to survey. Show results as a popup or panel: rock type, ore densities as colored bars, depth profile.
  **Acceptance criteria:**
  - [ ] Clicking terrain in survey mode triggers a survey
  - [ ] Results show rock type and ore densities clearly
  - [ ] Already-surveyed locations show data without re-surveying
  - [ ] `npm run validate` passes

- [ ] **10.9: Settings menu**
  Implement `src/ui/SettingsMenu.ts`. Options: language selector (en/fr), audio volume (master, effects, music), game speed, save game, load game, quit.
  **Acceptance criteria:**
  - [ ] Language change immediately updates all UI text
  - [ ] Save/load buttons work correctly
  - [ ] All text uses i18n
  - [ ] `npm run validate` passes

- [ ] **10.10: Mini-map**
  Small overview map in corner showing: terrain outline, building positions, vehicle positions, blast zone indicators. Clickable to jump camera to location.
  **Acceptance criteria:**
  - [ ] Mini-map renders in screen corner
  - [ ] Shows buildings and vehicles as colored dots
  - [ ] Clicking mini-map moves main camera
  - [ ] `npm run validate` passes

---

### Phase 11 — Audio

- [ ] **11.1: Audio manager**
  Implement `src/audio/AudioManager.ts`. Central audio system using Web Audio API. Support: play sound effect (one-shot), play looping ambient, adjust volume per category (master, effects, ambient, UI). Mute toggle.
  **Acceptance criteria:**
  - [ ] Playing a sound effect produces output (or successfully calls Web Audio API)
  - [ ] Volume adjustment works per category
  - [ ] Mute toggle silences everything
  - [ ] `npm run validate` passes

- [ ] **11.2: Placeholder sounds**
  Implement `src/audio/Placeholder.ts`. Generate simple synthesized placeholder sounds using Web Audio API oscillators: beep (UI click), boom (explosion), rumble (earthquake/blast), chime (event notification), ambient hum (general), engine (vehicle), drill whirr, rain patter. Each sound is programmatically generated — no external files needed.
  **Acceptance criteria:**
  - [ ] Each placeholder sound is distinct and identifiable
  - [ ] Sounds trigger at correct game events (blast, UI click, event, etc.)
  - [ ] Sound system is designed so placeholders can be replaced with real audio files later
  - [ ] `npm run validate` passes

- [ ] **11.3: Audio event hooks**
  Wire audio triggers to game events: blast detonation → boom per hole (timed to sequence), fragment impact → thud, UI button click → beep, event notification → chime, vehicle movement → engine loop, weather rain → rain loop, etc.
  **Acceptance criteria:**
  - [ ] Blast plays a boom sound per detonating hole at the correct timing
  - [ ] UI interactions play feedback sounds
  - [ ] Weather sounds match weather state
  - [ ] `npm run validate` passes

---

### Phase 12 — Polish and Deployment

- [ ] **12.1: Game balance pass**
  Review and adjust all numerical values: costs, revenues, fragment sizes, energy thresholds, score impacts, event frequencies, timer durations. Use console mode to simulate 30-minute play sessions and verify the game is neither too easy nor too hard. Document balance values in a config file for easy tuning.
  **Acceptance criteria:**
  - [ ] All balance values are in a centralized config file (not hardcoded in logic)
  - [ ] Integration test: 30-minute simulation doesn't lead to instant bankruptcy or runaway profit
  - [ ] Event frequency feels appropriate (not overwhelming, not too rare)
  - [ ] `npm run validate` passes

- [ ] **12.2: Comprehensive i18n review**
  Audit all game text and ensure EVERY user-facing string goes through i18n. Check for missing translations. Verify interpolation works for all dynamic strings. Ensure fictional names are consistent across locales.
  **Acceptance criteria:**
  - [ ] No hardcoded user-facing strings in any source file (grep test)
  - [ ] en.json and fr.json have identical keys
  - [ ] All interpolated strings work correctly in both locales
  - [ ] `npm run validate` passes

- [ ] **12.3: Save/Load UI integration**
  Ensure save/load works end-to-end with the persistence layer from task 1.3. On web: use IndexedDB as primary backend; offer "Export Save" (file download) and "Import Save" (file picker) as secondary option. On local/desktop: use file-based saves. Save from settings menu or auto-save at configurable intervals. Load from settings menu, game start screen, or world map. Each save slot displays: slot name, timestamp, current level, campaign progress, cash balance snapshot.
  **Acceptance criteria:**
  - [ ] Saving and loading restores exact game state including campaign progression
  - [ ] Auto-save triggers periodically
  - [ ] Load screen shows saved games with metadata (timestamp, level, progress)
  - [ ] Web: IndexedDB persistence works across page reloads
  - [ ] Web: export/import via file download/upload works as fallback
  - [ ] Local: file-based saves work correctly
  - [ ] Multiple save slots supported (at least 5)
  - [ ] `npm run validate` passes

- [ ] **12.4: Tutorial / first-time experience**
  Add a simple tutorial sequence for new players: guided survey → first drill plan → first blast → first contract. Uses event system to deliver step-by-step instructions. Can be skipped.
  **Acceptance criteria:**
  - [ ] New game offers tutorial prompt
  - [ ] Tutorial guides player through core gameplay loop
  - [ ] Tutorial can be skipped
  - [ ] All tutorial text uses i18n
  - [ ] `npm run validate` passes

- [ ] **12.5: Performance optimization**
  Profile and optimize: marching cubes chunk updates, physics step duration, fragment count limits, render distance culling, texture generation caching. Target: 60fps with 2000 fragments on screen.
  **Acceptance criteria:**
  - [ ] 60fps maintained with 2000 fragments
  - [ ] Blast with max fragments doesn't freeze the game
  - [ ] Chunk re-meshing is localized (doesn't touch unaffected chunks)
  - [ ] `npm run validate` passes

- [ ] **12.6: Itch.io deployment build**
  Configure Vite for production build optimized for itch.io: single HTML file with inlined assets (or minimal asset structure), compression, appropriate meta tags. Create a build script and document deployment steps.
  **Acceptance criteria:**
  - [ ] `npm run build` produces a deployable dist/ folder
  - [ ] dist/ can be uploaded to itch.io and runs as HTML5 game
  - [ ] Game loads and plays correctly from the built version
  - [ ] `npm run validate` passes

- [ ] **12.7: Keyboard shortcuts and accessibility**
  Add keyboard shortcuts for common actions: spacebar = pause/resume, 1-4 = time speed, B = build menu, V = vehicle panel, E = employee panel, C = contract panel. Ensure UI elements have ARIA labels.
  **Acceptance criteria:**
  - [ ] All shortcuts work as documented
  - [ ] Shortcuts are shown in settings/help menu
  - [ ] `npm run validate` passes

- [ ] **12.8: Main menu and world map screen**
  Create a main menu screen with: game title ("BlastSimulator2026"), new campaign button, continue campaign button, load game button, settings button, language selector. The **world map** screen is the campaign hub: shows a stylized map (can be a simple illustrated 2D map or a 3D flyover) with 3 mine locations. Each location shows: level name, difficulty indicator (stars or icons), lock/unlock status, completion status (star rating if completed, profit achieved). Locked levels appear grayed out with a lock icon and show the unlock requirement ("Earn ${X} profit on {previous level}"). Clicking an unlocked level shows level details (description, mine type, difficulty modifiers) and offers "Start" or "Resume" (if a save exists for that level). The world map is also accessible from in-game via a "Return to Map" button (triggers save prompt).
  **Acceptance criteria:**
  - [ ] Main menu renders on game launch with all buttons
  - [ ] World map shows all 3 levels with correct lock/unlock state
  - [ ] Completed levels show star rating and stats
  - [ ] Locked levels show requirements to unlock
  - [ ] Clicking unlocked level shows details and start button
  - [ ] "Continue" resumes the most recent save
  - [ ] "Return to Map" from in-game saves and returns to world map
  - [ ] All text uses i18n
  - [ ] `npm run validate` passes

---

## Progress Summary

| Phase | Tasks | Completed |
|-------|-------|-----------|
| Phase 0 — Scaffolding | 4 | 4 |
| Phase 1 — Core Data Structures | 4 | 4 |
| Phase 2 — World and Terrain | 7 | 7 |
| Phase 3 — Mining Mechanics | 14 | 14 |
| Phase 4 — Economy | 4 | 4 |
| Phase 5 — Entities and Management | 6 | 6 |
| Phase 6 — Event System | 10 | 10 |
| Phase 7 — Campaign, World Map, Win/Lose | 8 | 8 |
| Phase 8 — Physics Integration | 5 | 5 |
| Phase 9 — 3D Rendering | 12 | 12 |
| Phase 10 — User Interface | 10 | 0 |
| Phase 11 — Audio | 3 | 0 |
| Phase 12 — Polish and Deployment | 8 | 0 |
| **Total** | **95** | **47** |
