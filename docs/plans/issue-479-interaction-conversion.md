# Issue #479 — Interaction-Mode Conversion: Master Plan

**Read this file first after any context reset.** It is the durable source of
truth for this task. Update the status table and findings log as you go, and
commit this file alongside the scenario changes it tracks.

## Goal

Every scenario definition's interaction-mode steps that model a player
action must be driven by a real click, never a console command. The
mechanism (role field, rejection logic, failure reporting) and the shared
click vocabulary (borrowed from the playtest driver) are done and merged.
What's left is converting the 118 remaining scenario definitions, file by
file, fixing whatever real bugs the conversion surfaces along the way.

Branch: `claude/unify-playtest-interactive-tests-kcjlwb`. PR #497.

## Ground rules (do not violate these)

1. **Never run the whole interaction-mode suite locally.**
   `npx tsx scripts/run-all-scenarios.ts --mode interaction <one-name>` on
   the *specific file just changed*, always. The full 122-file batch and
   the full playtest suite are CI's job (`full-ci` label, already on the
   PR) — verify those by reading the CI job after pushing, not by running
   them here.
2. **One commit per file (or a small logically-grouped batch of very
   similar files).** Message states what changed and any finding.
3. **A finding is not a blocker for other files.** If a command has no
   real UI equivalent, or the console lets through something the UI
   correctly refuses, leave that one step unconverted (role omitted),
   document it in the step's `description` and in the Findings Log below,
   and move on. Do not stall the whole file on one dead end. Do not
   silently paper over it with a command that "happens to work" — that is
   the exact anti-pattern this issue exists to remove.
4. **Fix real bugs when they're small and contained** (a missing
   affordability guard, a `success:false` not surfaced as a failure). If a
   fix has wide blast radius (e.g. changing what `vehicle buy` does to
   cash touches every scenario that buys a vehicle), log it as a finding,
   do **not** fix it inline, and note it needs its own change.
5. **`git fetch origin main && git merge origin/main`** every few files,
   or whenever you're about to start a new session/context. Resolve
   conflicts for real — scenario JSON conflicts are usually just two
   people touching different files, trivial to resolve.
6. Local fast checks after every file: `npx vitest run
   tests/unit/scenario-defs.test.ts` (schema) and, if the file's `command`
   fields didn't change (they shouldn't), you don't need to re-run
   `npm run scenarios` every time — do it every ~10 files as a sanity
   sweep, and always before a push.
7. Dev server must be running for interaction-mode verification:
   `npm run dev &` once per session, leave it running. If a browser-driven
   run is in flight, touch no file until it finishes.
8. At the very end (all 122 converted): run `npm run validate` locally,
   push, then read the CI run for `Scenarios (interaction mode)` and
   `Playtest (playability)` — full green there is the actual finish line,
   not local judgment.

## How to classify a step's role

- `player` — the step models something a player does (build, buy, hire,
  drill, charge, sequence, blast, accept/deliver a contract, choose an
  event option, corrupt, research, set policy, weather set, build_ramp).
  Interaction array must contain zero `command` actions.
- `setup` — world bootstrap and clock: `new_game`, `campaign`,
  `tutorial_start`, `tick`, `time`. Checked against
  `isAllowedSetupCommand` (`scripts/shared/playtest-types.ts`).
- `observe` — read-only: `state`, `scores`, `finances`, `needs`,
  `inspect`, `fragments`, `stats`, `preview`, `blast_preview`,
  `blast_plan`, `terrain_info`, `help`, plus any `<command> list|status|
  show|types|mode|ore_report` subcommand. Checked against
  `isObservationCommand` (`scripts/shared/interaction-executor.ts`).
- unmarked (no `role` key) — legacy/unconstrained. Use this **only** for a
  step that is a genuine test-only hook with no UI and none intended
  (`employee assign_skill`, `event fire`, `weather set` when used as a
  forcing function, `sandbox start`, `save`/`load` when not exercised via
  the Saves modal). Say why in the `description`.

`checkStepActionAllowed` in `scripts/shared/interaction-executor.ts` is the
enforcement; `tests/unit/scenario-defs.test.ts` has the schema tests.

## Verified command → panel → selector map

Built by grepping every `gameConsole?.(...)` call site in `src/ui`
(43 total, `grep -rn "gameConsole?\." src/ui --include=*.ts` reproduces
this). This is the whole surface — nothing outside this list mutates game
state from the UI.

