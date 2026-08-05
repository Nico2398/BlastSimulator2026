# BlastSimulator2026 — UI Redesign Specification

**Audience:** Claude Design (visual/UX redesign), then the implementation session that wires the new design into the game.
**Status:** Entry-point document. Everything the UI must show or make reachable is inventoried here; nothing outside this file needs to be read to design the UI.
**Sources:** full read of `src/ui/`, `src/renderer/`, `src/console/commands/`, `src/core/`, the gameplay skill specs (`.claude/skills/gameplay-*`), and screenshots of every current UI surface (captured 2026-08-02, `screenshots/scenario-zz-ui-tour-interaction/`, not committed).

---

## 1. What this game is

Satirical open-pit mine management game — *Theme Hospital meets capitalism*. The player surveys terrain, drills blast holes, loads explosives, detonates, hauls the rubble, and sells it via contracts, while managing minion-like employees (hunger/fatigue/morale/unions), vehicles, buildings, four public-image scores, random events (unions, politics, weather, lawsuits), and an optional dark path (bribery → mafia). 3-level campaign with profit thresholds and star ratings.

**Tone requirements for all UI copy and visual language:**
- Satirical, absurd, dark-humored corporate. Money is the punchline (subtitle: "DIG · BLAST · PROFIT").
- Cartoon 3D (Minion-like characters, chunky placeholder meshes). The UI may be more polished than the placeholder art, but must not clash with a cartoon world.
- Everything fictional is humorously named (rocks: Cruite/Grumpite/Obstiite; explosives: Pop-Rock/Big Bada Boom/Dynatomics; buildings: "The Cells" → "Unnecessarily Luxurious Hotel"). The UI must surface these names, not internal ids.

---

## 2. Hard constraints (the redesign must respect these)

1. **Tech stack:** Vanilla TypeScript DOM overlaid on a full-screen Three.js canvas. No React/Vue. All CSS is injected from `src/ui/styles.ts`. New design = new markup + new stylesheet, same architecture.
2. **Every UI action dispatches a console command** through `window.__gameConsole(cmd)` (`UIManager.setGameConsole`). The UI never mutates `GameState` directly; it reads state each frame via `update(state)`. The redesign keeps this contract — §10 lists the full control→command map.
3. **Per-frame updates:** `UIManager.update()` runs every rendered frame. Panels rebuild DOM only when a structural signature changes and write drifting values (gauges, countdowns) in place — otherwise buttons detach mid-click. Any new panel must follow this pattern.
4. **i18n:** English + French from day one. Every player-visible string goes through `t('key')` with entries in `src/core/i18n/en.json` + `fr.json`. French strings run ~20–30% longer — layouts must tolerate it (current build rows already break; see §5 defects).
5. **Testing hooks are API:** stable ids/classes/data attributes are load-bearing (`#bs-toolbar [data-panel=…]`, `data-action`, `#bs-tile-select-confirm`, `.bs-detail-toggle`, `.bs-train-btn`, `data-employee-id`, …). The playtest harness (`__uiActions`, `__probeSelector`) and tutorial rails target them. The redesign may rename them, but then every tutorial `highlightTarget` (`src/ui/tutorialSteps.ts`), stage selector (`src/ui/tutorialStages.ts`), playtest definition (`scripts/playtests/`), and scenario def (`scripts/scenario-defs/*-visual.json`) must be updated in the same change. Prefer keeping ids.
6. **Tutorial rails:** while the tutorial runs, `body.bs-tutorial-guided` makes everything inert except elements marked allowed; one control gets a highlight class. The new design must keep: a bottom-docked coach card that never covers the highlighted control, a per-step highlight that works on any control (toolbar buttons, HUD buttons, rows inside panels), and a "clock held" indicator.
7. **Accessibility:** `npm run a11y` enforces WCAG AA contrast on every visible text element. Current palette (amber-on-dark-brown) passes; keep contrast ≥ AA in the redesign. Hit targets: several current buttons are 9–10px font, ~16px tall — enlarge.
8. **Viewport:** desktop-first, 1280×720 minimum; must remain usable at 1920×1080. Touch camera controls exist (orbit/pinch), so avoid hover-only affordances where practical.
9. **Z-order today** (for reference): panels 100, HUD top bar 150, toolbar 200, tile-picker overlay 500–800 range, confirm/event modals 600, main menu 9999, settings 10000 (must beat menu — settings opens from the main menu too).
10. **Determinism:** UI never generates randomness; anything random happens in core via seeded RNG.

---

## 3. Current screen inventory — superseded by the finished redesign

