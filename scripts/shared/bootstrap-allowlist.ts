/**
 * BlastSimulator2026 — Bootstrap command allowlist
 *
 * Split out of interaction-executor.ts (#557): that file already mixes
 * several concerns, and the allowlist — a data table with its own
 * per-entry justifications — is a single responsibility of its own,
 * separate from the interaction-execution logic around it. A genuinely
 * new entry (`employee cancel`, needed for vibration-budget.json) belongs
 * here rather than growing that file further. interaction-executor.ts
 * still owns `isAllowedBootstrapCommand`/`matchesBootstrapEntry`, which
 * import this array; nothing about the check itself moved.
 *
 * @module shared/bootstrap-allowlist
 */

/**
 * Console commands a `bootstrap`-marked step may run (issue #515).
 *
 * Narrower than `SETUP_COMMAND_ALLOWLIST` (interaction-types.ts): a
 * bootstrap command has no UI equivalent and no business having one (e.g.
 * `employee assign_skill`, which exists so a test doesn't have to grind XP
 * for real — the player-facing path is `employee train`), rather than
 * standing in for world setup a player never does. Kept as an explicit list
 * for the same reason `OBSERVATION_COMMANDS` (interaction-executor.ts) is:
 * adding an entry is a visible edit here, not an accident of what a step
 * happened to call.
 */
