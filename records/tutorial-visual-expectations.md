# Tutorial Pit — Visual Expectations & Findings

Reference document for the `visual` verification channel on the tutorial scenario
(`scripts/scenario-defs/tutorial-steps-visual.json`, `tutorial-interactive.json`).

Two parts:

1. **Expectations** — what a first-time player must be able to see, per step, in the 3D
   scene and in the UI, in order to understand the state of the game and the action
   they are being asked to take.
2. **Findings** — what was actually observed on screen, and what was changed.

---

## Baseline chrome (must be true in EVERY step)

| Zone | Element | Expectation |
|------|---------|-------------|
| Top bar `#bs-hud-top` | Balance | Gold, bold, whole dollars, thousands separators. Negative reads as `-$1,234` in red. |
| | Clock | `Day N — HH:00`, centred, advances only when unpaused. |
| | Event badge | Hidden unless `events.pendingEvent` is set; red and pulsing when set. |
| | Weather icon | One glyph matching the active weather; tooltip names it. |
| | Speed button | Shows the live time scale (`1×`…`8×`); clicking cycles it. |
| Top-right `#bs-hud-scores` | 4 bars | WELL-BEING / SAFETY / ECOLOGY / NUISANCE, each with a coloured fill whose width tracks the score. |
| Right `#bs-toolbar` | 7 buttons | Blast, Contracts, Build, Vehicles, Crew, Survey, Settings. The button for the open panel is gold/active. |
| Bottom-right `#bs-minimap` | Map | Overhead view of the pit: terrain relief, surveyed ore, buildings, vehicles, crew, drill holes — matching the legend beneath it. |
| Left `#bs-*-panel` | Panels | At most one open, docked below the HUD, scrollable, never covering the toolbar or the minimap. |
| Canvas | Scene | Sky, terrain filling a useful part of the frame, distant scenery on the horizon, crew/vehicles/buildings visible on the surface. |
| Tutorial card | Coach mark | Title, instruction text, `N / 23` counter, progress bar, Skip and Next. Must **not** hide the thing it is pointing at, and must **not** swallow clicks meant for the game. |

**Global rule:** the tutorial tells the player to click something. Whatever it names must
be (a) visible, (b) highlighted, (c) clickable. If any of the three fails, the step fails.

---

## Per-step expectations

### Step 0 — `time-speed` · "Game Speed"
- **UI:** card reads `1 / 23`, progress bar ~4%. Speed button in the top bar is wrapped in the
  blue pulsing highlight. Game is paused (clock frozen).
- **3D:** the Tutorial Pit fills a good part of the frame — a 24×24 desert bench under a
  daylight sky, distant scenery on the horizon. Nothing is dimmed to the point of illegibility.
- **Completes when:** the player raises the time scale. `1×` → `2×` must be a real increase,
  not "the value it already had".

### Step 1 — `hire-surveyor` · "Hire Surveyor"
- **UI:** card `2 / 23`. Highlight on the **Crew** toolbar button (the panel is closed, so
  highlighting the panel itself would glow nothing). Clicking Crew opens `#bs-employee-panel`
  with a hire list: driller/blaster/driver/surveyor/manager with prices, each with a Hire
  button, disabled when cash is short.
- **3D:** unchanged.
- **Completes when:** an employee with role `surveyor` exists.
- **After:** balance drops by $1,200; a new character mesh stands on the terrain surface;
  the crew list shows one row with name, role, morale.

### Step 2 — `survey` · "Survey Terrain"
- **UI:** card `3 / 23`, highlight on the **Survey** toolbar button. Survey panel offers the
  three methods.
- **3D:** after the survey runs, confidence quads appear on the surveyed disc — green where
  confidence is high, red where low, grey when stale.
- **Minimap:** surveyed ore shows as ore-coloured pixels.
- **Completes when:** `surveyResults.length` increases.

### Step 3 — `hire-driller` · "Hire Driller"
- Same shape as step 1, role `driller`, highlight on **Crew**. Second character appears.

