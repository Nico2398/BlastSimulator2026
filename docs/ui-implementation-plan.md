# BlastSimulator2026 — UI Implementation Plan

**Input documents (source of truth, in this order):**
1. `docs/BlastSim game UI design/BlastSim Design System.dc.html` — tokens, type, icons, component states, motion, glossary, tone.
2. `docs/BlastSim game UI design/BlastSim UI.dc.html` — in-game shell: top bar, tool rail, panel dock (all 10 panels), scene interaction chrome, toasts, activity log, coach card, all modals. Includes a working responsive top bar and full sample data.
3. `docs/BlastSim game UI design/BlastSim Grid Select.dc.html` — the in-scene placement layer: 6-state machine, camera remap, per-tile-quad selection rendering, rejected/occluded cells, tutorial pinning on terrain, parameter strip, ramp/building/survey variants, state inventory, geometry tokens.
4. `docs/BlastSim game UI design/BlastSim Screens.dc.html` — main menu, world map ("The Portfolio"), loading screen, victory, defeat, scene hover/selection anatomy.
5. `docs/BlastSim game UI design/icons.js` — the `<bs-icon>` glyph set (drawn SVG, no emoji). To be ported into `src/ui/`.
6. `docs/ui-redesign-spec.md` — feature inventory and control→command contract (§9). Still valid; where design and spec disagree, the design wins on presentation, the spec wins on data/commands.

`support.js` is the design-canvas runtime — reference only, never shipped.

**The design is implementation-grade.** The `.dc.html` files contain real markup, exact colors/sizes, working interaction logic (popover behavior, Esc priority, responsive shedding, grid-select state machine) and complete sample data. Implementation is largely *transcription into our vanilla-DOM layer plus wiring to GameState/console*, not re-invention. When in doubt, open the design file and copy its values.

---

## 1. Ground rules (unchanged from spec §2, re-affirmed by the design)

