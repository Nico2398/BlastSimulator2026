# BlastSimulator2026 — Development Phases (Archive)

This file is an **historical record** of the 95 tasks completed during the initial autonomous development phase (all 12 phases). It is preserved for reference but is no longer the active task list. The project has transitioned to an evolution/maintenance workflow — see `CLAUDE.md` for the current workflow.

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
| Phase 10 — User Interface | 10 | 10 |
| Phase 11 — Audio | 3 | 3 |
| Phase 12 — Polish and Deployment | 8 | 8 |
| **Total** | **95** | **95** |

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
  - [x] `npm run validate` runs `scripts/validate.sh`
  - [x] Opening `index.html` via dev server shows a spinning or static colored cube

- [x] **0.2: Set up testing infrastructure**
  Configure Vitest in `vite.config.ts` or `vitest.config.ts`. Create `tests/unit/` and `tests/integration/` directories. Write a trivial passing test (`tests/unit/smoke.test.ts`) that asserts `1 + 1 === 2`. Make `scripts/validate.sh` executable and functional.
  **Acceptance criteria:**
  - [x] `npx vitest run` finds and passes the smoke test
  - [x] `bash scripts/validate.sh` runs all four steps and reports success

- [x] **0.3: Set up i18n system**
  Implement `src/core/i18n/I18n.ts`: a translation module with `t(key, params?)` function, `setLocale(locale)`, and `getLocale()`. Support string interpolation with `{variable}` syntax. Create `src/core/i18n/locales/en.json` and `src/core/i18n/locales/fr.json` with a few sample keys. Create `src/core/i18n/keys.ts` with typed key constants.
  **Acceptance criteria:**
  - [x] Unit test: `t('game.title')` returns "BlastSimulator2026" in both locales
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
  Define `src/core/state/GameState.ts`: the central state interface containing all game data. Implement `createGame(config)` factory function. Implement `src/core/state/GameLoop.ts`: a tick-based loop. Add `timeScale` to GameState (1x, 2x, 4x, 8x) and `isPaused` flag.
  **Acceptance criteria:**
  - [x] Unit test: `createGame({ seed: 42 })` returns a valid GameState object
  - [x] Unit test: `tick(state, 100)` advances `state.time` by `100 * state.timeScale`
  - [x] Unit test: `tick(state, 100)` with `isPaused = true` does not advance time
  - [x] Unit test: changing `timeScale` to 4 makes time advance 4x faster
  - [x] `npm run validate` passes

- [x] **1.3: Save/Load system**
  Implement `src/core/state/SaveLoad.ts`: `serialize(state) → string` and `deserialize(json) → GameState`. Define `src/core/state/SaveBackend.ts` (pure type interface in core). Implement three concrete backends in `src/persistence/`: FilePersistence, IndexedDBPersistence, DownloadPersistence.
  **Acceptance criteria:**
  - [x] Unit test: `deserialize(serialize(state))` produces an equivalent state
  - [x] Unit test: serialized output is valid JSON
  - [x] Unit test: deserialization of unknown version throws a clear error
  - [x] Unit test: `FilePersistence` can save and load a state from disk
  - [x] Unit test: save slot metadata is stored alongside state
  - [x] `npm run validate` passes

- [x] **1.4: Event emitter**
  Implement `src/core/state/EventEmitter.ts`: a typed event emitter. Methods: `on(event, handler)`, `off(event, handler)`, `emit(event, data)`. Define an `EventMap` type listing all game events.
  **Acceptance criteria:**
  - [x] Unit test: subscribing to an event and emitting it calls the handler with correct data
  - [x] Unit test: `off()` removes the handler
  - [x] Unit test: multiple handlers on the same event all fire
  - [x] `npm run validate` passes

---

### Phase 2 — World and Terrain

- [x] **2.1: Rock catalog** — Human-approved rock names; 8+ rocks across hardness tiers 1–5; all in i18n.
- [x] **2.2: Ore catalog** — Human-approved ore names; 6+ ores; Treranium as rarest/most valuable.
- [x] **2.3: Explosive catalog** — Human-approved explosive names; 6+ explosives; energy values documented with real-world basis.
- [x] **2.4: VoxelGrid** — 3D grid with rock type, density, ore densities, fracture threshold per cell.
- [x] **2.5: Procedural terrain generation** — Seeded simplex noise; deterministic; surface/ore/biome distribution.
- [x] **2.6: Mine type presets** — 3+ presets (desert, mountain, tropical, arctic); fed into TerrainGen.
- [x] **2.7: Console commands — world inspection** — `inspect`, `terrain_info`, `survey` commands.