### Step 4 — `drill-plan` · "Drill Plan"
- **UI:** card `5 / 23`, highlight on the **Blast** toolbar button. Blast panel lists the
  grid tool, clear, per-hole rows, charge-all, auto-sequence, preview, execute.
- **3D:** each planned hole draws a marker on the surface plus an X-ray shaft going down
  to its depth.
- **Minimap:** blue dots at the hole positions.
- **Completes when:** `drillHoles.length` increases.

### Step 5 — `charge` · "Set Charges"
- **3D:** hole shafts recolour to the explosive's colour; each row in the blast panel shows
  `explosive amountkg`.
- **Completes when:** `chargesByHole` gains entries.

### Step 6 — `sequence` · "Sequence Delays"
- **3D:** every hole gains a delay label (`+0ms`, `+25ms`, …).
- **UI:** hole rows show `+Nms`.
- **Completes when:** `sequenceDelays` gains entries.

### Step 7 — `blast` · "Execute Blast"
- **UI:** confirm dialog, then the blast panel empties (holes consumed).
- **3D:** flash + dust cloud at each hole in delay order, fragments thrown, and a visible
  crater left in the terrain afterwards. The plan overlay disappears.
- **Completes when:** `collectedOre` gains entries.

### Step 8 — `scores` · "Scores Overview"
- **UI:** highlight on the score panel; the 4 bars have moved from the blast (nuisance up,
  ecology down). Card auto-advances after 2 s.

### Step 9 — `event-fire-resolve` · "Events"
- **UI:** event dialog opens centre-screen with title, flavour text and choice buttons.
  The event badge lights up in the top bar. **The tutorial card must not cover the dialog.**
- **Completes when:** a pending event exists; the player then answers it.

### Step 10 — `hire-manager` · "Hire Manager"
- As step 1, role `manager`, and only after the pending event has been resolved.

### Step 11 — `contract-accept` · "Accept Contract"
- **UI:** highlight on **Contracts**; panel lists offers with ore, tonnage, price, deadline
  and an Accept button. Accepted contracts move to an active section with a progress bar.
- **Completes when:** `contracts.active.length` increases.

### Step 12 — `hire-driver` · "Hire Driver"
- As step 1, role `driver`.

### Step 13 — `vehicle-buy-assign` · "Buy & Assign Vehicles"
- **UI:** highlight on **Vehicles**; panel lists purchasable vehicles and owned vehicles with
  a driver selector.
- **3D:** the bought hauler appears on the terrain surface, not sunk into it.
- **Completes when:** a vehicle exists **and** has a driver.

### Step 14 — `build-storage` · "Build Storage"
- **UI:** highlight on **Build**; grid of building tiles with icons and costs.
- **3D:** the warehouse appears as a building mesh sitting on the surface at the chosen tile.
- **Minimap:** a building pixel at that tile.
- **Completes when:** a `freight_warehouse` exists.

### Step 15 — `contract-deliver` · "Deliver Contract"
- **UI:** the active contract's progress bar advances; balance rises by the contract payout.
- **Completes when:** `contracts.completedHistory.length` increases.

### Step 16 — `finances` · "Finances Overview"
- **UI:** highlight on the balance; the number is legible and positive after the delivery.
  Auto-advances after 2 s.

### Step 17 — `build-ramp` · "Build Ramp"
- **3D:** the terrain remeshes with a carved ramp from the upper bench to the lower one.
- **Minimap:** ramp cells tinted.
- **Completes when:** the navgrid gains `ramp` cells.

### Step 18 — `needs` · "Employee Needs"
- **UI:** highlight on the crew panel; expanding a crew row shows hunger / fatigue / break
  bars with numeric values. Auto-advances after 2 s.

### Step 19 — `set-policy` · "Site Policy"
- **UI:** shift mode / rest thresholds are changeable and the change is visible.
- **Completes when:** any site-policy field differs from the snapshot.

### Step 20 — `tick-advance` · "Advance Time"
- **UI:** highlight on the speed button; the clock actually moves; crew walk in the scene.
- **Completes when:** `tickCount` advances by more than 5.

### Step 21 — `victory` · "Level Complete"
- **UI:** highlight on the score panel; level-end state reached.