1. Vanilla TS DOM over the Three.js canvas. No framework. All chrome CSS lives in injected stylesheets.
2. **Every mutation goes through `window.__gameConsole(cmd)`** (§9 of the spec). The design even ships a "COMMAND BUS" debug pill that displays dispatched commands — build it; it makes this contract visible.
3. Per-frame `update(state)` with signature-gated DOM rebuilds; drifting values written in place. **Per-frame values never transition** (design motion rule).
4. i18n en+fr for every string. The design's copy (labels, confirm bodies, empty states, tooltips) is the *English source text* — lift it verbatim into `en.json`, write fr equivalents. Buttons min-width + side padding, never fixed width; two-line wrap, never ellipsis on names.
5. Testing hooks are API. Keep these ids/classes working at every phase: `#bs-toolbar [data-panel=…]`, `data-action`, `data-employee-id`, `.bs-detail-toggle`, `.bs-train-btn`, `#bs-tile-select-confirm` (until the 2D picker is retired in P3), `#bs-sandbox-*`, plus the `__uiActions`/`__probeSelector` probe and `__uiState`. Every phase that renames a selector updates `src/ui/tutorialSteps.ts`, `src/ui/tutorialStages.ts`, `scripts/playtests/*`, and affected `scripts/scenario-defs/*.json` **in the same commit**.
6. WCAG AA per `npm run a11y`. The design palette is pre-measured (see the Design System's AA annotations); the one trap it calls out: greys that pass on `#141920` fail on tinted chips — use `#b0b9c4` on any tinted/translucent surface. Never encode data in an ancestor's `opacity` (it multiplies into text) — the forecast uses a color ramp for exactly this reason.
7. Verification gate per phase: `static` + `logic` always; `scenario` when commands/defs change; `visual` (screenshots, inspected) for every phase; `playability` for every phase that touches a player flow — which is all of them from P2 on. `npm run ui:diagnostic` and `npm run check-i18n-parity` (script exists) at every phase end.

---

## 2. Global decisions (defaulted now so phases don't stall — revisit only if the user objects)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Fonts self-hosted.** Add Archivo (400–900) + IBM Plex Mono (400–600) as woff2 under `src/ui/assets/fonts/` with `@font-face` in the injected stylesheet, `font-display: swap`, system-ui fallback. Both are OFL-licensed. No Google CDN at runtime | game must run offline, in CI's headless Chrome, and in itch builds |
| D2 | **Icons: port `icons.js` to `src/ui/icons.ts`** as a `<bs-icon>` custom element (same API: `name`, `size`, `op`) registered once from `injectStyles()`-equivalent bootstrap. Type the name union from the design's six groups + `explosive`, `star`, `pick`, `heat`. **No emoji anywhere** — the HUD weather emoji, toolbar emoji, `⛏`/`★` glyphs all become `<bs-icon>` | design rule: "drawn glyphs — no emoji anywhere"; kills the tofu bug |
| D3 | **Design tokens as CSS custom properties** in a rewritten `src/ui/styles.ts` (`--bs-app:#0b0e12; --bs-panel:#141920; --bs-card:#1b212a; --bs-well:#11161c; --bs-hairline:#242c36; --bs-amber:#ffb02e; --bs-scene-amber:#ffc840; --bs-pos:#4fc76b; --bs-crit:#ff5b4c; --bs-crit-text:#ff8a7e; --bs-info:#55a8ff; --bs-ore:#a98cff; --bs-pin:#7ab8ff; --bs-survey:#3fd0c0;` text tiers, radius 3/4/6/9, spacing scale, z map). Shared component classes (`bs-btn-primary/ghost/danger/locked`, `bs-chip`, `bs-gauge`, `bs-stepper`, `bs-section-h`, `bs-card`) replace today's ad-hoc inline styles | one place to keep AA true; the design repeats these values everywhere |
| D4 | **Z-order adopted from the design**: canvas 0 · panel dock 100 · scene selection bar 120 · HUD top bar 150 · tool rail 200 · popovers 210 · hover tag 320 · coach card 400 · activity log 500 · modals 600 · menu 9999 / settings-over-menu 10000 | matches design §03; close to current values |
| D5 | **Catalog IDs unchanged; display names via i18n only.** The design's sample content renames explosives ("The Nudge", "Mister Kaboomington"), vehicles ("The Big Gulp"), buildings ("Bureau of Expensive Answers"). Mechanical IDs (`pop_rock`, `boomite`, …) stay. Where the design name maps 1:1 to an existing entry we may adopt it as the localized string; net-new entries (8-item explosive list is a *layout*, not a content order) are **out of scope** — the panel renders whatever `ExplosiveCatalog` holds | content redesign ≠ UI redesign; keeps `logic`/`scenario` suites green |
| D6 | **Glossary applied**: rail says CREW / DEALS / FLEET / MONEY / OPS / SETUP; panel titles CONTRACTS, FINANCES, OPERATIONS…; "Fire" = blast button, "Detonate" = confirm, "Dismiss" = fire employee, "Product" = explosive, "Influence"/"Arrangement" in Shady, "Site map" = world map. One i18n key per concept | Design System §07 |
| D7 | **New keyboard map**: Space pause · 1–4 speeds · B blast · S survey · C contracts · G build · V fleet · E crew · F finances · O operations · N navgrid · F5 quicksave · **Esc = close panel / cancel placement / deselect (priority: popover → modal → placement → selection → panel)** — the design's Esc cascade, implemented centrally | fixes missing Build shortcut; Esc no longer toggles settings |
| D8 | **Structured data over string parsing.** Core additions (each tiny, see §5): `state.lastBlastReport`, `state.events.lastOutcome {resultKey, effects[]}`, finance trend helper, weather forecast lookahead, driver unassign. The UI never regex-parses console output (kills today's event-outcome and blast-report parsing) | design shows effect chips and report grids that need real data; localization |
| D9 | **Old UI retired surface-by-surface**, never two versions of the same surface at once. Each phase deletes what it replaces (file + its styles + its i18n keys if orphaned). `SandboxPanel` and `LoadingScreen` (new since the spec) are re-skinned with tokens, layout preserved (Sandbox has no dedicated design comp; loading has one — follow it) | avoids drift; keeps `validate:context`/tests meaningful |
| D10 | **Minimap keeps its canvas painter** (`miniMapLayers.ts`) behind the design's new chrome (SITE header, 4 layer-toggle buttons, legend, click-to-focus). Camera frustum indicator is a stretch goal in P2 | the painting code just survived the terrain overhaul; don't rewrite it |

---

## 3. Target module layout (`src/ui/`)

```
src/ui/
  tokens.css.ts            design tokens + shared component classes (replaces styles.ts)
  icons.ts                 <bs-icon> port of icons.js
  fonts.ts + assets/fonts/ @font-face registration
  dom.ts                   el() helpers, stepper/gauge/chip/section factories (shared)
  UIManager.ts             orchestrator (panel routing, Esc cascade, update fan-out)
  shell/
    TopBar.ts              balance+trend · day/clock · weather chip+popover · speed group ·
    TopBarAlerts.ts        alert pips + NEEDS ATTENTION popover
    TopBarResponsive.ts    overflow-shedding (design's stage logic)
    ToolRail.ts            9 buttons + status dots + hidden Shady entry
    PanelDock.ts           396px dock chrome: header (icon/title/sub/close), body scroll, bsIn
    Toasts.ts              stacked, severity, CTA, click-through
    ActivityLog.ts         right drawer (z500) + unread count; ring buffer store
    SelectionBar.ts        bottom action bar for scene selection
    CommandBus.ts          debug pill + dispatched-command list
    MiniMapChrome.ts       header/layers/legend/click-focus around existing painter
  panels/
    BlastWorkshop.ts (+ blastSteps/{Drill,Charge,Sequence,Preview,Fire}.ts, blastFooter.ts)
    ContractsPanel.ts      storage strip · active · offered · closed
    BuildPanel.ts          research progress · catalog+tier pills · ramp · on-site
    CrewPanel.ts (+ crewDetail.ts, crewHiring.ts)
    FleetPanel.ts (+ fleetDealership.ts)
    SurveyPanel.ts
    FinancesPanel.ts       NEW
    OperationsPanel.ts     NEW (logistics · ore · ore report · incidents · site policy)
    ShadyPanel.ts          NEW (influence · arrangements · locked mafia teaser)
    SettingsPanel.ts       language · audio · keyboard · session
  modals/
    ModalHost.ts           scrim, z600, Esc, one-at-a-time
    PreflightModal.ts      hazard stripe · stats · predictions · warnings · DETONATE
    BlastReportModal.ts    rating · stat grid · ore report · losses · oversized CTA
    EventModal.ts          category header · choose phase · outcome phase
    ConfirmModal.ts        parameterized (dismiss/demolish/scrap/leave) — cost+consequence copy
    SavesModal.ts          slots · AUTO chip · export/import
  screens/
    MainMenu.ts            wordmark · CONTINUE w/ summary · buttons · EN/FR · ticker
    WorldMap.ts            THE PORTFOLIO: header+progress, 3 cards, criteria, lock, start
    LoadingScreen.ts       reskin of existing to the strata comp
    LevelEndScreen.ts      victory + 4 defeat causes
  scene/                   (DOM-side of scene interaction; Three.js side in src/renderer/)
    ScenePicking.ts        raycast hover/select state, entity resolution, cursor
    HoverTag.ts            tag anatomy, flip-below, terrain variant
    PlacementController.ts arm/disarm, camera remap, Esc/right-click cancel, touch
    ParamStrip.ts          instruction chip + 44px strip (grid/ramp/building/survey configs)
    pinnedRegion.ts        tutorial region → terrain pinning (from tutorialPickerRegion)
  tutorial/                existing overlay re-skinned (coach card comp), rails unchanged
  notify/
    NotificationCenter.ts  event→notification mapping, unread, toast policy, pip derivation
src/renderer/
    SelectionOverlay.ts    per-tile-quad selection mesh, border (screen-space), corners,
                           rejected/occluded treatment, hole markers, confirm flash
    PlacementGhosts.ts     building footprint ghost, ramp corridor, survey radius ring
    EntityHighlight.ts     hover/selection outline on meshes; markers for fragments
```

`UIManager` keeps today's responsibilities (setGameConsole fan-out, per-frame update, panel toggling) and gains: modal host, Esc cascade, notification center wiring, scene-selection routing. Panels keep the `show/hide/visible/update/refreshLocale/dispose` interface so the orchestrator diff stays small.

---

## 4. Phases

Ordering is dependency-driven; each phase is shippable, keeps all five channels green, and maps to one pipeline issue (`agentic-issue-creation` format). Estimated relative size in brackets.

### P0 — Foundations: tokens, fonts, icons, primitives [M]
- `tokens.css.ts`, `fonts.ts` + woff2 assets, `icons.ts` (port all glyphs incl. `star/pick/heat/explosive`), `dom.ts` factories (button variants incl. locked-research style + disabled-with-reason row, chips, gauges with threshold tick, progress with urgency colors, steppers, section headers, empty-state block).
- Wire `<bs-icon>` registration into the entry point; replace nothing yet.
- Unit tests for icon registry and factories (jsdom); a11y check of a token sample sheet page is not needed — real checks come per surface.
- **Exit:** `npm run typecheck`, `test` green; a throwaway probe page screenshot inspected for font/icon rendering. No player-visible change.

### P1 — Shell: top bar, tool rail, panel dock, toasts/log, minimap chrome [XL]
- Replace `HUD.ts` with `shell/TopBar*` (balance+trend from finance helper — §5.C; day/clock; weather **chip only** with tooltip now, popover stub behind it; segmented speed control + pause-cause chip; alert pips from `NotificationCenter` derivations; scores group with values+tooltips; bell+unread, save, SITE MAP). Implement the responsive shedding exactly as the design logic does (self-measured, hysteresis via remembered widths).
- Replace toolbar with `ToolRail` (labels per D6, status dots: blast=armed/critical, contracts=expiring, build=research done, fleet=stuck, crew=collapsed; shady hidden until `corruption.level>0`).
- `PanelDock` chrome; existing panel *contents* mount inside it unchanged for now (temporary adapter) so the game stays playable while panels are rebuilt in later phases.
- `Toasts` + `ActivityLog` + `NotificationCenter`: subscribe to the emitter events already wired in `main.ts`, plus command-result hooks (contract expiry lines, training complete, level-ups, boarding cancelled, stuck) — the tick command already prints these; add emitter events in core where only console lines exist today (§5.F). Retire `UIManager.showNotification` single-toast.
- `MiniMapChrome` around the existing painter: header, ore/nav/entities/terrain toggles (replace keyboard-only `N`), legend, click→`__cameraFocus` at clicked tile.
- Keyboard map D7 (central `KeyboardShortcuts` rewrite + Esc cascade in UIManager).
- i18n: all shell strings en+fr.
- Selector migration: `#bs-toolbar [data-panel=…]` preserved; HUD highlight targets in `tutorialSteps.ts` (`.bs-speed-btn`, `.bs-balance`, `.bs-event-badge`, `#bs-hud-scores`) re-pointed to the new nodes (keep the class names on the new elements where cheap).
- **Exit:** visual screenshots of shell states (with panel open/closed, alerts present, paused) inspected; `playtest` tutorial run green; a11y green.

### P2 — Scene selection & hover (read-only picking) [L]
- `ScenePicking` (raycaster over terrain + entity meshes; renderer exposes pickable registries — extend `BuildingMesh/VehicleMesh/CharacterMesh/FragmentMesh` with `pickables(): {object, kind, id}`), 60ms-delayed `HoverTag` (entity + terrain variants, flip-below), click→selection with `EntityHighlight` outline + dashed ring, `SelectionBar` with per-kind actions wired to existing commands: crew → DETAIL (opens Crew panel row expanded) / DISPATCH HERE (`employee dispatch`) / TRAIN; vehicle → HAUL Fx (`vehicle haul`) / UNASSIGN (needs §5.D) / FOLLOW (`__cameraFocus`); building → UPGRADE/MOVE/DEMOLISH (move enters placement in P3; until then opens Build panel); fragment → FOCUS (fragmentation order deferred, §5.H).
- Scene click on empty ground deselects (design). Esc deselects.
- Terrain hover tag shows tile coords + known survey estimate for that column + staleness — this resurrects the dead `showSurveyResult` path as data, not a panel.
- New playtest beat: select an employee by clicking the scene, open detail.
- **Exit:** interaction-mode scenario with clicks on entities, screenshots inspected (tag, outline, bar); playtest green.

### P3 — Placement layer: grid select in the scene, 2D picker retired [XL]
The Grid Select doc is the spec; implement its six states literally.
- `PlacementController`: arm/disarm, cursor, viewport inner-border, instruction chip; **camera remap** while armed (left=paint, right=orbit, middle=pan, wheel=zoom, right-click/Esc cancel, panel stays open); touch (single-finger paint, two-finger orbit/pinch, tap-tap corners, 44px handles).
- `SelectionOverlay` (renderer): per-tile quads on column tops (`gameRenderer.surfaceYAt`), 26% fill, 0.6px cell borders, cell lines <40m camera distance, 2.4px screen-space rectangle border + 0.9-tile corner accents, rejected cells (red dashed, no hole marker, silhouette preserved), occluded cells (depth-tested fill vanishes; dashed 55% outline drawn depth-test-off), hole markers at spacing intervals with numbers <30m, 220ms confirm flash, live re-layout on spacing change.
- `ParamStrip` (44px, bottom-center of free region, never over selection/panel): title block, steppers (SPACING/DEPTH/Ø), RESULT (`r×c holes · $cost` — cost from loaded product prices whenever S2 has a selection, else explosive default), CONFIRM/ESC. Warning states per the design's state inventory (cost>balance red but allowed; <4 valid tiles note; >64-tile chip warning).
- Variants: **ramp** (line drag, draggable endpoint rings, corridor = `RAMP_WIDTH`, depth stepper, `build_ramp start end depth`), **building** (footprint ghost at cursor, green/red + single blocking reason in chip, cost tag, `build <type> at tier:`; also `build move <id> to:`), **survey** (point + method radius ellipse in `#3fd0c0`, `survey <method> x: z:`).
- **Tutorial pinning on terrain**: consume `tutorialPickerRegion` (blue region, outside dims to 45% and rejects anchor, partial-match two-color fill, clock held while armed). Then **delete `TileSelectOverlay.ts`** + `siteTileShading.ts` and migrate `tutorialStages.ts` stage selectors and the `pickTile`/`dragTiles` scenario actions: re-implement those two action types in `scenario-interaction-runner.ts` to drive the new controller via exported test hooks (`window.__placement = {arm, paintRect(x1,z1,x2,z2), confirm, cancel}`) so existing scenario defs keep working with minimal edits.
- Blast panel S1 stub: the old "Grid Tool" button arms the new tool (full step UI comes in P4); Build/Survey panels' place/pick buttons switch to placement modes now.
- **Exit:** scenario defs that used the 2D picker updated & green in interaction mode; screenshots of all six states + all three variants + pinned state inspected; tutorial playtest green end-to-end (drill/build/survey steps now click the scene).

### P4 — Blast Workshop panel + preflight + blast report [XL]
- 5-step strip with live per-step state (`9 holes · 9/9 · V-pattern · TIER n · ready/blocked`), step contents per design: **Drill** (grid tool, add-hole point placement, clear w/ confirm if holes exist, pattern stat strip, hole rows: id/at/depth + status chip WET/TUBED/OK + delete); **Charge** (product cards from `ExplosiveCatalog` — name, $/kg, energy, max kg, water-sensitivity row, tier-locked with reason; amount/stemming steppers with max validation; CHARGE ALL with `9 × 18 kg · $cost` line; **Tubing block** — wet count from §5.E, stock, `tubing buy`, `tubing install` per wet hole, settled state); **Sequence** (delay-step stepper + `sequence auto delay_step:`, per-hole delay rows → click-hole-in-scene editing via P2 selection, `sequence set`); **Preview** (Analysis Suite tier list w/ owned/buyable `buy_software`, PREDICTED rows from `preview*` results with locked rows, SHOW ENERGY OVERLAY toggle → existing `BlastPlanOverlay`); **Fire** (danger-zone occupant list from `zone status` + entity positions, SOUND THE HORN → `zone clear`, pre-flight validation list from `blast_plan validate` + zone + wet checks).
- Sticky footer: PLAN COST / EST. ORE VALUE (survey-based estimate helper, §5.G) / MARGIN + FIRE (42px; disabled reasons inline).
- `PreflightModal` (stats, predictions at tier, warnings incl. buildings within blast radius — reuse the preview/projection data; DETONATE dispatches `blast`).
- `BlastReportModal` from `state.lastBlastReport` (§5.A): rating, 8 stats, ore report card, destroyed-building card, oversized-boulder card with SEND HAULERS CTA (dispatches best-fragment hauls via existing eligibility helper).
- Delete `BlastPlanUI.ts`.
- **Exit:** blast scenario defs (drill→charge→sequence→blast) green in both modes; screenshots of all 5 steps + both modals inspected; tutorial steps 5–8 playtest green.

### P5 — Money surfaces: Contracts, Finances, Operations [L]
- `ContractsPanel`: storage strip (logistics + per-ore chips), ACTIVE cards (urgency countdown colors, progress, payout/penalty, MAX-prefilled deliver → `contract deliver`, stored-of-material note), OFFERED cards (type icon, description, QUANTITY/PRICE/TOTAL, have-vs-needed bar, penalty/bonus, negotiate result inline — §5.I, ACCEPT/NEGOTIATE/DECLINE), CLOSED from `completedHistory`.
- `FinancesPanel`: balance + trend + runway (§5.C), per-category bars from `getFinancialReport`, ledger of recent transactions. Top-bar balance click opens it.
- `OperationsPanel`: logistics stat rows, ore-on-hand with unit values (OreCatalog), last ore report card, incidents from `DamageState`, **site policy** segmented control + thresholds (`set_policy`) — and remove policy from Settings.
- Delete `ContractUI.ts`.
- **Exit:** economy scenario defs green; contract tutorial steps playtest green; screenshots inspected.

### P6 — Crew & Fleet panels [XL]
- `CrewPanel` per design: roster cards (initials avatar in role color — same hue the renderer uses, name+id, morale bar, status icon tags union/injured/collapse/training/driving, need-warning pip), expanded detail (hired/location + locate→camera, needs gauges w/ 30% threshold tick, current task + progress from `taskTicksRemaining`, skills w/ stars + XP-to-next + duration effect ×, pay block with **working raise presets** dispatching `employee raise <id> amount:<n>`, training courses w/ school+tier/fee/ticks → `employee train`, DISMISS with union-blocked state + `ConfirmModal` severance copy), HIRING rows (starting qual per role, current count, cost).
- Fix task-queue duplication: show only the employee's claimed action + actions targeted at them; pool actions get one "unclaimed work" line in Operations instead.
- `FleetPanel`: traffic advisory (jam detection state), fleet cards (status chip incl. WAITING/STUCK with duration, HP, LOAD bar, driver row with UNASSIGN — §5.D, no-driver warning with TRAIN-cross-link opening Crew, HAUL·n-reachable using the existing eligibility cache, locate, scrap confirm with residual value copy), DEALERSHIP grouped tiers with stat-multiplier lines from defs.
- Core fixes riding along: hire-name dedup (§5.J).
- Delete `EmployeePanel.ts`, `employeeDetailSections.ts`, `employeeTrainingSection.ts`, `VehiclePanel.ts`, `vehicleHaulButton.ts` (eligibility cache moves to a shared helper).
- **Exit:** hire/train/vehicle tutorial steps playtest green; employee/vehicle scenario defs green; screenshots of roster, detail, fleet, dealership inspected. Raise verified by a new unit + scenario assertion (morale/salary changes).

### P7 — Survey panel + weather popover [M]
- `SurveyPanel`: method cards (cost, accuracy, radius, depth, duration, note incl. seismic damage warning), PICK TARGET IN SCENE (P3 variant), results with age + stale state (`isSurveyStale`) + locate→focus + ore bars + confidence.
- Weather popover on the top-bar chip: current effect line, **14-day outlook** (§5.B forecast API; day-0 cell derived from current state so they can't disagree), reliability bands, flood-risk bars, advisory line composed from forecast + wet-hole state.
- Survey heatmap overlay: stale results fade (renderer already draws confidence overlay — add stale dimming).
- Delete `SurveyUI.ts`.
- **Exit:** survey tutorial step playtest green; forecast unit-tested deterministic; screenshots inspected.

### P8 — Events, game-over, world-map screens [L]
- `EventModal`: category identity (icon/color per event category — extend `EventDef` with `category` if absent, else map by pool grouping), CLOCK HELD chip, options with consequence chips **where the def declares them** (§5.A extends options with optional `effects` hints; options without hints render label-only), outcome phase from `state.events.lastOutcome` (headline via `resultKey`, effect chips from structured effects), DISMISS & RESUME.
- `LevelEndScreen`: victory (stars from `calculateStarRating` with per-criterion rows, 8-stat grid from `LevelStats`, REPLAY / CONTINUE TO <next level>) and defeat variants (bankruptcy/arrest/ecological/revolt: icon, satirical body, 4 stats, tip box, BACK TO PORTFOLIO / RETRY). Triggered on `levelEnded`/`levelEndReason` and the four emitter events.
- `MainMenu` + `WorldMap` rebuilt to the Screens comps: menu (wordmark, CONTINUE with live save summary from backend meta, NEW CAMPAIGN, SANDBOX, TUTORIAL, LOAD, SETTINGS buttons w/ hints, EN/FR, version, ticker; in-game chrome fully hidden pre-game — fix the leak), Portfolio (campaign star progress, biome cards, criteria rows, lock text, START/RESUME). `LoadingScreen` reskin to the strata comp (stages already exist).
- `SavesModal` per design (slot cards, AUTO chip, empty SAVE HERE, export/import, load/delete confirms). Delete `SaveLoadUI.ts` panel form (backend logic is reused).
- Delete old `MainMenu.ts` rendering (keep the callbacks contract for `main.ts`).
- **Exit:** event scenario (fire→choose→outcome) green with structured outcome; game-over scenarios (bankruptcy etc. — defs exist) show the screens; menu/world-map/loading screenshots inspected; full tutorial playtest green.

### P9 — Shady panel + reveal [M]
- Rail reveal when `corruption.level > 0 || mafia.unlocked` (unlabeled icon, design's intro toast "A new contact" on first reveal — driven by a notification-center rule on corruption events).
- `ShadyPanel`: INFLUENCE meter + thresholds copy, ARRANGEMENTS cards (5 targets: name, success % from `getSuccessRate`, flavor note, cost, MAKE THE CALL → `corrupt target: cost:` + confirm), OTHER SERVICES locked teaser → when `mafiaUnlocked`: smuggling toggle (`mafia smuggle`), exposure meter, arranged accident / frame flows (`mafia accident/frame employee:`) each behind explicit confirms with stated risks.
- **Exit:** corruption scenario def (exists: corruption/mafia defs) driven through UI in interaction mode; screenshots inspected.

### P10 — Tutorial re-skin, settings, polish, hardening [L]
- Coach card to design comp (progress bar, icon, title, CLOCK HELD chip, STEP x/y, body, "do this" line with control name, close); highlight = triple-ring glow class; rails logic untouched. Re-point every `highlightTarget`/stage selector that changed in P1–P9 (final sweep — most were migrated per phase).
- `SettingsPanel` final: language, **audio sliders** (master/ambient/SFX/UI — wire `AudioManager` gain nodes; add volume API if missing), keyboard reference (from the D7 map, single source), REPLAY TUTORIAL, SAVE & LOAD, RETURN TO MAIN MENU (confirm with autosave age).
- `prefers-reduced-motion` support (drop transforms, keep opacity; pip pulse → static).
- Full-pass: `npm run a11y` on every surface, `check-i18n-parity`, `ui:diagnostic`, all scenario defs both modes, all 3 playtests, `npm run validate`. Update `docs/ui-redesign-spec.md` §3 (current-state) to point at the new implementation, and prune orphaned i18n keys.
- **Exit:** the §7 acceptance checklist of the spec answered YES for all 12 questions, evidence linked (screenshots + playtest output) in the PR.

**Parallelization:** P5, P6, P7 are independent of each other after P4; P8's screens are independent of P5–P7 (only EventModal needs §5.A which lands with P4's core batch). P9 anytime after P1. The pipeline can run them as separate issues; P0→P1→P2→P3→P4 is the critical path.

---

## 5. Core/console additions (small, enumerated — each lands with the phase that needs it)

| ID | Change | Where | Needed by |
|----|--------|-------|-----------|
| A | `state.lastBlastReport` (rating, cleared, cracked, fragments, oversized, projections+maxDistance, volume, spent, oreValue, destroyedBuildings[]) written by `blastCommand`; `state.events.lastOutcome {eventId, resultKey, effects: [{kind:'cash'|'score'|'other', key, delta, textKey?}]}` written by `resolveEvent`; optional `effects` hints on `EventOption` defs | `src/core/mining/BlastExecution` consumers, `EventResolver`, `EventPool` types | P4, P8 |
| B | Weather forecast: `forecast(cycle, n=14): WeatherState[]` — deterministic seeded lookahead (clone RNG, simulate transitions without mutating), + per-hole wet tracking if absent: `wetHoles(state, weather): holeId[]` derived from weather + `tubingState.installedHoles` (spec: rain fills uncovered holes) | `src/core/weather/WeatherCycle.ts`, small helper in mining | P4 (wet chips), P7 (outlook) |
| C | Finance trend: `netPerHour(finances, tickCount, window=24)` + `runwayHours(cash, net)` pure helpers | `src/core/economy/Finance.ts` | P1, P5 |
| D | `vehicle driver <id> none` → unassign (validate not mid-haul; clears driverId, frees employee) | `Vehicle.ts` + `commands/vehicle.ts` | P2, P6 |
| E | (folded into B) wet-hole derivation | — | — |
| F | Emitter events where only console lines exist: `contract:expired`, `training:complete`, `employee:levelup`, `employee:stuck`, `boarding:cancelled`, `traffic:jam` (tick pipeline already computes all of these) | `commands/events.ts` tick + `GameLoop` | P1 |
| G | Blast value estimate: `estimateBlastOreValue(plan, surveyResults, catalogs)` — survey-confidence-weighted, pure | `src/core/mining/` | P4 |
| H | *(optional, deferred)* `vehicle fragment <vid> fragment:<fid>` work order for rock_fragmenter; repair-at-depot flow | core + command | post-P10 backlog |
| I | Negotiation uses best manager skill: pass `management` proficiency instead of hardcoded 0; return structured changes | `commands/economy.ts` | P5 |
| J | Hire-name dedup: include roster length / `nextEmployeeId` in the hire RNG seed | `commands/employees.ts` | P6 |
| K | Save meta: add `levelId` (and optional thumbnail dataURL) to `SaveMeta` | `SaveBackend` + `SavesModal` | P8 |

Every core change follows core-purity rules (pure, seeded, tested in mirrored `tests/unit/` path) and gets scenario coverage where observable.

---

## 6. Selector & harness migration map

| Old (load-bearing) | New | Migrates in |
|---|---|---|
| `#bs-hud-top .bs-speed-btn` (tutorial step 0/21) | speed segment container keeps class `bs-speed-btn` on the group | P1 |
| `#bs-hud-top .bs-balance`, `.bs-event-badge`, `#bs-hud-scores` | same class names on new nodes | P1 |
| `#bs-toolbar [data-panel="X"]` | unchanged (rail buttons keep `data-panel`; ids: blast/contracts/build/vehicles/crew→`crew`… keep legacy values `employees`? **Decision: keep existing `data-panel` values** incl. `employees`, `survey`, `settings`; add `finances`, `ops`, `shady`) | P1 |
| `#bs-tile-select-confirm`, `pickTile`/`dragTiles` actions | `window.__placement` bridge + runner re-implementation | P3 |
| `.bs-build-buy-btn`, `.bs-build-ramp-btn`, `#bs-survey-run` | `data-action` attributes preserved on the new buttons (`place`, `ramp`, `survey-run`) | P3/P5/P7 |
| `.bs-detail-toggle`, `data-employee-id`, `.bs-train-btn[data-skill]` | unchanged on new crew rows | P6 |
| `.bs-contract-accept/negotiate/decline/deliver` | unchanged classes on new buttons | P5 |
| `#bs-blast-panel` button `data-action`s (grid-tool, clear-holes, charge-all, auto-sequence, preview, execute) | unchanged values on new controls | P4 |
| `__uiState` panel id list | extend with new panel ids | P1 |
| `probeUiActions` (`uiActionProbe.ts`) | update per phase — it enumerates concrete controls | each |

`npm run scenarios` (command mode) is selector-free and stays green throughout; interaction-mode defs are updated in the phase that moves their targets.

---

## 7. Verification matrix (per phase, from the Verification Gate)

| Phase | static | logic | scenario | visual | playability | extra |
|-------|--------|-------|----------|--------|-------------|-------|
| P0 | ✓ | ✓ | — | probe screenshot | — | — |
| P1 | ✓ | ✓ | ✓ (defs with UI asserts) | shell states ×6 | tutorial playtest | a11y, i18n-parity, ui:diagnostic |
| P2 | ✓ | ✓ | new interaction def | hover/selection ×4 | new select-entity beat | a11y |
| P3 | ✓ | ✓ | migrated picker defs | 6 states + 3 variants + pinned | full tutorial | a11y |
| P4 | ✓ | ✓ | blast defs both modes | 5 steps + 2 modals | tutorial steps 5–8 | a11y |
| P5 | ✓ | ✓ | economy defs | 3 panels | contract steps | a11y, i18n |
| P6 | ✓ | ✓ | employee/vehicle defs | 4 shots | hire/train/vehicle steps | a11y |
| P7 | ✓ | ✓ | survey def | panel+popover | survey step | forecast determinism unit |
| P8 | ✓ | ✓ | event + game-over defs | menu/map/loading/end ×6 | full tutorial | a11y |
| P9 | ✓ | ✓ | corruption def (interaction) | panel ×2 | — (no tutorial beat) | a11y |
| P10 | ✓ | ✓ | ALL | ALL key surfaces | ALL playtests | a11y, i18n-parity, validate, diagnostic |

Every visual claim = PNG captured **and opened/described** per the rendering rule. Playability = `npm run playtest` with `N/N beats reached` quoted.

---

## 8. Risks & mitigations

1. **Terrain overhaul interplay (P3):** `SelectionOverlay` samples heights via `surfaceYAt` on the new chunked `LandscapeMesh`; blasts/ramps change heights → overlay listens to the same rebuild events as `BlastPlanOverlay` and re-samples. Screen-space-constant border width needs a `Line2`-style solution or per-frame width update from camera distance — prototype first in P3 before committing to an approach.
2. **Camera remap regressions:** `CameraController` gains an `interactionMode` switch; playtests + a dedicated interaction scenario assert orbit still works while armed (right-drag) and after disarm.
3. **Big-bang panel swaps breaking the tutorial mid-phase:** each panel phase runs the full tutorial playtest before merge; the rails' `isReachable` gives immediate signal when a selector went missing.
4. **Font/licensing/bundle size:** subset woff2 (latin) ≈ 300KB total; acceptable. Fallback stack keeps the game legible if fonts fail.
5. **Design/content drift (D5):** any place the design's sample data disagrees with core catalogs, render core data in design layout. A follow-up content issue can rename catalogs game-wide if the user wants the design's names.
6. **fr length:** dock is 396px per design for this reason; every phase's i18n commit includes fr strings and a screenshot in fr for the densest surface of that phase.

---

## 9. Open questions for the user (defaults applied meanwhile)

1. **Adopt the design's fictional names** (explosives "The Nudge"…"Mister Kaboomington", vehicle/building names, "Analysis Suite") as the new localized content? Default: keep current names, layout ready either way.
2. **Sandbox setup screen** has no design comp — re-skinned with tokens as a Portfolio-style card form. OK, or should Claude Design produce a comp?
3. **Fragmenter/repair work orders** (§5.H) are gameplay features the design references (SEND HAULERS covers hauling; fragmentation is teased). Schedule as core feature issues after P10?
4. Save **thumbnails** (§5.K): canvas grab adds save-size; ship without if it complicates IndexedDB migration.

---

## 10. Suggested issue breakdown for the pipeline

One issue per phase (P0…P10), each carrying: scope summary from §4, file list, §5 core items for that phase, §6 selector rows for that phase, §7 verification row as acceptance criteria, and a link to the exact design file/section. P5/P6/P7 may be filed as parallel after P4 merges; P9 anytime after P1. Total: 11 issues, critical path 6 (P0–P4, P10).
