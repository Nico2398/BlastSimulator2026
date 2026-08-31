# Pausing — the full procedure

Read this before halting a run on a dependency. The decision of *whether* to pause — work versus answer — is in the SKILL.md; this file is what a pause does.

## Steps

1. **File the blocker** as an ordinary issue, per `agentic-issue-creation`. It gets `ready` if you are confident it is real and specified, which after hitting it head-on you usually are.
2. **Set it as your issue's dependency** — the `blocked_by` relationship *and* the `## Blocked by` section, both, per `agentic-issue-creation`'s dependency section. The relationship is what `assignability.cjs` trusts.
3. **Save whatever you finished.** With commits, push `pipeline/feature-<label>` and open a **draft** pull request against `main`, labelled `paused`, carrying `Closes #<your issue>` and no `READY TO MERGE`. Its body states what is done, what remains, and what the blocker changes — format below. With no commits, skip this; there is nothing to hand over.
4. **Return your issue to the queue:** add `ready`, add `paused`, remove `in-progress`. `agentic-intake.yml` keeps the label defined, but create it idempotently first rather than assuming, so a repository that has never paused does not fail the step:

   ```bash
   gh label create paused --color fbca04 --force \
     --description "A run stopped here on a dependency; the queue returns to it when that dependency lands"
   ```
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