### Step 22 — `congratulations` · "Tutorial Complete!"
- **UI:** card `23 / 23`, progress bar full, then auto-dismiss after 4 s exactly once.
  Game resumes unpaused, `bs_tutorial_done` set.

---

## Findings (observed vs expected)

Captured with
`npm run scenario -- --scenario tutorial-steps-visual --mode interaction --screenshots`
and inspected image by image.

| # | Severity | Observed | Expected |
|---|----------|----------|----------|
| 1 | Blocker | Every console command advanced the tutorial's internal step index, whether or not the step was complete. By the `survey` step the tutorial was internally on step 7 and had already auto-run `blast execute`; the visible card was still frozen on step 2. | The step index advances only when `isComplete` is true. |
| 2 | Blocker | Each step's `commands` were executed by the tutorial itself. Those strings were placeholders (`hire employee`, `blast plan`, `drill plan`, `logistics`, `policy`) so the console answered `Unknown command: "hire"`; the real ones (`survey seismic`, `blast execute`) did the player's job for them and wrecked the game state (cash reached **-$33,290**, an empty blast reported `Rating: BAD`). | Player-facing command strings are hints only. Only the event demo step runs a command on the player's behalf. |
| 3 | Blocker | Step 0 completed the instant it was shown (`timeScale >= prevTimeScale` with `prev` captured from the same value), so "Game Speed" was never displayed — the tutorial opened on step 2. | Requires a genuine increase. |
| 4 | Blocker | The card was a full-screen modal (`.bs-confirm-overlay`, 70 % black, `pointer-events:all`, z-600). The mine and every panel were dimmed to near-black, and no toolbar button could be clicked — so no instruction in the tutorial could actually be followed. | Non-blocking coach mark; the game stays lit and clickable. |
| 5 | Blocker | No Skip and no Next control, although `tutorial.skip` / `tutorial.next` exist in both locales. | Both rendered and wired. |
| 6 | Major | The tutorial card and the event dialog share z-index 600, and the card is appended later, so it covered the event's title and most of its choices. | Card sits below the event dialog and out of its way. |
| 7 | Major | Highlight targets were panel IDs (`#bs-employee-panel`, …) which are `display:none` until the player opens them, so the glow was applied to an invisible element. | Highlight the always-visible toolbar button that opens the panel, and re-apply while the step is active. |
| 8 | Major | `campaign start` swaps the voxel grid but keeps the seed, so `loadGame` did not run and the camera kept the previous grid's centre and distance. The Tutorial Pit rendered as a small off-centre patch (~240 px of a 1280 px frame). | Camera re-frames on every grid change: centred, distance derived from grid size. |
| 9 | Major | Minimap drew a flat green square and a grid. The legend advertises Rock / Ore / Building / Hole, but terrain, ore and crew were never drawn. | Elevation shading, surveyed ore, buildings, vehicles, crew and holes all drawn. |
| 10 | Minor | Balance rendered as `$-37,799.853` — fractional cents, sign in the wrong place, no colour change. | `-$37,800` in red. |
| 11 | Minor | The congratulations card reset its 4 s dismiss timer on every subsequent command, so it never went away. | Timer armed once. |
| 12 | Minor | Step counter and progress bar overlapped; the bar rendered as a strikethrough through `23 / 23`. | Bar in its own track below the counter. |
| 13 | Minor | Sky opened on a muddy olive because the weather colour lerps in from the hardcoded blue over several seconds. | First weather assignment snaps. |
| 14 | Blocker | `tutorial.start()` paused the game and nothing ever unpaused it. `survey` only queues a pending action — the surveyor has to walk to the site and work 8 ticks — so with the clock stopped `surveyResults` never grew and step 2 could not be completed by any means. Same trap for drilling, hauling, delivery and the needs step. | Pause for the opening card, resume the moment the first step is done. |
| 15 | Major | `time speed:2` parsed as `time status`: `speed` was only read positionally, so the command reported success while leaving the speed at 1×. Several scenario files used the named form and silently changed nothing. | Both `time speed 2` and `time speed:2` set the speed; an invalid value is rejected rather than reported as status. |
| 16 | Minor | "Charge All Holes" applies the charge form's values, but that form is hidden until a hole is selected — the player gets `pop_rock 3 kg` without ever seeing the choice. Left as-is; noted so the scenario's command mirror matches what the button actually does. | — |
| 17 | Blocker | Step 7 completed only when `collectedOre` gained an entry. A blast that legitimately comes up barren — soft rock, small charge, no ore under the pattern — left the card stuck on "Execute Blast" forever even though the player had done exactly what it asked. | Completes when a blast has been fired (`levelStats.blastsPerformed`) or ore was collected. |
| 18 | Major | Every open panel rebuilt its whole DOM on each rendered frame. An expanded crew row's detail panel — the hunger / fatigue / break meters that step 18 tells the player to read — was destroyed within one frame of being opened, and Accept buttons detached out from under an in-flight click. | Panels rebuild only when their content signature changes. |
| 19 | Major | `EventDialog` never set `id="bs-event-dialog"`, so the `#bs-event-dialog` rules in the stylesheet were dead and nothing — tutorial highlight or UI test — could select the dialog. | The id is set; the rules apply and the dialog is selectable. |
| 20 | Minor | The pulsing "Event!" badge rendered underneath the fixed "Return to Map" button. | The top bar reserves that strip. |
| 21 | Minor | The minimap canvas sat left-aligned in a panel sized by its wider legend row. | Centred. |
| 22 | Major | Contract offers printed the generator's raw float: `330kg @ $542.4273477250244/kg`. | Two decimals (three under a dollar so cheap rubble contracts don't read `$0.00`), thousands separators. |
| 23 | Minor | The bankruptcy / game-over toast is docked at `bottom: 20px`, right on top of the tutorial card's Skip and Next buttons. | Raised clear of the card. |

