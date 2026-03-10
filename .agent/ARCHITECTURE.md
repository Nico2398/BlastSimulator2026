# BlastSimulator2026 — Technical Architecture

## 1. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Language | TypeScript (strict mode) | Type safety enables autonomous agent validation |
| Build | Vite | Fast HMR, instant feedback loop |
| 3D Rendering | Three.js | Industry standard web 3D, huge ecosystem |
| Physics | Cannon-es | Maintained JS physics engine for blast simulation |
| Testing | Vitest | Unit + integration testing, Node.js native |
| Visual Testing | Puppeteer | Headless Chrome screenshots for render validation |
| Terrain | Marching Cubes | Smooth surface from voxel grid |
| Noise | simplex-noise | Procedural terrain/ore generation |
| Deployment | Vite build → static HTML | itch.io compatible, local install via npm |

## 2. Project Structure

```
BlastSimulator2026/
├── README.md                    # Task board, main agent entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html                   # Entry point for browser
│
├── .agent/                      # Agent instructions (read-only reference)
│   ├── GAME_DESIGN.md          # Full game design document
│   ├── ARCHITECTURE.md         # This file
│   ├── BLAST_SYSTEM.md         # Detailed blast algorithm
│   ├── TESTING.md              # Testing strategy and patterns
│   └── WORKFLOW.md             # Agent workflow rules
│
├── scripts/                     # Automation scripts
│   ├── validate.sh             # Run all validation (lint + test + build)
│   ├── screenshot.ts           # Puppeteer screenshot capture
│   └── console-test.ts         # Run console-mode integration tests
│
├── src/
│   ├── main.ts                 # Browser entry: initializes renderer + game
│   ├── console.ts              # CLI entry: Node.js playable console mode
│   │
│   ├── core/                   # PURE TypeScript — NO DOM, NO WebGL, NO side effects
│   │   ├── state/
│   │   │   ├── GameState.ts    # Central game state interface
│   │   │   ├── GameLoop.ts     # Tick-based game loop logic
│   │   │   ├── SaveLoad.ts     # Serialization / deserialization
│   │   │   └── SaveBackend.ts  # Save backend INTERFACE only (no platform code)
│   │   │
│   │   ├── campaign/
│   │   │   ├── Level.ts        # Level definitions (3 levels with difficulty params)
│   │   │   └── Campaign.ts     # Campaign progression (unlock, complete, star ratings)
│   │   │
│   │   ├── world/
│   │   │   ├── VoxelGrid.ts    # 3D grid of materials
│   │   │   ├── TerrainGen.ts   # Procedural generation (noise-based)
│   │   │   ├── RockCatalog.ts  # Rock type definitions
│   │   │   ├── OreCatalog.ts   # Ore type definitions
│   │   │   └── MineType.ts     # Starting mine type presets
│   │   │
│   │   ├── mining/
│   │   │   ├── Survey.ts       # Geological surveying
│   │   │   ├── DrillPlan.ts    # Drill pattern definition
│   │   │   ├── ChargePlan.ts   # Explosive loading per hole
│   │   │   ├── Sequence.ts     # Detonation timing
│   │   │   ├── BlastPlan.ts    # Combined plan (drill + charge + sequence)
│   │   │   ├── BlastCalc.ts    # Energy/fragmentation calculations (pure math)
│   │   │   ├── BlastResult.ts  # Blast outcome data structures
│   │   │   └── Software.ts     # Upgradeable prediction tools
│   │   │
│   │   ├── economy/
│   │   │   ├── Finance.ts      # Money, income, expenses tracking
│   │   │   ├── Contract.ts     # Contract definitions and negotiation
│   │   │   ├── Market.ts       # Available contracts generation
│   │   │   └── Corruption.ts   # Bribery mechanics
│   │   │
│   │   ├── entities/
│   │   │   ├── Employee.ts     # Employee with role, salary, union status
│   │   │   ├── Vehicle.ts      # Vehicle types, capacity, fuel, maintenance
│   │   │   ├── Building.ts     # Building types, placement, effects
│   │   │   └── Fragment.ts     # Post-blast rock fragment data
│   │   │
│   │   ├── scores/
│   │   │   ├── ScoreManager.ts # Central score tracker
│   │   │   ├── WellBeing.ts    # Worker well-being calculation
│   │   │   ├── Safety.ts       # Safety score calculation
│   │   │   ├── Ecology.ts      # Environmental impact
│   │   │   └── Nuisance.ts     # Neighbor disturbance
│   │   │
│   │   ├── events/
│   │   │   ├── EventSystem.ts  # Timer-based event triggering engine
│   │   │   ├── EventCategory.ts # Category definitions (union, politics, etc.)
│   │   │   ├── EventPool.ts    # Available events per category
│   │   │   ├── EventResolver.ts # Decision options and consequences
│   │   │   ├── UnionEvents.ts  # 50-100 union event definitions
│   │   │   ├── PoliticsEvents.ts
│   │   │   ├── WeatherEvents.ts
│   │   │   ├── MafiaEvents.ts
│   │   │   ├── LawsuitEvents.ts
│   │   │   └── ExternalEvents.ts
│   │   │
│   │   ├── weather/
│   │   │   ├── WeatherCycle.ts # Procedural weather state machine
│   │   │   └── WeatherEffects.ts # Impact on gameplay (hole flooding, etc.)
│   │   │
│   │   └── i18n/
│   │       ├── I18n.ts         # Translation engine with interpolation
│   │       ├── locales/
│   │       │   ├── en.json     # English strings
│   │       │   └── fr.json     # French strings
│   │       └── keys.ts         # Type-safe translation key constants
│   │
│   ├── persistence/            # Platform-specific save backends (uses DOM/Node APIs)
│   │   ├── FilePersistence.ts      # Node.js file-based saves (desktop/local)
│   │   ├── IndexedDBPersistence.ts # Browser IndexedDB saves (web primary)
│   │   └── DownloadPersistence.ts  # File download/upload fallback (web)
│   │
│   ├── physics/
│   │   ├── PhysicsWorld.ts     # Cannon-es world wrapper
│   │   ├── BlastPhysics.ts     # Fragment creation, forces, trajectories
│   │   ├── FragmentBody.ts     # Physical fragment entity
│   │   ├── CollisionHandler.ts # Damage on impact (buildings, vehicles, people)
│   │   └── TerrainBody.ts      # Static terrain collider
│   │
│   ├── renderer/
│   │   ├── SceneManager.ts     # Three.js scene, camera, lights
│   │   ├── TerrainMesh.ts      # Marching cubes mesh from voxel grid
│   │   ├── FragmentMesh.ts     # Visual fragment representation
│   │   ├── BuildingMesh.ts     # Building 3D models (placeholder geo)
│   │   ├── VehicleMesh.ts      # Vehicle 3D models (placeholder geo)
│   │   ├── CharacterMesh.ts    # Minion-style character models
│   │   ├── SkyboxWeather.ts    # Sky and weather visual effects
│   │   ├── ProceduralTexture.ts # Rock texture generation
│   │   └── CameraController.ts # Orbit/pan/zoom controls
│   │
│   ├── ui/
│   │   ├── MainMenu.ts         # Title screen, new/continue/load/settings
│   │   ├── WorldMapUI.ts       # Campaign world map with level selection
│   │   ├── HUD.ts              # Heads-up display (money, scores, time)
│   │   ├── BlastPlanUI.ts      # Blast plan editor interface
│   │   ├── ContractUI.ts       # Contract negotiation interface
│   │   ├── BuildMenu.ts        # Building placement menu
│   │   ├── VehiclePanel.ts     # Fleet management
│   │   ├── EmployeePanel.ts    # Employee management
│   │   ├── EventDialog.ts      # Event popup with decision buttons
│   │   ├── SurveyUI.ts         # Survey results display
│   │   ├── SaveLoadUI.ts       # Save/load interface with slot management
│   │   └── SettingsMenu.ts     # Game settings (language, speed, audio)
│   │
│   ├── audio/
│   │   ├── AudioManager.ts     # Central audio system
│   │   ├── SoundCatalog.ts     # Sound effect definitions
│   │   └── Placeholder.ts      # Generate placeholder beep/boom sounds
│   │
│   └── console/
│       ├── ConsoleRunner.ts    # Command parser and executor
│       ├── commands/           # One file per command group
│       │   ├── survey.ts
│       │   ├── drill.ts
│       │   ├── charge.ts
│       │   ├── sequence.ts
│       │   ├── blast.ts
│       │   ├── build.ts
│       │   ├── vehicle.ts
│       │   ├── contract.ts
│       │   ├── employee.ts
│       │   ├── time.ts
│       │   ├── status.ts
│       │   └── save.ts
│       └── ConsoleFormatter.ts # Pretty-print game state to terminal
│
├── tests/
│   ├── unit/                   # Vitest unit tests (mirror src/core structure)
│   │   ├── world/
│   │   ├── mining/
│   │   ├── economy/
│   │   ├── events/
│   │   ├── scores/
│   │   └── weather/
│   ├── integration/            # Full scenario tests via console commands
│   │   ├── blast-scenario.test.ts
│   │   ├── economy-scenario.test.ts
│   │   └── event-scenario.test.ts
│   └── visual/                 # Puppeteer screenshot tests
│       ├── terrain-render.test.ts
│       ├── blast-render.test.ts
│       └── ui-render.test.ts
│
└── public/
    └── assets/                 # Static assets (placeholder models, textures)
```

