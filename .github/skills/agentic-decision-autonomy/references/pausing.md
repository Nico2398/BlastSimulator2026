# Pausing — the full procedure

Read this before halting a run on a dependency. The decision of *whether* to pause — work versus answer — is in the SKILL.md; this file is what a pause does.

## Steps

1. **File the blocker** as an ordinary issue, per `agentic-issue-creation`. It gets `ready` if you are confident it is real and specified, which after hitting it head-on you usually are.
2. **Set it as your issue's dependency** — write the `## Blocked by` section, per `agentic-issue-creation`'s dependency section. `handle-failure.yml`'s `reconcile-dependencies` job derives the `blocked_by` relationship from that section, so the section is the one half you write here and the relationship follows on its own. Write it in whatever order suits you: the job fires both on the halt label and on an edit to an issue already carrying one, so whichever of your two writes lands second is the one that reconciles (#1127 — the label alone used to read the section before it existed). Setting the relationship yourself as well is harmless and still correct — it is what `assignability.cjs` treats as authoritative — but forgetting it is no longer a silent gap: `blockedByFor` reads the union of the two, so the section alone already holds the queue, which is exactly why the missing relationship used to go unnoticed (#1090, 16 Sep 2026).
3. **Save whatever you finished.** With commits, push `pipeline/feature-<label>` and open a **draft** pull request against `main`, labelled `paused`, carrying `Closes #<your issue>` and no `READY TO MERGE`. Its body states what is done, what remains, and what the blocker changes — format below. With no commits, skip this; there is nothing to hand over.
4. **Return your issue to the queue:** add `ready`, add `paused`, remove `in-progress`. `agentic-intake.yml` keeps the label defined, but create it idempotently first rather than assuming, so a repository that has never paused does not fail the step:

   ```bash
   gh label create paused --color fbca04 --force \
     --description "A run stopped here on a dependency; the queue returns to it when that dependency lands"
   ```

   The blocker's `ready` label is not checked at file time — it is checked after the fact, hourly, by `agentic-watchdog.yml`'s stranded-pause sweep, which calls `strandedPauseVerdict` in `assignability.cjs`. File the blocker with `ready` at file time regardless (this step already says so); the sweep is the safety net for when that step is missed, not a substitute for it.

   **Warning:** if the blocker's own `## Blocked by` section contains prose that happens to name your paused issue's number — explaining *why* it was filed as a dependency, for instance — that prose used to be read as a declared dependency (not commentary), creating a mutual-blocking cycle neither issue could escape. `parseDependencies` now treats a section whose first non-empty line begins with `None` as declaring nothing, which closes that specific shape — but keep any explanation of the relationship in a `## Context` or `## Resuming` section regardless, never in `## Blocked by` itself, since not every phrasing is covered by that guard.
5. **Comment on your issue** naming the blocker, what you finished, and the PR that holds it. Stop with `PAUSED: waiting on #<blocker>`.

What then happens without anyone watching: `assignability.cjs` skips your issue while the blocker is open, `handle-failure.yml` chains the queue on to the next issue, the pipeline works the blocker, and when the blocker's PR merges your issue becomes assignable again. The next run is told to resume from your draft PR's branch rather than start over.

## The handover PR body

```markdown
Closes #<your issue>

⏸️ **Paused — waiting on #<blocker>.**

## Done
- <what is on this branch, and which verification channels passed on it>

## Remaining
- <what is left, in the order to do it>

## What #<blocker> changes
<why the remaining work could not be done until that issue lands, and what
becomes possible once it has>

## Resuming
Continue on this branch. Do not open a second pull request against
#<your issue> — an issue with a second open PR is unassignable to everyone.
Re-run every verification channel: these results were recorded against an
older `main`.
```

## Two ways a pause is undone by accident

**Never close a paused PR to tidy up, and never merge it.** Closing discards the work; merging lands a half-finished change. It stays a draft until the run that resumes it finishes it.

**Never leave a paused issue holding `in-progress`.** The pause is terminal for your session — `agentic-run-state` reads the `paused` label and schedules no retry — and an issue left `in-progress` defers every later assignment until the watchdog sweeps it.