---

### Phase 3 — Mining Mechanics (Console Mode)

- [x] **3.1: Survey system** — Fog of war; surveying reveals voxels; costs money.
- [x] **3.2: Drill plan** — Hole placement; grid pattern generation; stored in GameState.
- [x] **3.3: Charge plan** — Explosive type + amount + stemming per hole; validated against catalog.
- [x] **3.4: Detonation sequence** — Per-hole delays; V-pattern auto-generation.
- [x] **3.5: Blast plan composition** — Combines drill + charge + sequence; validation.
- [x] **3.6: Blast energy calculation** — `BlastCalc.ts` pure functions following BLAST_SYSTEM.md algorithm.
- [x] **3.7: Fragmentation calculation** — Fracture zones, fragment count/size, projection classification.
- [x] **3.8: Free face calculation** — Neighboring void detection; sequence-aware.
- [x] **3.9: Vibration calculation** — Charge-per-delay formula; village distance decay.
- [x] **3.10: Blast execution and result** — Full pipeline: validate → simulate → energy field → fragmentation → terrain update → BlastResult.
- [x] **3.11: Blast preview (software tiers)** — Preview gates: energy (tier 1), fragments (2), projections (3), vibrations (4).
- [x] **3.12: Ramp building** — Voxel carving; slope geometry; cost/time.
- [x] **3.13: Weather system** — State machine; probabilistic transitions; hole flooding via rain + porosity.
- [x] **3.14: Tubing / casing system** — Inventory + installation; waterproofs holes.

---

### Phase 4 — Economy (Console Mode)

- [x] **4.1: Finance system** — Cash balance, income/expense tracking, categories, bankruptcy flag.
- [x] **4.2: Contract system** — Ore sale, rubble disposal, supply contracts; Market.ts for generation.
- [x] **4.3: Contract negotiation** — Probabilistic outcome; score-influenced; can worsen terms.
- [x] **4.4: Fragment storage and logistics** — on_ground → in_transit → stored → sold lifecycle.

---

### Phase 5 — Entities and Management (Console Mode)

- [x] **5.1: Building system** — 8 building types; placement, cost, operating cost, capacity, destruction.
- [x] **5.2: Vehicle system** — 4 vehicle types; purchase, task assignment, health, fuel costs.
- [x] **5.3: Employee system** — Roles, salary, morale, union status, injury; pay cycles.
- [x] **5.4: Score system** — WellBeing, Safety, Ecology, Nuisance (0–100 each); tick-based updates.
- [x] **5.5: Damage and casualty system** — Fragment hit detection; HP damage; death → lawsuit flag.
- [x] **5.6: Zone clearing and evacuation** — `clearZone` + `isZoneClear`; casualty prevention.

---

### Phase 6 — Event System (Console Mode)

- [x] **6.1: Event system engine** — Category timers; probability-weighted selection; score-dependent.
- [x] **6.2: Event resolution system** — Decision options → consequences; follow-up event queueing.
- [x] **6.3: Union events (50–100)** — Human-approved; well-being/safety score modulated.
- [x] **6.4: Political/external events (50–100)** — Human-approved; finance/contract/score effects.
- [x] **6.5: Weather events (50–100)** — Human-approved; triggered by WeatherCycle state.
- [x] **6.6: Mafia events (50–100)** — Human-approved; requires corruption flag; escalating risk.
- [x] **6.7: Lawsuit events (50–100)** — Human-approved; triggered by accidents/deaths.
- [x] **6.8: Corruption system** — Bribe mechanics; probability roll; scandal on failure; mafia unlock.
- [x] **6.9: Mafia gameplay mechanics** — Accidents, framing, smuggling; exposure risk.
- [x] **6.10: Time acceleration** — 1x/2x/4x/8x; auto-pause on events; delta-time accumulation.

---

### Phase 7 — Campaign, World Map, and Win/Lose Conditions