## 3. Key Architectural Principles

### 3.1 Core Purity
Everything under `src/core/` is **pure TypeScript with zero side effects**. No DOM access, no `window`, no WebGL, no file I/O. This means:
- All core logic runs in Node.js for testing
- Console mode works without a browser
- The agent can validate any game mechanic with a simple `vitest` command
- The `SaveBackend` interface lives in core (it's a pure type), but its implementations (IndexedDB, File, Download) live in `src/persistence/` because they use platform APIs

### 3.2 State-Driven Architecture
The game state is a single serializable object (GameState). All systems read from and write to this state. This enables:
- Save/load by serializing the state to JSON
- Console mode by manipulating state via commands
- Deterministic testing by constructing known states
- Time travel debugging

### 3.3 Tick-Based Game Loop
The core loop advances in discrete **ticks**. Each tick:
1. Advance time by `dt` (configurable, modified by speed multiplier)
2. Update weather cycle
3. Update event timers, fire events if ready
4. Update vehicle movements and tasks
5. Update physics (if blast in progress)
6. Update scores
7. Check win/lose conditions
8. Emit state change events for renderer

The renderer runs at 60fps independently and interpolates visual positions between ticks.

### 3.4 Asset Replaceability
All visual assets are loaded through a central AssetManager that maps asset IDs to geometry/material definitions. Placeholder assets are simple Three.js geometries (BoxGeometry, CylinderGeometry, SphereGeometry) with flat colors. Replacing them with real models means updating the AssetManager mappings only.

### 3.5 Event-Driven Communication
Core → Renderer communication uses an event emitter pattern. The core emits events like `terrain:updated`, `blast:started`, `fragment:created`, and the renderer subscribes to update visuals. This keeps the dependency arrow one-way: renderer depends on core, never the reverse.

## 4. Data Flow

```
Player Input (UI click / Console command)
        ↓
   Command Handler
        ↓
   Core Logic (pure TS)
        ↓
   GameState mutation
        ↓
   Event emitted
        ↓
   ┌────────────┐
   │  Renderer   │ (Three.js — visual update)
   │  Physics    │ (Cannon-es — if blast active)
   │  Audio      │ (placeholder sounds)
   │  UI/HUD     │ (DOM overlay update)
   └────────────┘
```

## 5. Console Mode Architecture

Console mode is a Node.js CLI that:
1. Creates a GameState
2. Reads commands from stdin (or from a script file for automated testing)
3. Dispatches commands to the same core logic the UI uses
4. Prints results to stdout in a structured format

This means **every feature can be developed and tested without ever opening a browser.**

Example console session:
```
> new_game mine_type:desert seed:42
Game created. 100x100 terrain, desert biome.

> survey 25,30
Survey at (25,30): Grumpite rock, Treranium density: 0.73

> drill_plan grid origin:20,25 rows:3 cols:4 spacing:3 depth:8
Drill plan created: 12 holes, grid pattern.

> charge hole:* explosive:pop_rock amount:3kg stemming:1.5m
All 12 holes charged with Pop-Rock (3kg), stemming 1.5m.

> sequence auto delay_step:25ms
Auto-sequence applied: V-pattern, 25ms inter-delay.

> blast
BLAST! 12 holes detonated over 275ms.
Fragments generated: 847
Average fragment size: 0.34m³
Projections: 3 (max distance: 12m)
No casualties. No damage.

> status scores
Well-being: 72 | Safety: 85 | Ecology: 64 | Nuisance: 58
```

## 6. Physics Integration Strategy

Physics (Cannon-es) runs **only during blast events and their aftermath**. It is not used for general gameplay (vehicles move on predefined paths, characters walk on terrain surface).

When a blast fires:
1. Core calculates fragment data (positions, sizes, initial velocities)
2. Physics world creates rigid bodies for each fragment
3. Physics simulates for N seconds (configurable) until fragments settle
4. Final fragment positions are read back into GameState
5. Collision events during simulation are processed (damage to entities)
6. Physics world is cleared until next blast

This keeps physics cost isolated to blast events only.

## 7. Deployment

### Web (itch.io)
```bash
npm run build    # Vite produces dist/ folder
# Upload dist/ to itch.io as HTML5 game
```

### Local
```bash
git clone <repo>
npm install
npm run dev      # Vite dev server with HMR
```

### Console Mode
```bash
npx tsx src/console.ts
# Or: npm run console
```