This section originally read as "the before picture": every pre-redesign surface (`MainMenu.ts`'s bare button stack, `BlastPlanUI.ts`, `ContractUI.ts`, `EmployeePanel.ts`, `SettingsMenu.ts`'s app-only cog wheel, `TileSelectOverlay.ts`'s full-screen 2D picker, and the rest) with its observed defects, one subsection per surface. Phases P0–P10 of `docs/ui-implementation-plan.md` closed every defect it listed. The old text is no longer accurate — rather than rewrite 16 subsections to describe the new screens in the same before/after-defect prose (redundant with §6, which already specifies each target surface, and now describes what is actually built rather than a target), this section instead maps old → new so anything still linking to it by name finds its way.

| Old surface (§3.x, pre-redesign) | Replaced by | Notes |
|---|---|---|
| §3.1 `MainMenu.ts` bare button stack | `src/ui/MainMenu.ts` (rebuilt) | §6.1 |
| §3.2 World map card list | `src/ui/screens/WorldMap.ts` | §6.2; real `calculateStarRating` breakdown now shown |
| §3.3 In-game shell (top bar, floating buttons, toolbar, minimap) | `src/ui/shell/TopBar.ts`, `ToolRail.ts`, `Toasts.ts`, `ActivityLog.ts`, `MiniMap.ts` (docked panel host: `UIManager.ts`) | §6.3, §6.10; floating Saves/Return-to-Map buttons folded into TopBar's right cluster |
| §3.4 `BlastPlanUI.ts` | `src/ui/panels/BlastWorkshop.ts` + `PreflightModal.ts` + `BlastReportModal.ts` | §6.4 |
| §3.5 `ContractUI.ts` | `src/ui/panels/ContractsPanel.ts` | §6.5 |
| §3.6 `BuildMenu.ts` (pre-redesign chrome) | `src/ui/BuildMenu.ts` (P10: rebuilt onto the shared `bsx-root` docked-panel convention; load-bearing tutorial selectors preserved) | §6.6 |
| §3.7 `TileSelectOverlay.ts` full-screen 2D picker | Retired (P3) — placement happens in the 3D scene: `src/ui/scene/PlacementController.ts`, `ParamStrip.ts`; the picker survives only as the tutorial-pinned fallback | §6.9 |
| §3.8 `VehiclePanel.ts` | `src/ui/panels/FleetPanel.ts` + `fleetDetailSections.ts` | §6.7 |
| §3.9 `EmployeePanel.ts` | `src/ui/panels/CrewPanel.ts` + `crewDetailSections.ts` | §6.8; raise-button bug and duplicate-name bug both fixed (§5, core items D/J) |
| §3.10 `SurveyUI.ts` | `src/ui/panels/SurveyPanel.ts` | §6.9 (weather popover), coverage/staleness now shown |
| §3.11 `SettingsMenu.ts` | `src/ui/panels/SettingsPanel.ts` (P10) | §6.15; site policy moved to `OperationsPanel.ts` (§6.13); real `AudioManager` volume sliders (master/effects/ambient/ui); keyboard reference mounted (was dead code); REPLAY TUTORIAL, SAVE & LOAD, RETURN TO MAIN MENU (autosave-age-aware confirm) added |
| §3.12 `SaveLoadUI.ts` | `src/ui/panels/SavesModal.ts` (P8) | §6.16; confirms on delete, real level/summary shown |
| §3.13 `EventDialog.ts` | `src/ui/panels/EventModal.ts` (P8) | §6.11; structured `effects` (§5 core item A), category identity, no more console-text parsing |
| §3.14 `TutorialOverlay.ts` (bottom-docked card) | Re-skinned in place (P10) — same file, `src/ui/TutorialOverlay.ts`; DOM rebuilt in `tutorialOverlayDom.ts` | §6.17; rails, tick budget and every `highlightTarget`/stage selector unchanged (audited clean, zero stale selectors found); highlight class repointed from the pre-redesign pulsing `bs-tutorial-highlight` to the design system's static three-ring `bsx-highlight` (P0 had ported the token, nothing pointed the rails at it until now) |
| §3.15 Toasts + no game-over screen | `src/ui/notify/NotificationCenter.ts`, `Toasts.ts`, `ActivityLog.ts` (severity, icons, log) + `src/ui/screens/LevelEndScreen.ts` (P8, new) | §6.11 |
| §3.16 3D scene, camera-only | Scene selection/hover/placement added (P2/P3) — `src/ui/scene/`; picking, hover tags, selection action bar | §6.9 |

Corruption/mafia (`src/ui/panels/ShadyPanel.ts`, reveal wired through `ToolRail.ts`) and the Finances/Operations split (`FinancesPanel.ts`, `OperationsPanel.ts`) didn't exist pre-redesign at all — see §6.12–§6.14.

---

## 4. Exhaustive feature inventory

Legend — where the feature is reachable today:
**[UI]** clickable in game · **[scene]** visible in 3D scene · **[map]** on minimap · **[console]** console command only (invisible to players) · **[dead]** code exists, wired nowhere · **[missing]** specified in design docs, not not built or not surfaced anywhere.

### 4.1 Meta / campaign / session
| Feature | Today | Notes / data available |
|---|---|---|
| New campaign, level select, locks, stars | [UI] menu+world map | `CampaignState.levels{unlocked,completed,bestSessionProfit,cumulativeProfit}`, `Level{nameKey,descKey,difficultyTier,unlockThreshold,startingCash,mineType,grid*}` |
| Tutorial start | [UI] menu button | auto-starts on first level entry if never completed (`localStorage bs_tutorial_done`) |
| Star rating detail (profit/safety/ecology pass) | [console] `stats` | `calculateStarRating` |
| Level stats (wealth, max depth, volume blasted, blasts, casualties, best ecology/safety, unique ores) | [console] `stats` | `LevelStats` — no UI |
| Campaign status per level | [console] `campaign` | |
| Win: profit threshold reached | toast-less; `levelEnded` flag | **no victory screen** [missing] |
| Lose: bankruptcy / arrest / ecological shutdown / worker revolt | toast warnings only | each has state w/ countdowns (`bankruptcy.ticksBelowZero` etc.) — **no game-over screen** [missing] |
| Save slots + autosave + export/import | [UI] | `SaveBackend.list → SaveMeta{name,timestamp,campaignSummary}` |
| Quick save/load | [UI] settings (quicksave slot), F5 | console `save/load slot:` named slots |
| Language en/fr | [UI] settings | `setLocale` + full re-render path exists |
| Audio (ambient, blast, UI, event, weather channels) | code only | **no volume/mute UI** [missing] |
| Keyboard shortcut reference | [dead] `makeHelpPanel` never mounted | |
| Quit to menu / return to world map | [UI] settings + floating button | |

### 4.2 Time, weather, environment
| Feature | Today | Notes |
|---|---|---|
| Day/hour clock | [UI] top bar | tick = 1h, 24/day |
| Pause / resume | [UI] speed btn state, Space | `time pause/resume`; events auto-pause |
| Speed 1/2/4/8 | [UI] cycle btn, keys 1–4 | `time speed N` |
| Current weather | [UI] emoji + tooltip | 7 states (sunny→storm, heat, cold) |
| Weather effects (rain fills holes, water-sensitive explosives fail, porous rock infiltration) | simulated, invisible | **no per-hole water status, no forecast** [missing] |
| Weather debug set/advance | [console] | |

### 4.3 Economy
| Feature | Today | Notes |
|---|---|---|
| Cash balance | [UI] top bar | red when negative |
| Income/expense report by category, transactions, net profit | [console] `finances` | `FinanceState.transactions{tick,type,amount,category,description}`, categories: contracts/bonus/salaries/maintenance/fuel/fines/construction/equipment/corruption/mafia — **no Finances panel** [missing] |
| Contract offers (qty, $/kg, deadline) | [UI] | `Contract` also has `penaltyAmount`, `earlyBonus`, `materialId`, `type` (ore_sale/rubble_disposal/supply) — not shown |
| Accept / decline | [UI] | |
| Negotiate | [UI] button, result invisible | outcome text console-only; manager skill unused (0 passed) |
| Active contract progress + deliver | [UI] | delivery consumes stored ore via logistics |
| Completed contract history | state only | `contracts.completedHistory` [missing] |
| Contract expiry penalty | console line + cash hit | needs notification + row urgency [missing] |
| Storage: fragments on-ground / in-transit / stored, stored kg vs capacity | [console] `fragments status` | `LogisticsState` — **no logistics/storage UI** [missing] |
| Collected ore by type (sellable inventory) | state only | `collectedOre{oreId:kg}` [missing] |
| Ore catalog (names, value/kg, rarity) | data | `OreCatalog` [missing in UI] |

### 4.4 Mining pipeline
| Feature | Today | Notes |
|---|---|---|
| Survey methods, cost, accuracy | [UI] | radius/depth/time per method not shown |
| Survey target pick | [UI] tile picker | should be scene-based |
| Survey queue/progress | [UI] status line | pending actions also ghost in scene |
| Survey results (ore densities, confidence) | [UI last 4] + [scene] heatmap + [map] dots | full `estimates` per column available; staleness (`isSurveyStale`, 100 ticks) invisible |
| Post-blast ore report (yield vs estimate, ratio) | [console] `survey ore_report` + events | Lucky Strike / Barren Blast / Legendary Vein / Absurdium Jackpot events fire via event dialog |
| Drill plan: grid | [UI] | rows/cols derived from dragged area ÷ spacing |
| Drill plan: single hole add | [console] `drill_plan add` | [missing in UI] |
| Hole list w/ charge + delay | [UI] | depth/diameter per hole not shown in list |
| Clear plan | [UI] | |
| Charge per hole / all | [UI] | explosive catalog data (cost/kg, max charge, water sensitivity, min rock tier, 8 types) not shown; total blast cost never computed for player |
| Detonation sequence auto V-pattern | [UI] | `delay_step` param hidden (default 25ms) |
| Per-hole delay set / sequence show | [console] | [missing in UI] |
| Tubing (waterproof holes): buy stock, install per hole | [console] only | **entire feature invisible** [missing]; interacts with weather + water-sensitive explosives |
| Blast preview: energy / fragments / projections / vibrations | [scene] overlay tint (tier-gated) + [console] numbers | no numeric panel [missing] |
| Software tiers 1–4 (unlock previews) | [console] `buy_software` | **not purchasable in UI** [missing] |
| Blast plan save/load/validate/list | [console] `blast_plan` | [missing] |
| Blast validation errors (per-hole issues) | [console] | UI shows raw text in status line only |
| Execute blast + confirm | [UI] | |
| Blast report (rating, cleared/cracked, fragments, oversized, projections, volume, ore value, destroyed buildings) | [console]; 1-line UI toast | needs real report surface [missing] |
| Safety zone define/clear/status (evacuation before blast) | [console] `zone` | design says required pre-blast; **no UI, no scene display** [missing] |
| Ramp carving | [UI] build panel (area+depth) | cost revealed only in result message |
| Oversized boulders → fragmenter workflow | [scene] fragments exist; `fragment_debris` action type | no UI to order fragmentation [missing] |

### 4.5 Buildings & research
| Feature | Today | Notes |
|---|---|---|
| Catalog 9 types × 3 tiers, costs | [UI] | tier flavor names only visible post-placement; footprint size never shown |
| Place (flat ground, no overlap, protected voxels) | [UI] via tile picker | placement errors surfaced as raw console text |
| Move / upgrade / demolish | [UI] | upgrade = demolish+construct cost; demolish cost on hover only; no confirms |
| Tier lock via Research Center | [UI] gating + Queue Research | research task cost/duration/conditions shown only in failure messages |
| Research queue progress | [console] `research status` | ticksRemaining per task — **no visible progress** [missing] |
| Building HP / damage / destruction | [console] list; scene removes mesh | blast-destroyed buildings only in blast report; explosive-warehouse secondary blast in core |
| Capacity & effects per building (beds, storage kg, training offered, wellbeing) | data in defs | [missing in UI] |
| Upkeep per tick (buildings, vehicles) | charged silently | finances categories exist [missing] |
| Living-quarters overcapacity penalty | simulated | occupancy never shown [missing] |

### 4.6 Vehicles
| Feature | Today | Notes |
|---|---|---|
| Fleet list, status, HP | [UI] | task string is raw (`idle/moving/hauling…`) |
| Buy 5 roles × 3 tiers | [UI] | stats (speed/capacity/workRate/maintenance) in defs, not shown |
| Assign driver (licence-filtered) | [UI] | boarding is walk-then-board (arrival-gated); walking state invisible |
| Unassign driver | nothing | [missing] |
| Haul best reachable fragment | [UI] contextual button | manual fragment choice [missing]; phase (to fragment/to depot) invisible |
| Move vehicle to point | [console] `vehicle move` | [missing in UI] |
| Scrap | [UI] | no confirm, no value shown |
| Waiting/traffic status, stuck flag | state | TrafficJamEvent fires; per-vehicle status [missing] |
| Broken → repair at depot | spec'd | vehicle `hp`, depot exists; repair flow [missing] |
| Payload kg / capacity | state | [missing] |
| Drill rig / digger / fragmenter / destroyer work orders | roles purchasable; tasks exist in core (`drill_hole`, `dig_voxel`, `fragment`, `demolish` specs) | **no UI to order any vehicle work**; drilling currently happens instantly via drill_plan command [missing] |

### 4.7 Employees
| Feature | Today | Notes |
|---|---|---|
| Roster + morale/union/injured/collapsing | [UI] | |
| Hire 5 roles (cost) | [UI] | starting quals per role not shown |
| Fire (union-blocked) | [UI] | no confirm |
| Raise | [UI] **broken** (missing amount arg) | needs amount UX |
| Skills + stars + XP progress | [UI detail] | XP thresholds in balance config |
| Needs gauges + thresholds | [UI detail] | roster-level warning [missing] |
| Active task + queue | [UI detail] | pool actions duplicated under every employee; progress ticks remaining [missing] |
| Salary breakdown | [UI detail] | |
| Training courses (fee, duration, target level), in-progress badge | [UI detail] | tier of school affects speed — shown only via fee/ticks |
| Assign skill directly | [console] debug `employee assign_skill` | keep out of player UI |
| Dispatch to work at x,z | [console] `employee dispatch` | generic work order [missing in UI] |
| Employee position / locate in scene | [scene] dots only | no selection or follow [missing] |
| Rest/shift state (resting at building, shift cycle) | simulated | `restTicksRemaining`, shift events — invisible [missing] |
| Deaths / accidents log | `DamageState.accidents`, deaths | [missing] |

### 4.8 Scores, events, corruption, mafia
| Feature | Today | Notes |
|---|---|---|
| 4 scores | [UI] bars | numeric values via console `scores`; cause breakdown [missing] |
| Event dialog + resolution | [UI] | outcome parsed from EN console text (fragile) |
| Event pending badge + auto-pause | [UI] | |
| Event timers per category | [console] `event timers` | design intends hidden timers — fine to keep hidden, but risk indicators are a design option |
| Event history | `firedEventIds` only | [missing] |
| Corruption: bribe 5 targets, level, success rate, attempts, scandal risk | [console] `corrupt` | **flagship feature with zero UI** [missing] |
| Mafia: unlock, exposure risk, smuggling toggle + income, arranged accidents, framing (2-step) | [console] `mafia` | **zero UI** [missing] |
| Lawsuits / arrest risk from corruption | events + arrest state | [missing surfacing] |

### 4.9 Scene/renderer features (already built, must be kept/leveraged)
Blast overlay (holes, charges, delays, tier-gated preview), ghost previews of pending actions, survey heatmap, fragments physics, blast VFX, weather sky, role-colored minions, waiting-queue vehicle offsets, camera frame/focus/reset bridges, per-command re-sync.

### 4.10 Input map today
`Space` pause · `1–4` speeds · `B` blast · `C` contracts · `V` vehicles · `E` employees · `S` survey · `N` navgrid overlay · `F5` quicksave · `Esc` settings toggle. **No shortcut for Build.** None of this is discoverable in-game (help panel dead).

---

## 5. Known bugs the redesign must fix (UI-adjacent)

1. **Raise button dead** — must send `employee raise <id> amount:<N>` (add an amount stepper or preset amounts).
2. **Duplicate hire names** — same-tick hires share an RNG seed (core fix, but the UI roster must remain usable with duplicates: show id/portrait distinctly).
3. Top-right collision: Paused/event badge vs floating Saves/Return-to-Map buttons — unify into one bar layout.
4. Build rows overflow panel width; French makes it worse.
5. Toolbar "Crew" vs panel title "EMPLOYEES" mismatch (pick one term everywhere; suggestion: Crew).
6. Minimap crosshair cursor with no click behavior — either make it clickable (focus camera) or change cursor.
7. `⛏` difficulty glyphs render as tofu in some environments — use drawn icons or repeated SVG, not raw emoji.
8. Settings' policy section reachable from main menu with no game — must be hidden or disabled pre-game.
9. Event outcome parsed from localized console text — implementation should return structured effects; design should present effect chips (e.g. `-$3,000`, `Well-being +5`).
10. In-game chrome (HUD/toolbar/minimap) visible behind/around the main menu — menu state must fully own the screen.
11. UI money guards exist but core allows negative silently (build/hire/buy through console paths); the new HUD must make negative balance and its bankruptcy countdown *loud*.

---

## 6. Target UI specification

This is the layout/feature contract for the redesign. Visual style (colors, type, spacing, iconography, motion) is Claude Design's to define within §1 tone and §2 constraints. Information architecture below is required; naming may be polished as long as i18n keys cover it.

### 6.0 Global shell
- **Regions:** top status bar · right tool rail (or dock) · left contextual panel stack · bottom-right minimap · bottom-center tutorial/coach area · toast/notification stack (top-center or right, below bar) · modal layer (events, confirms, pickers) · full-screen states (menu, world map, level end).
- One primary panel open at a time is acceptable (current model), but panels must never cover the top bar, minimap, or coach card.
- Every disabled control must carry a *reason* (tooltip or inline line — pattern already used by Survey's status line; generalize it).
- Every destructive/irreversible action (Fire, Demolish, Scrap, Delete save, overwrite save, BLAST) gets a themed confirm with the cost/consequence stated. BLAST confirm doubles as pre-flight check (see 6.4).
- Money formatting: `$12,345`, negative `-$12,345` in red (helper `formatBalance` exists). Prices per kg with 2–3 decimals (`formatPricePerKg`).

### 6.1 Main menu (full-screen)
Required: game logo/title treatment, subtitle gag, buttons **Continue** (only when a campaign/save exists — jumps to world map), **New Campaign**, **Tutorial**, **Load Game** (slot panel), **Settings**, language quick-switch, version string. Background: idle 3D scene or stylized key art (designer's choice). Optional satirical ticker/flavor line. In-game chrome fully hidden while menu is up.

### 6.2 World map / level select (full-screen)
Per level card/node: name, flavor description, difficulty (1–3 drawn pickaxe icons), lock state + unlock requirement (`$X profit on <level>`), earned stars with breakdown on hover/expand (profit ✓/✗, safety ✓/✗, ecology ✓/✗ from `calculateStarRating`), best profit + cumulative profit, mine type/biome hint (desert/mountain/tropical), **Start / Resume**. Campaign-complete celebration state. Back to menu. Design freedom: make it feel like a map (path between 3 sites), not a list.

### 6.3 HUD top bar
Left→right (single coherent bar, no floating strays):
1. **Balance** with subtle per-tick delta indicator (net income/expense trend from `FinanceState`), click → opens Finances panel (new, 6.12).
2. **Day/time** + weather icon (tooltip: state name + one-line gameplay effect, e.g. "Heavy rain — uncovered holes are filling with water").
3. **Speed control**: pause + 1/2/4/8 as discrete segmented buttons (not a blind cycle), clear Paused state. Auto-pause cause shown ("Paused — event").
4. **Alert cluster**: event badge (click → reopen pending event dialog), plus warning pips for: bankruptcy countdown, ecology/wellbeing critical, worker-revolt risk, contract about to expire, employee collapsed, traffic jam. Each pip click focuses the relevant panel.
5. **Scores**: 4 compact bars *with numeric value on hover* and click → Scores detail (what recently moved each score — derivable; at minimum show current value + arrow trend).
6. **Saves** + **Menu/World-map** buttons.

### 6.4 Blast workshop (panel; the core-loop centerpiece)
Restructure as a stepped workflow the player can read state from: **1 Drill → 2 Charge → 3 Sequence → 4 Preview → 5 Fire**, with per-step completion states (9 holes / 9 charged / 9 sequenced pattern already in state).
- **Drill:** grid tool (drag in scene, see 6.9; spacing/depth/diameter controls with sane defaults), add-single-hole tool, clear; hole list with depth + coordinates.
- **Charge:** explosive picker as rich rows — localized name, $/kg, energy, max charge kg, water-sensitive flag (⚠ when current weather is wet and hole untubed), min rock tier vs current site rock; amount + stemming with validation hints; **total cost of the loaded plan** (Σ amount×costPerKg) always visible; charge-all and per-hole edit.
- **Tubing (new):** stock count, buy N, install on hole(s) — surfaces the existing `tubing buy/install` commands; hole rows show tubed/wet state.
- **Sequence:** auto V-pattern with exposed delay-step; per-hole delay editing (list or click-hole-in-scene); visual order preview (numbers in scene overlay already exist).
- **Preview:** software tier gate made explicit — show current tier, what each tier unlocks (T1 energy heatmap, T2 fragmentation, T3 projection risk, T4 vibration), **Buy tier N ($cost)** button (`buy_software`); preview numbers displayed in-panel (affected voxels, expected fragments/oversized, projection zone size, max vibration) alongside the 3D overlay toggle.
- **Safety (new):** evacuation status derived from `zone status` — who/what is inside the danger area, one-click "Sound the horn" (`zone clear`) with satirical flavor; BLAST button disabled with reason until plan valid (surface `blast_plan validate` issues per hole).
- **Fire:** confirm modal = pre-flight summary (holes, kg by explosive, total cost, predicted results at current software tier, warnings: wet holes, people in zone, buildings near). After detonation: **Blast Report modal** — rating, cleared/cracked voxels, fragment count + oversized count (with "buy a Rock Fragmenter" hint when oversized > 0), projections, rock volume, est. ore value, destroyed buildings, and the post-blast **ore report** (yield vs survey estimate + ratio) when available. Plan save/load/validate exposed for power users (named plans exist in state).

### 6.5 Contracts panel
- **Available:** cards with type icon (ore sale / rubble disposal / supply), material chip (localized ore name + what you currently have in storage of it), qty, $/kg, total value, deadline, **penalty** and **early bonus**, Accept / Negotiate / Decline. Negotiation result shown inline on the card (success/fail + what changed), with manager-skill influence once implemented.
- **Active:** progress bar + delivered/total, time remaining with urgency states (>50% grace, warning, critical), deliver control pre-filled with min(remaining, stored of that material) and a "max" shortcut, projected payout, penalty on failure.
- **History:** completed/expired list with payout/penalty (from `completedHistory`).
- Storage summary strip at top (stored kg / capacity, per-ore breakdown) linking to Operations panel (6.13).

### 6.6 Build panel
- Catalog cards: building icon, localized tier name shown *before* purchase, cost, footprint size, one-line effect (beds N / stores N kg / teaches X / unlocks tiers / parks & repairs vehicles), upkeep per tick, tier selector T1–T3 with lock state; locked tier shows research requirement (cost, duration, prerequisites) and **Queue research** inline.
- **Research status block (new):** current queue with per-task progress bars (`ticksRemaining`, cost) — data from `buildings.researchQueue`.
- Placement via scene (6.9) with live validity (flat/overlap/protected/funds) and cost at cursor.
- Placed list: icon, full name (no truncation — two-line layout), tier, coords with locate-in-scene button, **HP bar**, occupancy/utilization where meaningful (beds used, storage used, research busy), Move / Upgrade (cost shown, research-gated) / Demolish (cost, confirm).
- Ramp tool stays here (or moves to a Terrain group with future dig tools): drag line in scene + depth; show cost estimate before confirm.

### 6.7 Vehicles panel
- Fleet cards: role icon + tier name, HP bar, status chip (idle / moving / working / hauling→phase / waiting ⚠ / stuck ⚠ / broken), payload bar (kg/capacity) for haulers, driver slot (assigned name → unassign; or licensed-crew picker; or "nobody licensed for X — train someone" link to Crew panel), locate-in-scene, contextual actions per role: **Haul** (with fragment count reachable; auto-best or pick-in-scene), future work orders (drill/dig/fragment/demolish) as the core grows, **Scrap** (confirm + any residual value).
- Buy section: per role (5), per tier (3): localized name, cost, and the stats that differ (speed ×, capacity ×, work rate ×, maintenance ×) so tiers are an informed choice.
- Traffic advisory line when TrafficJam conditions detected.

### 6.8 Crew panel (employees)
- **Roster list** (compact rows): portrait/avatar placeholder (role-colored, matches minion color in scene), name + id, role, morale mini-bar, status icons (union, injured, collapsing, training, resting, driving vehicle #), need-warning pip when any gauge < 30. Click row (or minion in scene, 6.9) → **detail view**.
- **Detail (expanded row or side sheet):**
  - Identity: name, role, hired-since, location + follow-in-scene.
  - Needs: hunger/fatigue/break gauges with thresholds marked, current activity ("Sleeping at Staff Dormitory, 5t left" from `restTicksRemaining` + building), collapse warning.
  - Skills: per qualification — category (localized), proficiency stars 1–5 with label (Rookie…Master), XP bar to next level, task-speed effect ("×0.70 duration").
  - Work: active task with type + progress (`taskTicksRemaining`), then *only actions assigned to them or claimable next* (fix the everyone-sees-the-pool duplication), queue reorder later.
  - Pay: salary breakdown (base + per-skill bonus), **Give raise** (fixed amounts or slider — must send `amount:`), morale effect note.
  - Training: available courses (skill, current→target level, fee, duration, which school+tier), Train button, in-progress state; blockers explained (no school / injured / maxed).
  - Fire (union rules explained; confirm).
- **Hiring:** per role: cost, starting qualification (e.g. surveyor → geology ★1), current count on roster; hire button. Design may present as candidate cards for flavor.
- **Site policy lives here or in Operations (6.13), not in Settings:** shift mode (8h/12h/continuous/custom + consequences copy), eat/rest thresholds.

### 6.9 3D scene interactions (new — the biggest structural addition)
The scene is currently camera-only; the redesign should specify (and implementation will build) a picking layer:
1. **Hover:** raycast highlight + name tag for employees, vehicles, buildings, drill holes, fragments; terrain shows tile coords + known survey info (uses the dead `showSurveyResult` pathway).
2. **Select:** click employee/vehicle/building → opens its detail (same component as panel detail); selection outline in scene; Esc/click-away deselects.
3. **Placement modes** replacing the 2D tile-picker modal for: building placement (footprint ghost following cursor, green/red validity, cost tag, click confirm / Esc cancel), ramp (drag line), drill grid (drag rectangle with live rows×cols readout), survey target (click with method radius circle preview). The 2D picker can remain as a fallback/tutorial-pinned mode — tutorial rails currently pin regions in it — but primary UX is in-scene. Placement previews must keep working with tutorial `requiredRegion` pinning.
4. **Contextual actions** on selection (mini action bar): employee → dispatch here / train / detail; hauler → haul this fragment; building → upgrade/move/demolish; hole → edit charge.
5. **Camera:** keep orbit/pan/zoom; add focus-on-selection and minimap-click-to-focus (bridges exist: `__cameraFocus`).
6. Keep/redesign existing overlays: blast plan (holes, charge colors, delay numbers, tier-gated previews), ghost previews (pending actions), survey heatmap (+ stale fade), danger-zone ring when a blast plan is armed.

### 6.10 Minimap
Clickable (focus camera), camera-frustum indicator, layer toggles as tiny buttons (terrain / ore / navgrid / entities) instead of keyboard-only `N`, legend, slightly larger or expandable. Keep: elevation shading, surveyed ore, buildings/vehicles/crew/holes.

### 6.11 Events & notifications
- **Event dialog:** category identity (icon/color per family: union, politics, weather, mafia, lawsuit, ore report, tutorial), title, body, options with structured consequence hints where the event defines them (cost is already in some labels), outcome phase with effect chips (money/score deltas), dismiss. Must remain modal + auto-pause.
- **Notification system:** stacked toasts with severity + icon, click-through to source, and a **notification log** (drawer) so nothing is lost after 6s. Sources today: game-over warnings, contract expiry, level complete, training complete, level-ups, boarding cancelled, stuck employees, smuggling exposure — most currently vanish into console text.
- **Level end screens (new, required):** victory (profit target reached → stats recap from `LevelStats`, star rating with breakdown, continue-to-map) and defeat (bankruptcy / arrest / ecological shutdown / worker revolt → cause explained in-tone, stats, retry/back-to-map). Trigger from `levelEnded`/`levelEndReason` + emitter events already fired.

### 6.12 Finances panel (new)
Balance, net/tick trend, income vs expenses by category (contracts, bonuses, salaries, maintenance, fuel, fines, construction, equipment, corruption, mafia — the last two only once used, keeping the dark path discreet), recent transactions list, bankruptcy status (ticks below zero countdown when in the red). Data: `FinanceState`, `getFinancialReport`.

### 6.13 Operations panel (new; may merge with 6.12 or Contracts as Claude Design sees fit)
- **Logistics:** fragments on ground / in transit / stored; storage kg vs capacity with per-warehouse contribution; collected ore inventory by type (name, kg, est. value) — the bridge between blasting and selling.
- **Incidents:** accidents/deaths log (`DamageState`), injured list, blast damage history.
- **Site policy** (if not in Crew panel).
- **Ore report** from last blast (also shown post-blast in the report modal).

### 6.14 Shady Business panel (new — corruption & mafia)
Design intent: hidden-in-plain-sight. A discreet entry (e.g. unmarked briefcase icon, or a "Special Contacts" line in Finances) that grows more prominent as corruption rises.
- **Corruption:** attempt bribe per target (judge, union leader, inspector, politician, witness) with cost input/preset, success rate shown (`getSuccessRate`), corruption level meter, attempts history, scandal outcomes surfaced via events.
- **Mafia (locked until `corruption.mafiaUnlocked`):** exposure-risk meter, smuggling toggle (income/tick, risk warning), arrange accident (pick unionized employee; consequences), frame job (2-step: start → ready → complete; pending frames list with ready-tick countdown).
- All copy maximally satirical; all actions confirm; consequences (fines, arrest risk → lose condition) stated.

### 6.15 Settings (app-only after redesign)
Language, audio volumes/mute per channel (master/ambient/SFX/UI at minimum — `AudioManager` supports categories), keyboard shortcut reference (mount the existing help content), quicksave/quickload, return to menu. Site policy moves out (6.8/6.13). Reachable from main menu (game-dependent items hidden pre-game) and in-game.

### 6.16 Save/Load
Slot cards with name, date, campaign summary (level, day, cash), load/save/delete with confirms, autosave badge, export/import. Nice-to-have: slot thumbnail (canvas grab).

### 6.17 Tutorial
Re-skin of the coach card (title, body, "do this" hint, step x/y, progress, PAUSED chip, command hints for power users) + highlight treatment on arbitrary controls. Must keep: bottom docking, never covering the highlighted control, rails inertness, tick-budget pause. 23 steps currently reference: speed button, toolbar buttons (survey/blast/contracts/vehicles/build/employees/settings), score panel, balance, event badge — all must remain highlightable in the new layout.

---

## 7. Information the player must *always* be able to answer (acceptance checklist)

A redesign succeeds if a player can answer each of these without the console:
1. How much money do I have, am I gaining or losing, and why? (6.3, 6.12)
2. What is my next blast going to cost and probably yield, and is it safe/legal to fire? (6.4)
3. What did my last blast actually do? (blast report + ore report)
4. Where is ore, how confident am I, and is that knowledge stale? (6.9 overlays, survey panel)
5. What's in storage, what does each active contract still need, and when does it expire? (6.5, 6.13)
6. Who works for me, what can each person do, why is someone idle/collapsed, and how do I make them better? (6.8)
7. What is each vehicle doing right now and why is it stuck? (6.7)
8. What do my buildings do for me, what's researched/researching? (6.6)
9. Why did my score bars move, and how close am I to losing (bankruptcy/ecology/revolt/arrest)? (6.3 alerts, 6.11, 6.12)
10. What happened while I wasn't looking? (notification log)
11. How do I get deeper / expand the pit? (ramp + dig tools discoverable)
12. How do I do crimes? (6.14 — discoverable but discreet, consequences legible)

---

## 8. Data dictionary (quick reference for the designer)

Everything below exists in `GameState` today and can be displayed without new simulation work:

- **Money/time:** `cash`, `tickCount` (1h ticks), `timeScale`, `isPaused`, `finances.transactions[{tick,type,amount,category,description}]`.
- **Scores:** `scores.wellBeing/safety/ecology/nuisance` (0–100 floats).
- **Mining:** `drillHoles[{id,x,z,depth,diameter}]`, `chargesByHole{holeId→{explosiveId,amountKg,stemmingM}}`, `sequenceDelays{holeId→ms}`, `savedPlans`, `surveyResults[{method,centerX,centerZ,confidence,estimates,completedTick}]`, `lastOreReport{oreYields,totalYieldKg,estimatedYieldKg,yieldRatio}`, `ctx.softwareTier` (0–4), `ctx.tubingState{inventory,installedHoles}`.
- **Catalogs:** `ExplosiveCatalog` (8: id, energyPerKg, costPerKg, waterSensitive, maxChargeKg, minRockTier), `OreCatalog`, `RockCatalog`, `getMinePreset` (biomes), `SURVEY_COSTS`, `SURVEY_BASE_ERROR`.
- **Economy:** `contracts.available/active/completedHistory` (`Contract{type,materialId,description,quantityKg,deliveredKg,pricePerKg,deadlineTicks,acceptedAtTick,penaltyAmount,earlyBonus}`), `logistics{fragments,storedMassKg,storageCapacityKg}`, `collectedOre{oreId→kg}`.
- **Entities:** `buildings.buildings[{id,type,tier,x,z,hp,active}]` + defs (cost, demolishCost, maxHp, operating cost, capacity, footprint) + `unlockedTiers` + `researchQueue[{targetType,targetTier,ticksRemaining,cost}]`; `vehicles.vehicles[{id,type,tier,x,z,hp,task,driverId,payloadKg,waitingTicks,isMoveStuck,haulingPhase,haulingFragmentId}]` + defs per tier; `employees.employees[{id,name,role,salary,morale,unionized,injured,alive,collapsing,x,z,qualifications[{category,proficiencyLevel,xp}],trainingState{skill,ticksRemaining},activeActionId,hunger,fatigue,breakNeed,restTicksRemaining,taskTicksRemaining}]`; `pendingActions[{id,type,requiredSkill,requiredVehicleRole,targetX/Y/Z,targetEmployeeId}]`; `ghostPreviews`.
- **Events/dark path:** `events{pendingEvent,timers,firedEventIds,followUpQueue}` + `getEventById(id)→{titleKey,descKey,options[{labelKey}]}`; `corruption{level,attempts,mafiaUnlocked}` + `getSuccessRate`; `mafia{exposureRisk,smugglingActive,smugglingIncome,pendingFrames}`.
- **Campaign:** `campaign.levels{unlocked,completed,bestSessionProfit,cumulativeProfit}`, `levelStats{totalWealth,maxDepthReached,totalVolumeBlasted,blastsPerformed,casualties,bestEcology,bestSafety,uniqueOresExtracted}`, `levelEnded`, `levelEndReason`, `bankruptcy/arrest/ecological/revolt` states, `sitePolicy{shiftMode,hungerRestThreshold,fatigueRestThreshold,socialBreakThreshold}`.
- **World:** `world.sizeX/Z`, `navGrid` (cell types walkable/blocked/drill_hole/ramp/void), `zone.activeZone`, weather via `ctx.weatherCycle.current` (7 states), `damage{accidents,deathCount,blastCount}`.

---

## 9. Control → command contract (implementation wiring)

The new UI keeps dispatching these exact commands (existing, tested):

| UI action | Command |
|---|---|
| New game / start level | `new_game seed:N [mine_type:X] [size:N]` · `campaign start level:<id>` |
| Speed / pause | `time speed <1|2|4|8>` · `time pause` / `time resume` (`pause`/`speed N` aliases used by shortcuts) |
| Survey | `survey <seismic|core_sample|aerial> x:<X> z:<Z>` |
| Drill grid / single | `drill_plan grid rows:R cols:C spacing:S depth:D start:x,z` · `drill_plan add x:X z:Z depth:D` · `drill_plan clear` |
| Charge | `charge hole:<id|*> explosive:<id> amount:<kg> stemming:<m>` |
| Sequence | `sequence auto [delay_step:ms]` · `sequence set hole:<id> delay:<ms>` |
| Tubing | `tubing buy amount:N` · `tubing install hole:<id>` |
| Preview / software | `preview energy|fragments|projections|vibrations` · `blast_preview` · `buy_software` |
| Plans | `blast_plan save|load|list|validate name:<n>` |
| Zone | `zone clear x1: y1: x2: y2:` · `zone status` |
| Blast | `blast` |
| Ore report | `survey ore_report` |
| Contracts | `contract accept|decline|negotiate id:<n>` · `contract deliver <id> amount:<kg>` |
| Build | `build <type> at:x,z tier:<1|2|3>` · `build move <id> to:x,z` · `build upgrade <id>` · `build destroy <id>` |
| Ramp | `build_ramp start:x,z end:x,z depth:<n>` |
| Research | `research queue type:<building> tier:<2|3>` (status from state/`research status`) |
| Vehicles | `vehicle buy <role> tier:<n>` · `vehicle driver <vid> <eid>` · `vehicle haul <vid> fragment:<fid>` · `vehicle move <vid> to:x,z` · `vehicle scrap id:<n>` |
| Crew | `employee hire role:<r>` · `employee fire id:<n>` · `employee raise <id> amount:<n>` ← **note the amount** · `employee train <id> skill:<cat> building:<bid>` · `employee dispatch <id> x: z: [skill:]` |
| Policy | `set_policy mode:<m> hunger:<n> fatigue:<n> [social:<n>]` |
| Events | `event choose <index>` (structured outcome should be added to `CommandResult` during implementation) |
| Dark path | `corrupt target:<judge|union_leader|inspector|politician|witness> [cost:N]` · `mafia status|accident|frame|smuggle [employee:<id>]` |
| Saves | `save [slot]` / `load [slot]` (quick) — slot panel uses `SaveBackend` directly |
| Finance/Info reads | prefer reading `GameState` directly; console equivalents: `finances`, `fragments status`, `scores`, `stats`, `campaign`, `needs`, `state summary` |

Anything marked **(new)** in §6 that lacks a command (e.g. structured event outcomes, vehicle work orders, repair) is an implementation-phase addition — design may assume it.

---

## 10. Design deliverables requested from Claude Design

1. Visual system: palette (AA contrast on dark + any light surfaces), type scale, spacing, iconography set (toolbar, event categories, statuses, resources, roles, vehicles, buildings), button/chip/gauge/progress components, modal & panel chrome, toast system — matching the satirical-corporate cartoon tone.
2. Layout comps (1280×720 and 1920×1080) for: main menu, world map, in-game shell (HUD+toolbar+minimap), each panel in §6.4–6.16, event dialog (choice + outcome), blast pre-flight + blast report, level victory + each defeat, tutorial card + highlight treatment, in-scene placement/selection states (hover tag, selection bar, building ghost, drill-grid drag, survey target).
3. State inventories per component: default / hover / active / disabled-with-reason / warning / critical / locked(research-gated) / tutorial-highlighted.
4. Interaction notes for the scene picking layer (6.9) — cursor shapes, tag anatomy, confirm/cancel affordances.
5. Copy direction: label glossary (Crew vs Employees, etc.) in EN with room for FR expansion; tone examples for confirms, errors, and the Shady Business surface.

Out of scope for design: 3D asset art, terrain shaders, audio.

---

*Appendix: current-state screenshots live under `screenshots/` after running `npm run dev` + the capture steps in git history of this branch (screenshots are gitignored). The inventory in §3 describes each one.*
