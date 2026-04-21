---
name: architecture
description: >
  Technical architecture of BlastSimulator2026: module boundaries, data flow, state management,
  tick-based game loop, event-driven communication, and deployment. Use when working on any
  structural change, adding new modules, or understanding how systems connect.
---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Language | TypeScript (strict mode) | Type safety enables autonomous agent validation |
| Build | Vite | Fast HMR, instant feedback loop |
| 3D Rendering | Three.js | Industry standard web 3D |
| Physics | Cannon-es | Maintained JS physics engine for blast simulation |
| Testing | Vitest | Unit + integration testing, Node.js native |
| Visual Testing | Puppeteer | Headless Chrome screenshots for render validation |
| Terrain | Marching Cubes | Smooth surface from voxel grid |
| Noise | simplex-noise | Procedural terrain/ore generation |
| Deployment | Vite build → static HTML | itch.io compatible, local install via npm |

## Module Boundaries (never violate)

- `src/core/` → pure TypeScript, zero side effects, no DOM/WebGL/window. Fully testable in Node.js.
- `src/renderer/` → Three.js visuals. Depends on core. Core never imports renderer.
- `src/physics/` → Cannon-es. Active only during blasts.
- `src/persistence/` → Save backends (IndexedDB, File, Download). Imports only from core.
- `src/ui/` → HTML overlay. Reads GameState.
- `src/audio/` → Web Audio API.
- `src/console/` → CLI mode, same core logic as UI.

**State flows one way:** Input → Core → State mutation → Event emitted → Renderer/UI/Audio

## Key Architectural Principles

- **Core purity:** `src/core/` = zero side effects; no DOM, `window`, WebGL, or file I/O. `SaveBackend` interface in core; implementations in `src/persistence/`.
- **Single serializable GameState:** enables save/load (JSON), console mode, deterministic tests.
- **Tick loop steps:** (1) advance time, (2) weather, (3) events, (4) vehicles+tasks, (5) physics (blast only), (6) scores, (7) win/lose check, (8) emit state-change events. Renderer runs at 60fps, interpolates between ticks.
- **Event-driven renderer:** Core emits `terrain:updated`, `blast:started`, `fragment:created`, etc. Renderer subscribes. Dependency one-way: renderer → core, never reverse.
- **Asset replaceability:** AssetManager maps IDs → geometry/material; placeholders = Three.js primitives. Replace assets by updating AssetManager only.

## Data Flow

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

## Console Mode

Node.js CLI (`npx tsx src/console.ts`). Creates GameState, reads stdin commands, dispatches to same core logic as UI. Every feature testable without browser.

## Physics Integration

Cannon-es runs **only during blast events**. Flow: core calculates fragment data → physics creates rigid bodies → simulates N seconds → final positions read back into GameState → collision events processed → physics world cleared. Not used for vehicles or general movement.

## Project Structure

```
src/
├── main.ts                 # Browser entry: initializes renderer + game
├── console.ts              # CLI entry: Node.js playable console mode
├── core/                   # PURE TypeScript — NO DOM, NO WebGL, NO side effects
│   ├── state/              # GameState, GameLoop, SaveLoad, SaveBackend interface
│   ├── campaign/           # Level definitions, Campaign progression
│   ├── world/              # VoxelGrid, TerrainGen, RockCatalog, OreCatalog, MineType
│   ├── mining/             # Survey, DrillPlan, ChargePlan, Sequence, BlastPlan, BlastCalc
│   ├── economy/            # Finance, Contract, Market, Corruption
│   ├── entities/           # Employee, Vehicle, Building, Fragment
│   ├── scores/             # ScoreManager, WellBeing, Safety, Ecology, Nuisance
│   ├── events/             # EventSystem, EventCategory, EventPool, EventResolver
│   ├── weather/            # WeatherCycle, WeatherEffects
│   └── i18n/               # I18n, locales (en.json, fr.json), keys.ts
├── persistence/            # Platform-specific save backends
├── physics/                # PhysicsWorld, BlastPhysics, FragmentBody, CollisionHandler
├── renderer/               # SceneManager, TerrainMesh, FragmentMesh, BuildingMesh, etc.
├── ui/                     # MainMenu, WorldMapUI, HUD, BlastPlanUI, ContractUI, etc.
├── audio/                  # AudioManager, SoundCatalog, Placeholder
└── console/                # ConsoleRunner, commands/, ConsoleFormatter
```

## Deployment

- **Web (itch.io):** `npm run build` → upload `dist/`
- **Local:** `npm run dev` (Vite dev server with HMR)
- **Console Mode:** `npx tsx src/console.ts`