### Second pass — no Next button, so every step needs a UI path

The Next control was removed on request: the only way forward is to perform the
step. That turns any step without a reachable control into a hard dead end, so
the whole sequence was audited for one. Five steps had none.

| Step | Was | Now |
|------|-----|-----|
| 2 · Survey Terrain | The panel's only action was a "Survey Mode" button that ran `survey mode` — a method the console rejects (`Unknown method "mode"`). No way to choose a method or a target existed; `showMethodSelection`, `onMethodSelected` and `getSelectedMethod` were TODO stubs nothing called. **The survey could not be performed at all.** | Method rows with cost and accuracy, a target picker, dispatch, a progress line and a results readout with confidence and richest ore. |
| 13 · Buy & Assign Vehicles | The Vehicles panel offered Buy and Scrap only — no way to put a driver in a vehicle. | Per-vehicle driver picker listing only crew holding that role's licence and not already driving. |
| 15 · Deliver Contract | Contracts offered Accept / Negotiate / Decline. Nothing delivers itself — `deliverMaterials` is only reachable from the console. | Amount field plus Deliver on each active contract. |
| 17 · Build Ramp | Ramps are carved into the voxel grid, not placed as buildings, so the Build panel had no control for them. | A Terrain section with Build Ramp, using the area picker. |
| 19 · Site Policy | Shift mode and rest thresholds existed only as `set_policy` console arguments. | Site Policy section in Settings: shift schedule, hunger and fatigue thresholds, Apply. |

Also fixed while verifying the above: the tile picker drew an empty grid with
nothing to aim at, and its Confirm started disabled with no selection. It now
shades the site — bench relief, surveyed ore, ramps, buildings, drill holes —
and opens with the centre tile selected. All three pickers (survey target,
building placement, drill grid) share the shading.

### Resolved: the tutorial is now affordable

Tutorial Pit's starting cash was raised from **$20,000** to **$80,000**. Starting
cash is not a finance transaction, so it does not feed `netProfit` and cannot
hand the level's $5,000 completion threshold for free — the level still has to be
earned. The tests that pinned `20000` now read the value from the level
catalogue, so the next balance pass only has to change one number.

The original numbers, kept for the record:

