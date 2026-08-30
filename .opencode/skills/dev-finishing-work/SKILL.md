---
name: dev-finishing-work
description: >
  Finish-line procedure for a coding change in BlastSimulator2026: running the verification
  channels the change touches, handing the browser-heavy ones to CI, committing and pushing,
  opening and labelling the pull request, reading the CI result instead of assuming it,
  driving a red CI back to green, and reporting what actually ran. Use before claiming any
  coding task complete, and whenever a push, a pull request, or a CI result is involved.
---

## Finishing Work

A change is finished when its evidence is in hand — not when the diff looks right, not when the pull request exists. This page is the last mile: prove it, land it, read what CI says about it, report it honestly.

The Verification Gate in the entry point decides *which* channels a change owes. This decides what happens after they pass.

## ▶ PROCEDURE — the finish line

1. **Run every channel the change touches.** The Verification Gate names them; run the ones the change earns, not the cheapest one.
2. **Hand the browser-heavy channels to CI** — see the ownership table below. A channel CI owns is covered, never pending.
3. **Commit and push** to the branch this work belongs on.
4. **Open the pull request** if none is open, and apply the labels the change earns.
5. **Read the CI result on the pushed head.** Not the merge state — the check runs themselves. This step is not optional and not deferred to the next session.
6. **Drive a red CI green** on the same branch, or state plainly why a failure is not this change's to fix.
7. **Report which channels ran and what each showed**, naming anything left unproven.

Steps 5 and 6 are where a finished-looking change stops being finished. Everything below serves them.

## Which channels you run, which CI runs

| Run | Where |
|-----|-------|
| `static`, `logic`, `scenario` (command mode) | Either. CI runs all three on every push and pull request. |
| `screenshot`, one named scenario in interaction mode | Your session — this is the `visual` channel's working loop. |
| `build` (production bundle) | CI job `Production build`, on PRs labelled `build-check`. |
| All scenarios in interaction mode | CI job `Scenarios (interaction mode)`, on PRs labelled `full-ci`. |

Locally, run one named definition you are actively debugging. Never the whole interaction-mode suite: without a GPU the terrain material costs ~6 s **per frame** in software rasterisation (#475), and the browser harnesses wait a full frame per probe, so one player action costs tens of seconds and one scenario beat costs minutes. Level loading is cheap by comparison (a `new_game` is ~4 s, a campaign start ~16 s), and the simulation itself is not the cost — turning ticking off changes the frame by 1.7%. Do not go looking for it in world size, navgrid rebuilds, or terrain generation.

## Labels decide what CI proves

- **`full-ci`** — the interaction-mode job. Apply it when an interaction-mode scenario actually drives the change, or when the change touches machinery every scenario runs through. Not on every diff a player can see. It is real added time on the merge path: sharded, it lands around 12 minutes wall clock, and each shard's ~11-12 min is mostly harness batch time that scales down with shard count (`SCENARIO_INTERACTION_SHARDS`).
- **`build-check`** — the production bundle. Apply it when the change touches build config (`vite.config.ts`, `tsconfig*.json`, `package.json` dependencies) or bundling and chunking itself. `static` already catches what would break the bundle far more often than a Vite-specific failure does.

The two are independent: a pull request can drive the interaction-mode scenarios without proving the bundle, and the reverse. The label test and its cost live in `agentic-pipeline-pr-management`.

## ▶ Reading the CI result

**A red CI is announced to nobody.** The auto-merge workflow declines a failed run and the watchdog skips any issue with a linked pull request, so a failure nobody reads sits there holding the queue. Handing a channel to CI buys a report — it does not excuse leaving before the report arrives.

Read it one of two ways:

- `npm run ci:await -- --pr <number>` blocks until every workflow run on the pull request head reports, then exits green or red. This is the finishing step of an autonomous run — `agentic-pipeline-finalization` holds it and its bounded fix loop, and `agentic-pipeline-ci-fix` is the pipeline for a red CI handed back to a later session.
- Where that tool cannot run (no `gh` on PATH, no token), read the pull request's **check runs** directly through whatever GitHub access the session has, and keep reading until every run has completed.

**`mergeable_state` is not a CI verdict.** It describes mergeability, and it reads `unstable` for a pull request whose checks are merely still running — which looks exactly like a pull request whose checks failed. A run that reads the merge state, calls it "still settling", and reports the work done has not read CI at all.

Two pull requests paid for this rule:

| PR | What the session did | Cost |
|----|----------------------|------|
| #581 | Green on every channel it ran locally, marked `READY TO MERGE`, ended. | Two interaction shards red. Issue #552 held the queue until a human looked. |
| #888 | Opened the PR, labelled it, read `mergeable_state: "unstable"`, called it settling, reported success. | One interaction shard red — on the run's own new scenario. Found only because a human asked. |

## ▶ Driving a red CI green

Pull the failing job's logs and read the actual assertion before touching anything. Then:

1. **A failure in code the change touches or breaks** is this change's to fix. Fix it on the same branch and push.
2. **A failure in code the change does not touch** — rule out that it is not this change's at all: an error naming a service the diff never touches that reproduces identically on one re-run, or a check red on the base branch too. When a fix exists, port it and push; when none does, say so plainly with a proposed patch rather than widening the change.
3. **"Flake" is not a root cause.** Re-run a job only to confirm that first case, or if it died before any test body ran (checkout, install, runner loss). At most once. A second failure is real.
4. **Never skip, disable, or quarantine a test to reach green**, and never push an empty commit to kick CI.

**A margin that holds in your sandbox is not a margin that holds in CI.** The environments differ in ways that decide timing-sensitive assertions: browser version, and one shared browser across a whole shard against a dedicated one per local run. PR #888's own new scenario asserted a scroll position immediately after dispatching a wheel event — `page.mouse.wheel()` resolving does not mean Chrome has committed the scroll, since it can land on the compositor thread after the CDP call returns. It passed every local run and failed CI reproducibly. When an assertion depends on the browser having settled, make it wait for that explicitly rather than relying on a margin that happens to hold locally.

Before pushing a fix, reproduce the original failure, then show the same check passing. Keep the fix minimal. One validated push beats three speculative ones.

## While a browser-driven run is in flight

- **Change no file.** Vite reloads the page and kills the run with `Execution context was destroyed`, which reads like a game bug and is not.
- **Start no second browser harness.** Each launches its own browser; two starve each other and both look hung.
- **Wait for the run's own terminal line.** Slow is not stuck. A run you interrupted produced no result — report that channel as pending, never as passed.

## Reporting

State which channels ran and what each showed. A channel handed to CI is reported by CI's result, once read. A channel that could not run at all is named as unproven, with the reason — never as passed, and never substituted with a weaker artifact (a state dump standing in for an image nobody inspected).

"Tests pass" is not a verification report for a change that was visual, and "CI looks fine" is not a CI report. Name the jobs and their conclusions.
