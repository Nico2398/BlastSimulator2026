---
applyTo: "src/renderer/**/*.ts,src/ui/**/*.ts,index.html"
---

# Rendering and UI Changes

Type checks and unit tests cannot see a black screen, a mesh at the wrong scale, or a button with zero height. Changes here require the `visual` channel.

## ▶ PROCEDURE

1. Start the dev server: `npm run dev &`
2. Capture the change: `npm run screenshot -- --name "<change>" --commands "<console commands>"`
3. **Open every PNG with the Read tool** and describe what is on screen. Capturing is not inspecting.
4. For interactive changes, drive the real UI: `npm run scenario -- --scenario <name> --mode interaction --screenshots`
5. Fixing a visual defect: capture `before-<issue>` and `after-<issue>`, inspect both, confirm the defect is gone and nothing else moved.
6. Report which screenshots you inspected and what each showed.

Headless Chrome has no GPU — jagged edges and slightly dark shadows are artifacts, not defects. Full procedures, multi-angle and animation-frame capture, a11y and state-schema checks: `dev-visual-testing` skill.

## Conventions

- Renderer and UI read `GameState` and subscribe to core events. They never mutate core state directly.
- Player-visible text goes through `t('key')` with matching `en.json` and `fr.json` entries — including fictional rock, ore, and explosive names.
- In `GameRenderer.update(dt)`, ambient/decorative modules (wind, clouds, birds, chimney smoke, water surface, dust devils, fireflies, vegetation sway) run on game time: feed them `gameDt` (`dt * state.timeScale`, `0` while `state.isPaused`), never raw `dt`, so they scale and pause with the sim. Playback/UI/camera modules (fragment collapse, skybox, blast effects, characters, ghosts, border wall, vehicles) stay on raw `dt`. New ambient modules follow the `gameDt` convention.
- Panels that own a `TileSelectOverlay` scope element lookups to their own root. Ids are reused across pickers, so `document.getElementById` can resolve to a closed one.
- A tutorial step advances only on genuine completion. The tutorial never runs the player's commands for them; `autoCommands` (`src/ui/tutorialStages.ts`) is for scripted demonstrations only.