### Was blocked: the tutorial was not affordable

Tutorial Pit grants **$20,000**. The steps it scripts cost, from the game's own
config:

| Item | Cost |
|------|------|
| Surveyor + driller + manager + driver | $5,000 |
| Survey (core sample $800 / seismic $3,000) | $800–3,000 |
| Consultant event (step 9, scripted) | $3,000 |
| `debris_hauler` (step 13) | **$25,000** |
| `freight_warehouse` T1 (step 14) | **$15,000** |
| | **≈ $49,000 before any income** |

The hauler alone costs more than the whole starting purse, and the delivery step
that earns anything is step 15 — after both big purchases. A UI-driven run
reaches step 13 at **-$31,332** with the driver Hire button disabled, and stops
there. This is arithmetic rather than a tuning preference, but the fix is a
design call (starting cash, step order, or cheaper step requirements), so it is
left for the owner to choose.

### Surfaced by the affordability fix: contracts expire before their delivery step

With cash no longer the wall, a UI-driven run gets to step 15 and finds nothing
to deliver. Step 11 accepts a contract; steps 12–14 hire a driver, buy a vehicle
and place a warehouse; only then does step 15 say "deliver". Offers carry
deadlines as short as 43 ticks, and those four steps consume more than that at
2× speed — one run accepted contract #6 at tick 144 and saw
`Contract expired! Penalty: $62` by tick 188.

So a player following the tutorial in order can be told to deliver against a
contract that has already lapsed. Either the accept step should sit next to the
delivery step, or tutorial-level offers need deadlines that outlast the four
steps in between. Both are design calls, so this is recorded rather than guessed
at. The interaction scenario accepts a fresh offer before delivering, so it still
verifies the Deliver control itself.

### Also observed, left alone

- **Tutorial Pit economy is tight.** Playing at 2× with four hires and no delivery yet, the
  interaction run reached $140 before step 10's $2,000 manager, which disables the Hire
  button. A real player moves faster in game-time than a scripted run does, so this is a
  balance question rather than a defect, and re-tuning salaries or the starting purse is
  outside a visual pass.
- **"Charge All Holes" silently uses the charge form's defaults** (`pop_rock`, 3 kg) even
  though that form is hidden until a hole is selected.

### Third pass — playing it without the console

The two passes above still verified through the console: every check ran
`employee assign_skill 1 skill:geology level:3` before touching the survey panel.
That is why the survey step read as fixed while a real player still could not run
one. A console command standing in for a player action converts "no player can do
this" into PASS.

So the pass was redone with a harness that has no console access beyond
`new_game`, `campaign`, `tutorial_start`, `tick` and `time` — `npm run playtest`.
It plays the tutorial through its own buttons and stops at the first step a
player could not complete. Three findings, all invisible to the other channels:

| # | Severity | Was | Now |
|---|----------|-----|-----|
| 24 | Blocker | `hireEmployee` set `qualifications: []`. Surveying needs `geology`, driving needs a licence, so **a hired surveyor could not survey and a hired driver could not drive.** The only way to grant a qualification was the `employee assign_skill` console command. | A hire arrives holding its role's qualification at Rookie level (`ROLE_STARTING_QUALIFICATION`). Training raises proficiency from there. The stored salary is now computed by `calculateSalary`, which the base-only value had silently disagreed with. |
| 25 | Blocker | Three panels each own a `TileSelectOverlay`, and their forms reuse element ids. `close()` left the form in the document, so `document.getElementById('bs-tile-select-confirm')` could resolve to a **closed** picker's button — present in the DOM, impossible to click. | `close()` removes the form, and every lookup is scoped to the instance's own root. |
| 26 | Blocker | The event step completed only while `pendingEvent != null` — true only while the dialog was open. A player who answered between two polls left the tutorial **permanently stuck** on that card: the scripted event fires at most once per level and cannot be brought back. | Completes on fired-then-resolved (`firedEventIds` contains the event *and* nothing is pending), which is monotonic and cannot be missed. |

Finding 24 is the one the owner reported. It had survived a full green run of
`static`, `logic`, `scenario` and `visual`, because all four drive the simulation
through `src/console/`, whose commands are a superset of what any button exposes.