export const BOOTSTRAP_COMMAND_ALLOWLIST: readonly string[] = [
  'employee assign_skill',
  'employee dispatch',
  // vibration-budget.json (#557): cleans up a bootstrap-only `employee
  // dispatch` action once it has done its one job (getting an employee clear
  // of a blast zone) — a real player has no "cancel my own dispatched
  // errand" button pointed at a specific PendingAction id, and leaving the
  // action to linger reopens the exact stall this cancel exists to close
  // (TaskCancellation.ts's interrupted-work-resume path keeps re-handing the
  // employee back to the stale action instead of letting them pick up real
  // work — see that scenario's own `employee cancel` step for the full
  // trace).
  'employee cancel',
  'weather set',
  'weather',
  'event fire',
  // TEMPORARY (cheats.ts): unblocks blast-execution-visual.json and
  // blast-visual-full.json, whose crews are genuinely undersized for their
  // own workload and hit a deterministic worker revolt before finishing —
  // not a UI gap a real click could stand in for, since the revolt is a
  // core-simulation outcome with no control to avert it. Tracked for
  // removal, alongside a real fix to that crew-sizing/revolt-margin gap, in
  // issue #631.
  'cheat disable_revolt',
  // Broader than the others on purpose, for two independent reasons:
  //  1. `corrupt target:X cost:Y` — the scenario overrides the bribe's cost
  //     to hit an exact scripted cash delta; ShadyPanel's real "Make the
  //     Call" button always bribes at the fixed TARGET_COSTS rate
  //     (Corruption.ts) and has no control for a custom amount, so no real
  //     click can reproduce this exact state change (level1-lose-arrest.json's
  //     opening 8 bribes all carry a `cost:` override) — the same shape of
  //     gap already accepted for bare `weather` above.
  //  2. Bare `corrupt` — the read-only status query — shares that same verb,
  //     so it rides the same entry.
  //  This entry is not file-scoped: the allowlist has no per-file mechanism,
  //  it is a flat global list, so any `bootstrap`-tagged step anywhere that
  //  runs `corrupt ...` (with or without a `cost:` override, e.g.
  //  insufficient-funds-guards-visual.json's plain `corrupt target:witness`
  //  bootstrap steps) is admitted by this one entry too. Accepted tradeoff
  //  for now — narrower only buys back a `target:witness`-shaped case that
  //  needs the override anyway, elsewhere in the same file.
  'corrupt',
  // building-lifecycle.json exercises the console's own bad-id rejection
  // (building #2 was never placed) — there is no row, so no button exists
  // in the DOM for `expect.blocked` to point at, and no player could ever
  // target an id that was never shown to them. Narrow (this exact id) on
  // purpose: every OTHER `build move`/`build destroy` in the suite acts on
  // a real building and is a real click or a `guard` against a genuinely
  // disabled (present) button.
  'build move 2',
  'build destroy 2',
  // `office`/`medical_bay`/`canteen`/`storage_depot`/`break_room`/`bunkhouse`
  // are not, and have never been, real `BuildingType` values (Building.ts) —
  // several playthrough/bankruptcy scenarios attempt them anyway and each
  // rejects with "Unknown subcommand or building type" (verified per-file).
  // No catalog row exists, or ever should, for a type that isn't real, so
  // there is nothing for a player to click; this is a permanent bootstrap
  // primitive, not a temporary one. Issue #526 confirmed these six strings
  // are permanently non-real and reconciled the docs accordingly; the
  // real-type mapping (office→management_office, storage_depot→freight_warehouse,
  // canteen/bunkhouse/break_room/medical_bay→living_quarters) now lives in the
  // gameplay-employee-needs skill doc.
  'build office',
  'build medical_bay',
  'build canteen',
  'build storage_depot',
  'build break_room',
  'build bunkhouse',
  // site-expansion.json: whether the 3D tile picker can raycast a
  // still-unexpanded region (before drilling/building there triggers
  // auto-expansion) is unverified — left as commands rather than gambling a
  // batch run on an edge case none of the suite's other converted files
  // needed. Exact-command narrow, not a general `drill_plan add`/`build_ramp`/
  // `build management_office` exemption — those verbs have real, exercised
  // click paths elsewhere (e.g. presplit-wall.json's `drill_plan add`).
  'drill_plan add x:34 z:10 depth:6',
  'drill_plan add x:-4 z:10 depth:6',
  'build_ramp origin:30,20 direction:east length:8 depth:6',
  'build management_office at:34,4',
  // tutorial-steps-visual.json: this ramp isn't one of the tutorial's own
  // canonical stages, so with the rail pointed elsewhere the Build panel's
  // ramp tool is off-target and inert to a real click (tutorialGuide.ts) —
  // no UI path reaches it while this tutorial runs.
  'build_ramp start:10,15 end:10,25',
  // level3-playthrough-ecology.json: `amount:12`/`amount:15` are outside
  // krackle's own [1, 10] kg range (ExplosiveCatalog.ts). The amount
  // stepper clamps to the selected product's range (Charge.ts), so no click
  // sequence can ever reach either value while krackle is selected — a
  // genuine reachability gap, not a missing selector. The console has no
  // such clamp, so `createCharge` rejects these at 0 charged, which is the
  // scenario's own point (a blast that fails to fire). See the step's own
  // description for the full trace.
  'charge hole:* explosive:krackle amount:12 stemming:1',
  'charge hole:* explosive:krackle amount:15 stemming:1',
  // `zone clear x1:.. y1:.. x2:.. y2:..` — Fire.ts's Sound the Horn button
  // always computes its own rectangle from the live drill plan
  // (`computeDangerZone`), never a player-typed one, so a literal rectangle
  // override has no UI equivalent and no business having one.
  'zone clear',
  // scores-display-visual.json: `stemming:0.5` is the Charge panel's own
  // floor — `adjustStemming` clamps at `Math.max(0.5, ...)` (Charge.ts) —
  // the minimal value reachable by any click sequence. Kept as `bootstrap`
  // for its `hole:*` batch shorthand rather than driving the individual
  // amount/stemming steppers for real (see blast-execution-visual.json for
  // the player-role version of this same charge).
  'charge hole:* explosive:boomite amount:8 stemming:0.5',
  // blast-fire/preview/sequence-step-visual.json: the Charge step right
  // after each of these is the Blast panel's own designated first-open
  // (`#bs-toolbar [data-panel="blast"]` is a toggle) — giving the drill
  // step its own panel-open click would leave the panel open and then
  // CLOSE it when the charge step's click ran next.
  'drill_plan grid origin:10,10 rows:1 cols:1 spacing:3 depth:6',
  'drill_plan grid origin:10,10 rows:2 cols:2 spacing:3 depth:6',
  // blast-preview-step-visual.json: an ABSOLUTE per-hole delay — the panel
  // only exposes relative +/- steppers (Sequence.ts), so there is no click
  // path to a specific value.
  'sequence set hole:H1 delay:0ms',
  // rock-fragmenter-breaking.json: fragment #0 is oversized, so
  // `findReachableGroundFragment`'s eligibility cache excludes it outright
  // and `.bs-vehicle-haul-btn` never renders for it — no control exists to
  // click, not merely one that's disabled.
  'vehicle haul 1 fragment:0',
  // vehicle-driver-assignment-visual.json: vehicle #1 already has a driver
  // (FleetPanel shows only Unassign, not the assign picker), and even that
  // picker would never list employee #2 (a blaster has no driving.truck
  // licence) — genuinely unreachable by a click.
  'vehicle driver 1 2',
  // vehicle-task-states-visual.json: `vehicle assign <id> task:<task>`
  // writes the VehicleTask enum directly, skipping the drive/load/unload
  // sequence ArrivalGate drives — a test-only state poke alongside
  // `employee assign_skill` (gap G5); every player-meaningful task has its
  // own real control instead (Haul, Break, MOVE HERE).
  'vehicle assign 1 task:transport',
  // needs-cycle.json: "hauler" is not a real hire role (Usage:
  // employee hire role:(driller|blaster|driver|surveyor|manager)) — there
  // is no hire button for a role that doesn't exist, a genuine no-op in
  // both modes.
  'employee hire role:hauler',
];