| Command | File | Selector / how to drive it |
|---|---|---|
| `employee hire role:X` | CrewPanel.ts | `#bs-employee-panel [data-role="X"]` (X = surveyor\|driller\|driver\|manager\|blaster) |
| `employee raise <id> amount:N` | CrewPanel.ts (makePaySection) | expand employee card, pay section — no simple data-action found yet; read `crewDetailSections.ts` when converting a file that needs this |
| `employee train <id> skill:X building:Y` | CrewPanel.ts (makeTrainingSection) | expand employee card, training section — read `crewDetailSections.ts` when needed |
| `employee fire <id>` | CrewPanel.ts:296 | confirm dialog on employee card |
| `vehicle buy X tier:N` | FleetPanel.ts:212 | `#bs-vehicle-panel [data-vtype="X"][data-tier="N"]` |
| `vehicle driver <id> none` | FleetPanel.ts:251 | `makeDriverRow` unassign control on vehicle card |
| `vehicle driver <id> <empId>` | FleetPanel.ts:252 | `#bs-vehicle-panel .bs-vehicle-assign-btn` (proven in tutorial-interactive) |
| `vehicle scrap <id>` | FleetPanel.ts:282 | scrap (trash icon) button on vehicle card, then confirm |
| `vehicle haul <id> fragment:X` | haulEligibility.ts | `#bs-vehicle-panel .bs-vehicle-haul-btn` (proven) |
| `vehicle break <id> fragment:X` | breakEligibility.ts | Fleet panel break control — read `breakEligibility.ts` call site context when needed |
| `survey X x:.. z:..` | SurveyPanel.ts:306 | `#bs-toolbar [data-panel="survey"]` → `#bs-survey-panel [data-method="X"]` (X = seismic\|core_sample\|aerial) → `#bs-survey-run` → pickTile/dragTiles → `#bs-tile-select-confirm` (proven for seismic) |
| `drill_plan grid rows:.. cols:.. spacing:.. depth:.. start:x,z` | Drill.ts:259 | `#bs-blast-panel [data-action="grid-tool"]` → dragTiles → confirm (proven) |
| `drill_plan add x:.. z:..` | Drill.ts:294 | `[data-action="add-hole-tool"]` → pickTile → confirm |
| `drill_plan remove hole:X` | Drill.ts:212 | `[data-action="remove-hole"]` on the hole row |
| `drill_plan clear` | Drill.ts:193 | `[data-action="clear-holes"]` then confirm (yes/no dialog) |
| `charge hole:* explosive:X amount:Ykg stemming:Zm` | Charge.ts:288 | select explosive card (`[data-action="select-explosive"]`, scoped by explosive id — check card structure), set amount/stemming fields, `[data-action="charge-all"]` (proven for defaults) |
| `tubing buy amount:N` / `tubing install hole:X` | Charge.ts:292/296 | wet-hole tubing controls — read Charge.ts fully when needed |
| `sequence auto delay_step:Nms` | Sequence.ts:65 | `[data-action="auto-sequence"]` (proven; delay step is a field, default may differ from scenario's explicit value — check) |
| `sequence set hole:X delay:Nms` | Sequence.ts:169 | per-hole delay control, `btn.dataset['action']` set dynamically — read Sequence.ts line ~153 when needed |
| `blast_preview` | Preview.ts:94 | `[data-action="run-analysis"]` |
| `buy_software` | Preview.ts:178 | button in Preview step — read full context when needed |
| `blast` | blastFooter.ts / PreflightModal.ts | footer `[data-action="execute"]` → PreflightModal `[data-action="preflight-detonate"]` → BlastReportModal `[data-action="report-close"]` (proven) |
| `zone clear x1:.. y1:.. x2:.. y2:..` | Fire.ts:198 | Fire step's danger-zone clear control — read Fire.ts fully when needed |
| `build X at:x,z tier:N` | BuildMenu.ts:359 | `#bs-build-panel [data-build-type="X"] .bs-build-buy-btn` (with `.bs-build-tier-sel` set first if tier != default) → pickTile/dragTiles → confirm (proven for freight_warehouse) |
| `build move <id> to:x,z` | BuildMenu.ts:430 | `.bs-build-placed-row[data-building-id="id"] .bs-build-move-btn` → pickTile → confirm |
| `build upgrade <id>` | BuildMenu.ts:453 | `.bs-build-placed-row[data-building-id="id"] .bs-build-upgrade-btn` |
| `build destroy <id>` | BuildMenu.ts:472 | `.bs-build-placed-row[data-building-id="id"] .bs-build-demolish-btn` then confirm |
| `build_ramp start:x,z end:x,z depth:N` | BuildMenu.ts:262 | `#bs-build-panel .bs-build-ramp-btn` → dragTiles → confirm (proven) |
| `research queue type:X tier:N` | BuildMenu.ts:181 | `.bs-build-research-btn` on catalog row or placed row (upgrade-blocked) |
| `contract accept id:X` | ContractsPanel.ts:310 | `#bs-toolbar [data-panel="contracts"]` → `.bs-contract-accept` (proven) |
| `contract negotiate id:X` | ContractsPanel.ts:317 | negotiate button, `dataAction:'negotiate'` per `button()` helper — likely `.bs-contract-negotiate` or `[data-action="negotiate"]`, confirm when converting |
| `contract decline id:X` | ContractsPanel.ts:324 | decline button, confirm similarly |
| `contract deliver <id> amount:N` | ContractsPanel.ts:244 | `.bs-contract-deliver`, `set` the `.bs-contract-amount` input first (proven) |
| `event choose N` | EventModal.ts:267 | `#bs-event-dialog .bs-event-choice` (choice N is the Nth choice element; only choice 0 proven so far — for N>0 use `:nth-child` or check for a saner per-choice selector) |
| `event dismiss` | EventModal.ts:166 | `#bs-event-dialog .bs-event-dismiss` (proven) |
| `event fire X` | — | **no UI, test hook, leave unmarked** |
| `corrupt target:X` | ShadyPanel.ts:202 | corrupt control + confirm — read ShadyPanel.ts when needed |
| `mafia smuggle` | ShadyPanel.ts:239 | toggle button |
| `mafia accident/frame employee:X` | ShadyPanel.ts:261/292/319 | control + confirm |
| `set_policy mode:X` | OperationsPanel.ts:386 | `#bs-toolbar [data-panel="ops"]` → set the mode control → `[data-action="apply-policy"]` (proven for shift_8h, the default-mirroring path; check what sets the mode value for a *different* mode than currently in force) |
| `weather set X` | — | **no UI found yet** — check OperationsPanel.ts fully; if genuinely absent, this is a finding, not a conversion failure |

Selectors marked "proven" were exercised by a real interaction-mode run in
the browser (tutorial-interactive.json, contract-panel-visual.json,
event-dialog-visual.json, vehicle-purchase-visual.json — all passing).
Everything else is derived from source but **not yet click-tested** — treat
it as a strong hypothesis, not a certainty, and verify with the real
interaction-mode run for the first file that uses it.

## Findings Log

Real bugs/gaps surfaced by conversion. Each either got a contained fix
(commit noted) or was deliberately left as an unconverted step + a note
here for a follow-up issue.

1. **`vehicle buy` doesn't guard affordability.** Command mode subtracts
   cost unconditionally and can drive cash negative; the Fleet panel
   correctly disables the button when unaffordable. `research queue`,
   `employee train`, `survey` all guard funds; `vehicle buy`,
   `employee hire`, `build` do not. **Not fixed** — cash-guard semantics
   change touches every scenario that buys a vehicle/hires/builds while
   short on cash; needs its own change + its own verification pass, not a
   drive-by here. Found in `vehicle-purchase-visual.json` (step "vehicle
   buy drill_rig", left unmarked).
2. **`contract deliver` returns `success:false` on no stock, but
   command-mode's runner only fails a step on a thrown exception** — so a
   no-op delivery silently "passes" in command mode (the #445 class).
   **Not fixed** — same shape as the known #445 issue (invalid vehicle
   role), the fix belongs in `command-runner.ts`'s success handling
   across the whole suite, not one scenario. Found in
   `contract-panel-visual.json` (last deliver step, left unmarked).
3. **The tool rail toggles a panel closed on a second click of the same
   rail entry** (`UIManager.togglePanel`) — a converted step must not
   re-click a rail entry for a panel a previous step already opened and
   is still using. **Fixed in the harness/conversions directly** — no
   game bug, this is real, expected toggle behavior; the fix is just not
   re-clicking. Keep this in mind for every file: open a panel once per
   contiguous run of steps that use it.
4. **`run-all-scenarios.ts` waited only 10s for the canvas** on a cold
   tab, which flaked under no-GPU rasterization. **Fixed** — raised to 30s
   (`scripts/run-all-scenarios.ts`).
5. **Some scenario files bundle several distinct setup+player commands
   into one JSON step's `interaction` array** (a "big setup blob" pattern,
   seen in `crew-fleet-panels-visual`/`money-surfaces-visual`), rather
   than one command per step like `tutorial-interactive.json`. A single
   step can only carry one role, so a bundled step mixing `new_game` with
   `employee hire` etc. cannot be tagged at all. **Fix: split the step**
   into one JSON step per command, each independently role-marked. Check
   the *full* `interaction` array before converting a step, not just its
   `command` field summary — a step whose `command` looks like a simple
   `state` can still have a multi-command `interaction` array from before
   this mechanism existed.
6. **The rail-toggle bug (Finding #3) isn't limited to consecutive
   player steps — it applies across ANY consecutive steps that touch the
   same panel, including an `observe` step that opens a panel for a
   screenshot immediately followed by a `player` step on the same panel.**
   Track "which panel is currently open" as running state across the
   *whole* step sequence when converting a file, not just within a single
   step or a single role.
7. **BlastWorkshop auto-advances its internal step** (Drill → Charge →
   Sequence → Preview → Fire) once its own completion heuristic is met —
   e.g. once holes exist, it can advance off Drill on its own. Re-using an
   earlier step's control (e.g. the grid tool for a second `drill_plan
   grid`) needs an explicit click back to that tab first:
   `#bs-blast-panel [data-step="N"]` (N = 1..5, 1=Drill).
8. **Contract offer rows carry no id-scoped selector** — there is no way
   to click "negotiate contract 1" vs "accept contract 2" specifically
   when multiple offers are on screen; only "the first offer" resolves
   unambiguously (proven in `contract-panel-visual.json`). A scenario that
   needs a *specific* contract id among several offers stays a command for
   that portion.
9. **Per-hole sequence delay is only reachable via relative +/- steppers**
   (`[data-hole="H1"] [data-action="delay-inc"/"delay-dec"]`, confirmed
   real — `blast-sequence-step-visual.json` already clicked one), never a
   set-to-value control. Reaching an exact target delay (`sequence set
   hole:H1 delay:200`) would mean replicating Auto Sequence's row
   algorithm to compute a click count; left as a command.
10. **No per-hole charging in the UI, by design** — Charge.ts's own header
    comment: "per-hole charging isn't a feature here anyway... nothing is
    lost by requiring the extra click" (Charge All is the only commit).
    `charge hole:H1 explosive:X amount:Y` (distinct per hole) has no click
    path at all; stays a command wherever a scenario does this.
11. **A blast plan built from per-hole-varying charges (Finding #10) can
    leave `validateBlastPlan` rejecting it** — the Fire footer's own Execute
    button disables (`multi-deck-blast.json`'s 4 differently-stemmed
    holes). Console `blast` calls the same validator, so a command-mode
    "pass" on a plan like this may itself be hiding a validation rejection
    the runner never surfaces (the #445/Finding #2 class — success:false
    isn't a thrown exception). Not independently confirmed which specific
    rule rejects it; left as a command rather than a click that cannot
    land, downstream of Finding #10 either way.
12. **BlastReportModal never reopened for a second blast fired on the same
    tick** — real bug, not a conversion gap, found running
    `vibration-budget.json`'s 3-blast sequence for real: nothing forces
    the clock to advance between plans, so two blasts with no `tick`
    between them share `state.tickCount`, and the modal's old
    `report.tick === lastShownTick` gate silently treated the second
    report as already-shown. **Fixed** — compares report *identity* now
    (`buildBlastReport` always returns a fresh object), not tick
    (`src/ui/panels/BlastReportModal.ts`; regression test in
    `tests/unit/ui/panels/BlastReportModal.test.ts`). A player who fires
    twice in a row without an intervening tick would have seen this too —
    command mode never would, since it doesn't touch the modal.
13. **A partially-hand-converted step's leftover leading `command` action
    is the single most common self-inflicted bug in this conversion.**
    Several source files already had real clicks *plus* a stale
    `{"type":"command", "command": step.command}` entry still in front of
    them (pre-dating this mechanism, or left behind by an earlier, buggy
    pass of mine). A `player`-marked step rejects **any** command action,
    so these always fail at runtime even though the clicks themselves are
    correct. **Always grep a step's full `interaction` array for
    `"type": "command"` after marking it `player`, not just eyeball the
    `command` field.**
14. **When "fix the role" only changes the `role` key, stale `interaction`
    content from an earlier (wrong) pass survives untouched** — several
    Batch 2 failures traced back to a step whose `role` I'd corrected but
    whose `interaction` array still held clicks written for a *different*
    step during an earlier off-by-one mistake. **After any index/mapping
    correction, re-dump and re-read the full file — don't trust that a
    role-only fix was sufficient.**

_(Add new findings here as you hit them. Number sequentially.)_

## Status table

Legend: ⬜ not started · 🔶 in progress · ✅ converted + interaction-verified

Command counts are from before conversion (measured at plan creation);
update the "left" column as files convert. Regenerate the full table with:

```bash
python3 - <<'EOF'
import json, os
d = 'scripts/scenario-defs'
for f in sorted(os.listdir(d)):
    if not f.endswith('.json'): continue
    s = json.load(open(os.path.join(d, f)))
    cmd = sum(1 for st in s['steps'] for a in st.get('interaction', []) if a['type'] == 'command')
    roled = sum(1 for st in s['steps'] if st.get('role'))
    print(f"{f[:-5]:45} steps={len(s['steps']):4} cmd_left={cmd:4} roled={roled:4}")
EOF
```

### ✅ Done (43)
- tutorial-interactive, vehicle-purchase-visual, contract-panel-visual, event-dialog-visual
- Batch 1 (14): ambient-life-visual, weather-popover-visual, wind-clouds-visual,
  survey-panel-visual, loading-screen-visual, scene-picking-visual, nav-cell-types-visual,
  nav-minimap-integration-visual, blast-hole-picking-visual, blast-drill-plan-ui,
  blast-drill-plan-visual, i18n-live-locale-switch, crew-fleet-panels-visual,
  money-surfaces-visual
- Batch 2 (24): blast-basic, blast-charge-loading-ui, blast-detonation-sequence-ui,
  blast-execution-effects, blast-overcharge, blast-undercharge, blast-report-metrics,
  blast-voxel-fragmentation, blast-voxel-fragmentation-visual, blast-preview-software-tiers,
  blast-report-visual, blast-visual-full, blast-charge-sequence-visual,
  blast-preview-tiers-visual, blast-workshop-french-visual, blast-preview-step-visual,
  blast-sequence-step-visual, blast-fire-step-visual, multi-deck-blast, presplit-wall,
  vibration-budget, collapse-recovery, rock-fragmenter-breaking, ramp-navigation,
  blast-execution-visual

All 43 interaction-verified in a real browser (each individually, and Batch 2
re-verified as one 24-file batch run at the end to catch cross-file
regressions). Batch 2 also fixed a real game bug (Finding #12,
BlastReportModal) found only by actually running the clicks — command mode
never would have caught it, since it never touches the modal.

**Caution for whoever resumes:** `blast-visual-full` was inspected early in
Batch 2 but its actual conversion was skipped in the first pass — it slipped
through as "not yet role-marked = trivially unconstrained = passes" in a
batch run, which read as done but wasn't. Don't trust a passing batch run
alone as proof a file was converted; cross-check the status table (or grep
for `"role"` in the file) before crossing it off.

### Batch 2 — blast-* — ✅ COMPLETE (25 files, see Done list above + blast-execution-visual)

### Batch 3 — survey-* (13)
⬜ survey-confidence-display · ⬜ survey-confidence-overlay ·
⬜ survey-execution · ⬜ survey-method-selection ·
⬜ survey-ore-vein-visibility · ⬜ survey-overlay-lifecycle ·
⬜ survey-post-blast-ore-report · ⬜ survey-result-visualization ·
⬜ survey-seismic-side-effects · ⬜ survey-stale-handling ·
⬜ survey-then-blast · ⬜ survey-then-blast-playthrough · ⬜ skill-progression

### Batch 4 — building-* (12)
⬜ building-destruction-visual · ⬜ building-lifecycle ·
⬜ building-living-visual · ⬜ building-menu-visual ·
⬜ building-placement-visual · ⬜ building-ramp-visual ·
⬜ building-research-progression-visual · ⬜ building-research-visual ·
⬜ building-tier-system-visual · ⬜ building-training-visual ·
⬜ building-vehicle-depot-visual · ⬜ building-warehouse-visual

### Batch 5 — vehicle-* / needs-* / nav-* (22)
⬜ vehicle-3d-rendering-visual · ⬜ vehicle-driver-assignment-visual ·
⬜ vehicle-purchase-tier-ui-visual · ⬜ vehicle-roles-panel-visual ·
⬜ vehicle-task-states-visual · ⬜ vehicle-traffic ·
⬜ vehicle-traffic-routing-visual · ⬜ needs-collapse-visual ·
⬜ needs-cost-visual · ⬜ needs-cycle · ⬜ needs-drain-visual ·
⬜ needs-gauges-visual · ⬜ needs-morale-visual ·
⬜ needs-proactive-queue-visual · ⬜ needs-replenishment-visual ·
⬜ needs-shift-cycle-visual · ⬜ nav-dynamic-updates-visual ·
⬜ nav-move-costs-visual · ⬜ nav-path-following-visual ·
⬜ nav-pathfinding-visual · ⬜ nav-ramp-routing-visual · ⬜ site-expansion

### Batch 6 — employee/economy/misc (18)
⬜ employee-skill-progression-visual · ⬜ employee-skills-visual ·
⬜ employee-training · ⬜ contract-negotiation · ⬜ economy-display-visual ·
⬜ economy-full-loop · ⬜ hauling-gate · ⬜ maintenance-cost-drain ·
⬜ scores-display-visual · ⬜ time-management-visual ·
⬜ safety-projection-visual · ⬜ core-loop-visual · ⬜ i18n-display-visual ·
⬜ main-menu-visual · ⬜ save-load-visual · ⬜ sandbox-mode ·
⬜ weather-display-visual · ⬜ weather-flood

### Batch 7 — big playthroughs, do last (14)
⬜ tutorial-playthrough · ⬜ level1-lose-arrest · ⬜ level1-lose-bankruptcy ·
⬜ level1-lose-ecology · ⬜ level1-lose-revolt ·
⬜ level1-playthrough-revolt · ⬜ level1-playthrough-win ·
⬜ level1-win-conservative · ⬜ level1-win-efficient ·
⬜ level2-playthrough-bankruptcy · ⬜ level2-playthrough-win ·
⬜ level3-playthrough-ecology · ⬜ level3-playthrough-win

104 total remaining across batches 2-7.

## Session log

Append a line each time you resume, so it's clear how far a given session
got and whether main was merged recently.

- 2026-08-06 — plan created; 4 files done pre-plan (mechanism + pilot batch).
- 2026-08-06 — Batch 1 (14 files) converted and interaction-verified.
  Findings #5-8 added (bundled setup steps must be split; rail-toggle bug
  is cross-role, not just player-to-player; BlastWorkshop auto-advances
  its internal tab; contract rows have no id-scoped selector). Full sweep
  green (typecheck, 122/122 command mode).
- 2026-08-06 — Merged main (landscape/terrain work, unrelated — clean,
  no conflicts on the mechanism files).
- 2026-08-06 — Batch 2 (25 files, all blast-*) converted and
  interaction-verified, including a full 24-file batch re-run at the end
  to catch cross-file regressions. Findings #9-14 added: per-hole
  sequence/charge have no exact-value UI path (only relative steppers or
  none at all); a per-hole-varying plan can fail validateBlastPlan in a
  way command mode's runner doesn't surface; **a real game bug fixed**
  (Finding #12 — BlastReportModal never reopened for a second blast fired
  on the same tick; fixed with a regression test); and two self-inflicted
  process bugs worth remembering — stale leading `command` actions
  surviving a partial hand-conversion, and stale `interaction` content
  surviving a role-only fix after an index mistake. `blast-visual-full`
  initially slipped through unconverted in a passing batch run (see
  caution note above the Done list) — caught and fixed before commit.
  Full sweep green (typecheck, 283 files/8038 tests, 124/124 command
  mode). Next: Batch 3 (survey-*, 13 files).