- [x] **7.1: Level definition system** — 3 levels (Dusty Hollow, Grumpstone Ridge, Treranium Depths); human-approved names.
- [x] **7.2: Campaign state and progression** — Unlock chain; serializable; campaign status command.
- [x] **7.3: Level completion and transition** — Profit threshold → level:complete event; fresh GameState preserving campaign.
- [x] **7.4: Bankruptcy** — Sustained negative balance → game over for current level; warnings.
- [x] **7.5: Criminal arrest** — Exposure threshold → arrest → level fail.
- [x] **7.6: Ecological disaster** — Sustained 0 ecology → government shutdown.
- [x] **7.7: Worker revolt** — Sustained 0 well-being → permanent strike.
- [x] **7.8: Success tracking** — Per-level stats; 1–3 star rating.

---

### Phase 8 — Physics Integration

- [x] **8.1: Physics world setup** — Cannon-es wrapper; init/step/add/remove/clear.
- [x] **8.2: Terrain collision body** — Static shape from VoxelGrid surface; updates after blasts.
- [x] **8.3: Fragment physics bodies** — Rigid bodies with initial velocity; settle detection.
- [x] **8.4: Collision damage handler** — Impact energy → building/vehicle/employee damage.
- [x] **8.5: Full blast physics integration test** — Deterministic end-to-end blast scenario.

---

### Phase 9 — 3D Rendering

- [x] **9.1: Scene manager and console bridge** — Three.js init; `window.__gameConsole` bridge for screenshot script.
- [x] **9.2: Camera controller** — Orbit/pan/zoom; limits; touch support.
- [x] **9.3: Terrain mesh (marching cubes)** — Chunk-based VoxelGrid → Three.js mesh; rock-type colors.
- [x] **9.4: Procedural rock textures** — 3D noise textures; coherent across fragments.
- [x] **9.5: Fragment meshes** — Physics-synced; ore-rich fragments visually distinct.
- [x] **9.6: Building meshes (placeholders)** — Colored box/cylinder placeholders per type.
- [x] **9.7: Vehicle meshes (placeholders)** — Colored placeholder shapes; movement animation.
- [x] **9.8: Character meshes (placeholders)** — Minion-style capsule+sphere; evacuation movement.
- [x] **9.9: Skybox and weather visuals** — Sky color by weather; rain particles; smooth transitions.
- [x] **9.10: Blast visual effects** — Sequential hole flashes; dust cloud; screen shake.
- [x] **9.11: Distant scenery** — Low-poly decorative horizon; mine-type-dependent.
- [x] **9.12: Blast plan visualization overlays** — Drill holes, charge colors, sequence numbers, software previews.

---

### Phase 10 — User Interface

- [x] **10.1: HUD** — Balance, time, scores, weather; real-time updates.
- [x] **10.2: Blast plan editor UI** — Click-to-place holes; charge/sequence editor; preview/execute.
- [x] **10.3: Contract UI** — Available + active contracts; accept/negotiate/decline.
- [x] **10.4: Build menu** — Ghost placement; valid/invalid highlighting.
- [x] **10.5: Vehicle management panel** — Fleet list; buy/assign/move/scrap.
- [x] **10.6: Employee management panel** — List by role; hire/fire/raise.
- [x] **10.7: Event dialog** — Popup with options; auto-pause; outcome display.
- [x] **10.8: Survey UI** — Click-to-survey; results popup.
- [x] **10.9: Settings menu** — Language, audio, save/load.
- [x] **10.10: Mini-map** — Terrain outline, buildings, vehicles; camera jump on click.

---

### Phase 11 — Audio

- [x] **11.1: Audio manager** — Web Audio API; categories; mute toggle.
- [x] **11.2: Placeholder sounds** — Synthesized via oscillators; no external files.
- [x] **11.3: Audio event hooks** — Timed blast booms; UI feedback; weather ambience.

---

### Phase 12 — Polish and Deployment

- [x] **12.1: Game balance pass** — All constants centralized; 30-min simulation test.
- [x] **12.2: Comprehensive i18n review** — No hardcoded strings; en/fr key parity.
- [x] **12.3: Save/Load UI integration** — IndexedDB (web) + file (local); auto-save; 5+ slots.
- [x] **12.4: Tutorial / first-time experience** — Guided survey→drill→blast→contract; skippable.
- [x] **12.5: Performance optimization** — 60fps with 2000 fragments; localized chunk re-meshing.
- [x] **12.6: Itch.io deployment build** — Single-HTML Vite build; deployable dist/.
- [x] **12.7: Keyboard shortcuts and accessibility** — Space/1–4/B/V/E/C shortcuts; ARIA labels.
- [x] **12.8: Main menu and world map screen** — Main menu + stylized world map; lock/unlock display.
