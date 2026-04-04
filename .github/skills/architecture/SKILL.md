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
| 3D Rendering | Three.js | Industry standard web 3D, huge ecosystem |
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
- `src/console/` → CLI mode, same core logic as the UI.

**State flows one way:** Input → Core → State mutation → Event emitted → Renderer/UI/Audio

## Key Architectural Principles

### Core Purity
Everything under `src/core/` is **pure TypeScript with zero side effects**. No DOM access, no `window`, no WebGL, no file I/O. This means:
- All core logic runs in Node.js for testing
- Console mode works without a browser
- The agent can validate any game mechanic with a simple `vitest` command
- The `SaveBackend` interface lives in core (it's a pure type), but its implementations (IndexedDB, File, Download) live in `src/persistence/` because they use platform APIs

### State-Driven Architecture
The game state is a single serializable object (GameState). All systems read from and write to this state. This enables:
- Save/load by serializing the state to JSON
- Console mode by manipulating state via commands
- Deterministic testing by constructing known states
- Time travel debugging

### Tick-Based Game Loop
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

### Asset Replaceability
All visual assets are loaded through a central AssetManager that maps asset IDs to geometry/material definitions. Placeholder assets are simple Three.js geometries (BoxGeometry, CylinderGeometry, SphereGeometry) with flat colors. Replacing them with real models means updating the AssetManager mappings only.

### Event-Driven Communication
Core → Renderer communication uses an event emitter pattern. The core emits events like `terrain:updated`, `blast:started`, `fragment:created`, and the renderer subscribes to update visuals. This keeps the dependency arrow one-way: renderer depends on core, never the reverse.

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

## Console Mode Architecture

Console mode is a Node.js CLI that:
1. Creates a GameState
2. Reads commands from stdin (or from a script file for automated testing)
3. Dispatches commands to the same core logic the UI uses
4. Prints results to stdout in a structured format

This means **every feature can be developed and tested without ever opening a browser.**

## Physics Integration Strategy

Physics (Cannon-es) runs **only during blast events and their aftermath**. It is not used for general gameplay (vehicles move on predefined paths, characters walk on terrain surface).

When a blast fires:
1. Core calculates fragment data (positions, sizes, initial velocities)
2. Physics world creates rigid bodies for each fragment
3. Physics simulates for N seconds (configurable) until fragments settle
4. Final fragment positions are read back into GameState
5. Collision events during simulation are processed (damage to entities)
6. Physics world is cleared until next blast

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