The harness is now the fifth verification channel, `playability`, and
`tests/unit/playtest-defs.test.ts` fails the suite if a definition reaches for a
gameplay command. Procedures live in the `dev-playability-testing` skill.

### Fourth pass — the skills hiring does not grant

The third pass left one gap recorded rather than fixed: `driving.excavator`,
`driving.drill_rig` and every proficiency above Rookie belong to no hiring role,
so training is their only source — and training was unreachable. It turned out
to be unreachable in three separate ways at once:

| # | Severity | Was | Now |
|---|----------|-----|-----|
| 27 | Blocker | `tickTraining` was never called by anything. A course, once begun, counted down forever. | The tick advances courses and reports each completion. |
| 28 | Blocker | `startTraining` was called by nothing — no console command, no button. | `employee train <id> skill:<cat> [building:<id>]` for the scenario channel, and a Training block in each roster row's detail for the player: one row per course with its fee and duration, disabled with a stated reason when there is no school, no money, or nothing left to teach. |
| 29 | Blocker | Completing a course granted a qualification only when the employee did **not** already hold it. Training a held skill charged the fee and changed nothing, so no proficiency above Rookie was reachable by any means. | A course grants the skill at Rookie, or raises it one level, capped at Master. Salary follows. |

Two more defects surfaced while proving the above by clicking, both of which the
`visual` channel had photographed without anyone noticing:

| # | Severity | Was | Now |
|---|----------|-----|-----|
| 30 | Major | `.bs-employee-row` is a non-wrapping flex row, so an expanded detail was laid out *beside* the name column and drawn on top of it. Name, role, morale and the Raise/Fire buttons were unreadable and unclickable — the probe reported them `covered`. | The row wraps and the detail takes a full-width line of its own. |
| 31 | Major | The roster's rebuild fingerprint included morale, which drifts every tick. The panel therefore rebuilt continuously, closing any detail the player had expanded and detaching controls out from under an in-flight click. | The fingerprint covers structure only; morale, need gauges and the training countdown are written in place. Expanded rows are remembered across rebuilds. |

Finding 31 is the interesting one: an earlier pass had added a rebuild guard for
exactly this symptom, and its test proved the panel *skipped* a rebuild when
nothing changed. Something always changes. The guard passed its test and the
defect survived.

Also fixed in passing: need gauges printed the raw drain value
(`Hunger 69.85000000000016`), now rounded to whole percent.

`scripts/playtests/training.json` covers it — hire a driver, build a driving
center, take the excavator licence, then promote the truck licence, entirely by
clicking.

### Known gap: XP from work is still unwired

`gainXp` implements the spec's on-the-job progression (`xpPerTick = 1 + floor(level * 0.5)`)
and is exported, tested, and called by nothing. Training is now a complete route
to every proficiency level, so no skill is unobtainable, but an employee still
never improves by doing the job.

Wiring it needs the pending-action lifecycle finished first: `tickEmployees`
removes an action from `state.pendingActions` when an employee claims it and
sets `activeActionId`, and nothing outside collapse handling ever clears that
field again. There is no "the work finished" moment to award XP at, and a worker
who claims one action stays flagged busy indefinitely. That is a separate change
with its own verification, so it is recorded here rather than bundled in.

### Known gap, not changed here

**Tutorial Pit terrain is perfectly flat.** With `sizeY = 12` and the desert preset
(`baseElevation 0.35`, `elevationVariation 0.08`, `flatness 0.7`), `computeSurfaceHeight`
evaluates to `4.2 ± 0.29` for every column, and `Math.round` collapses that to a constant 4
— the rendered mesh reports `minY == maxY == 3.5`. The level named "Tutorial Pit" therefore
has no pit and no benches, which is the single largest remaining gap between what a player
expects to see and what is on screen.

Fixing it means changing terrain generation parameters, which re-rolls the deterministic
state every one of the 100 scenario definitions asserts against. That is a separate change
with its own verification, so it is recorded here rather than bundled into this pass.
