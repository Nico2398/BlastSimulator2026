# History — dev-scenario-authoring

This file records why the rules in the `dev-scenario-authoring` skill exist. The scenarios' own history lives in the issues named here.

## Step role (issue #479, extended by #515)

Step roles came from issue #479 and were extended by #515. Before #479, interaction mode was measured at 94% `command` actions — the console replayed in a browser. Issue #515 turned `role` from a convention a step could skip into a structural lint (`tests/unit/lint/ScenarioStepsHaveRole.test.ts`): every step now carries one of the five roles, or is a documented, individually-tracked exception — untagged is no longer a valid resting state.

A setup step reaching for `employee assign_skill` or any other gameplay command to dodge a hard click is exactly the drift #479 fixed. What used to rest untagged is now either converted to one of the five roles or a documented permanent exception tracked individually; a step reaching for a gameplay command to dodge a hard click is exactly the drift #479 and #515 both close.

## Step goal (`expect`)

A chained absolute (`equals: {"cash": N}`) is most of what made #553's own scenario migration expensive — 51 files, most of the diff pure cash renumbering, and exactly the ripple issue #596 exists to close. The #554-#557 "is real work" migrations inserted queued-work time into scenarios that had none; `changedBy` means editing only the inserted step's own `expect`.

The staffed-opening composition (`STARTING_SITE_STAFFED_COMPOSITION`) came from issue #551. The `campaign complete level:<id>` console-only debug force-win came from #1431.

`rock-fragmenter-breaking.json`'s `new_game` step had its starting cash bumped from $150,000 to $165,000 after the tick-divergence root cause was confirmed against a real interaction-mode run (issue #697; the file's own `new_game` step description has the full trace).

The `waitUntil` action came from issue #590. From issue #554 onward, a loaded charge, a dug ramp segment and a built building became queued work alongside a drilled hole. `tutorial-playthrough.json`/`blast-basic.json` predate `waitUntil`.

## Step outcome (`commandOutcome`)

Issue #585 audited 412 silently-refused commands across 63 files — steps recorded as "ran" whether the console accepted or refused their command.

## Interaction-only steps (`interactionOnly`)

`interactionOnly` came from the `tutorial-interactive` sale-count work in #1338; `skipWhenLevelEnded` from #1339.

## Interaction actions

- `waitForTutorialStep` became deterministic (looping the console's own `tick 1`) in issue #601.
- `awaitUsable`'s `"inPlace": true` came from #1629.
- `resolveEventIfPending` reads game state because of the slow render frame tracked in #475.
- `setStepper` exists because a run of `.bsx-stepper-btn` clicks encoded the value as "default plus count" — PR #1070's first red shard.
- The Move Here / Dispatch Here own-tile pre-selection came from #1766.

### ▶ A flat delay is the last resort, never the first

PR #888 is what the shortcut costs: a scroll asserted immediately after `page.mouse.wheel()` failed in CI because Chrome can commit a wheel-triggered scroll on the compositor thread after the CDP call returns. A flat delay was reached for first; it would have hidden the timing dependence behind a number that happened to work. `waitForProperty` polls for the real value, costs only the time the browser actually takes, and still fails when the scroll never lands — which is what that scenario's negative control depends on.

`set`/`clickLabel`/`awaitUsable`/`zoomOut`/`focusTile`/`clickEntity`/`clickIfPresent`/`resolveEventIfPending` were ported from the playability harness (issue #479) to close gaps in the click vocabulary — before them, some player steps had no click-equivalent at all and stayed console commands.

The `waitForSelector` presence-not-visibility trap was found in #545.

`waitUntil` loops `tick 1` inside the live page since issue #601. `effectiveStepTimeoutMs` now derives the raced value; before it, a step whose `timeout` was never raised degraded into a generic `Step N timed out after 60000ms` — PR #616 fixed 53 files' worth of this by hand and still missed 12.

Scenario mode's guide timer stopped truncating `tick N` in #1550; the overlay stopped advancing steps on its wall-clock timer in #1580.
