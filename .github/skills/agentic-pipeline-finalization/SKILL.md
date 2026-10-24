---
name: agentic-pipeline-finalization
description: >
  Final phase of the full, fix-bug and multi pipelines: one independent review,
  the lead's fixes, sync with main, the pull request, the follow-up register,
  and the in-turn wait for CI with its one fix round.
---

## ▶ PROCEDURE — EXECUTE IN ORDER

Runs on `pipeline/feature-<label>` — `<label>` is `<issue>-<runId>`, per `agentic-pipeline-tdd`'s Branch naming — with the tree committed and `npm run pipeline -- verify` green.

**Parameter:** `visual_incomplete` (default `false`) — `true` when the visual feedback loop ended `VISUAL: BLOCKED`. Then the PR MUST be a draft WITHOUT `READY TO MERGE`.

```
[ ] = a step the lead runs itself  |  @agent = a delegation

 1. [verify]          → npm run pipeline -- verify. Already green on this tree → it answers
                        from its cache in a second.
 2. @reviewer         → Brief: issue number, every TDD label of the run, the plan file's
                        content. One reviewer, never a fan-out: it applies only the sections
                        `review-brief` says the diff owes.
 3. [apply-review]    → The lead fixes every `fix` finding and every rejected tamper, adds
                        every `file` finding to the follow-up register, commits
                        `review: <what> (#<issue>)`, runs `verify`.
                        Verdict was REQUEST CHANGES → @reviewer again, a fresh one, briefed
                        with its previous report and "review only the commits since <sha>".
                        At most two re-reviews, none once the loop budget is closed; what
                        still stands goes on the PR as a red channel does.
 4. [sync-main]       → bring the feature branch up to date with the current `main` (below).
 5. [open-pr]         → create the PR (below). Evaluate draft/ready per
                        `agentic-pipeline-pr-management`. Carry every defaulted requirement
                        into the body under `## Decisions taken`.
                        **If `visual_incomplete=true` → MUST use --draft, NO `READY TO MERGE`.**
                        **The PR leaves this step marked or --draft. Never both absent:
                        a channel CI runs is covered by the marker, not a reason to defer it.**
 6. [followup]        → Drain the follow-up register (below), then post **one** comment on
                        the PR listing what was filed. Register empty → skip both.
 7. [await-ci]        → `npm run long -- start ci -- npm run ci:await -- --pr <number>`, then
                        `npm run long -- wait ci` until FINISHED. **The run does not end before
                        this step does.** Exit 0 (GREEN) → the run is finished. Exit 1 (RED) →
                        the CI-fix round below. Exit 3/4 → say so in a PR comment naming what
                        never reported, then stop. Never pass `--timeout-minutes` in a
                        pipeline run. Skip only when the PR was created `--draft`.
```

**Retry counter:** resets at the start of each finalization.

The review runs once per pull request, on the diff that ships: the lead's refactor and context upkeep came before it. It is the one step the lead cannot do itself — an author reviewing its own diff reads what it meant to write.

### The follow-up register

A run notices work that is not its task: the reviewer finds pre-existing debt, the lead hits a task bigger than one run, the test-writer reports a contract gap. None of it is filed when it is noticed — the sub-agents cannot mutate GitHub by design, and filing as you go files one finding twice under two names.

Instead the lead keeps a register for the run. Every report may append to it; nothing is filed until `[followup]`.

| Column | Holds |
|--------|-------|
| Kind | `finding` / `scope-cut` / `decision` |
| Reported by | Who, at which step |
| Summary | One line, enough to duplicate-check against |
| Evidence | File and line, the failing case, or the constraint that forces the cut |
| Confidence | Whether it is verified real, or needs a human to confirm — this is what `agentic-issue-creation`'s label table reads |

#### ▶ The filing gate — what a register entry becomes

Draining the register is a disposition, not a transfer. Every entry becomes exactly one of three things:

| Entry | Becomes |
|-------|---------|
| A **defect** — behaviour observably wrong, or a verification channel that fails to prove what it claims | An issue, subject to the cap below |
| **Convention debt** — duplication, file length, naming, comment drift, a missing mirrored test, "consider extracting" | A row in the follow-up comment. No issue. |
| A **bypass**, a **pause**, a **scope cut**, a **decision** | An issue always: a `TODO(#N)` or a named remainder points at it, so dropping it leaves the codebase referencing nothing. Outside the cap. |

**One filed finding per run.** On top of the structural issues in the last row, a run files at most one issue for what it noticed. A second defect goes in the comment with its evidence, where a human or a later run promotes it. The cap rarely binds — genuine defects arrive well under one per run — and it is what keeps review volume from becoming queue volume.

Convention debt found `[in-diff]` is not recorded either: the lead fixes it inside the run.

`[followup]` runs **after** review for one reason: by then every report is in, so the register can be deduplicated across all of them at once.

A register entry is not a blocker. It never holds the PR, never downgrades it to draft, and never delays `[await-ci]`. A run that files four follow-ups still finishes its own issue.

#### The comment `[followup]` posts

```markdown
## Follow-ups filed

Work this run found outside its own task. None of it blocks this PR.

| Issue | Kind | Labels | What |
|-------|------|--------|------|
| #N | finding | `agent-task` `ready` `scope:<area>` | one line, the summary the issue title carries |
| #M | scope-cut | `agent-task` `ready` `scope:<area>` | which slice was cut, and why it did not fit |
| #P | decision | `agent-task` `decision-review` `scope:<area>` | the default taken, and the lever that reverses it |
```

A finding or scope-cut row whose Labels lack `ready` ends its What cell with `— held: <the open question>`. A row with neither is the filing error `agentic-issue-creation` names: add `ready` to the issue before posting.

One comment per run, posted only when the register held something. An empty register posts nothing: a comment saying "none" on every pipeline pull request is noise, and it proves nothing anyway — a clean run and a run that dropped its findings write the same word. What separates them is the review output from the same run, which lists every `[pre-existing]` finding the reviewers reported. A reader comparing that list against this comment can see what went unfiled; a reader handed "none" cannot.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| [verify] | `agentic-pipeline-tdd`'s fix loop |
| @reviewer REQUEST CHANGES | [apply-review], then a scoped re-review |
| [sync-main] conflict | resolve, then `verify` |
| [await-ci] | The one CI-fix round below — never a rebuild: the PR exists and its branch is the deliverable |
| Any × 7 | Comment the failure and its history on the PR or issue, stop with `ESCALATED: human intervention required` |

### The CI-fix round — a red channel this run handed to CI is still this run's

`static`, `logic` and command-mode `scenario` are runnable in the session. Interaction-mode `visual`, the production `build`, and every channel on a machine with a GPU are CI's — and CI reports minutes *after* the step that opened the PR. `agentic-auto-merge.yml` skips a failed CI run by design: a run that ends at open-pr leaves a red CI that nothing merges and nothing chains from, with its issue holding `in-progress` and the whole queue behind it.

So `[await-ci]` is not a courtesy wait. It is the step that reads the channels this run deferred.

On RED, **one round**, counted per finalization invocation, and only while the loop budget is open (`agentic-autonomous-pipeline`):

1. Read the failing jobs the script named. Fetch the log; for an interaction-mode failure read the FAIL screenshots in the run's artifacts. Never re-run the whole suite locally to "confirm" it — a sandbox without a GPU cannot reproduce that channel, and a local run of those files times out on load contention.
2. Decide which side is wrong, the change or the expectation, and fix that side yourself — a RED test only under `agentic-pipeline-tdd`'s fix-loop rule. Delegate `@visual-tester` only when the failure is a rendering or click-reachability claim that needs screenshots read.
3. Commit and fetch — the merge gate may have merged `main` into the branch since the PR opened — then `git pull --no-rebase origin pipeline/feature-<label>` and push, or rebase onto `origin/main` and `git push --force-with-lease`. Never `[skip ci]` — `agentic-pipeline-pr-management` holds why. Never a bare `--force`.
4. Run `[await-ci]` again. The script reads one run per workflow, newest first, so the run CI cancelled on the previous head does not count against you.

Still red after that round, or red with the loop budget closed: **end the run with the pull request as it stands** — marker on, not a draft, the issue's labels untouched — and say so in the summary comment, naming the failing jobs. `agentic-ci-failure.yml` hands that red to a fresh session with a whole budget, bounded by `AGENTIC_CI_FIX_ATTEMPT_LIMIT`; because this session was live when the verdict landed, the watchdog's sweep is what raises it — `agentic-autonomous-pipeline`'s github-loop reference holds the path. The same fail-safe covers a session that dies before `[await-ci]` returns.

A round costs the same in a spent session as in a fresh one, and the fresh one has the budget to finish.

### Steps in detail

| Step | Action |
|------|--------|
| sync-main | `git fetch origin main && git merge --no-edit origin/main`. Merges nothing when the branch already contains `main`. A conflict: resolve it so both sides' intent survives (lockfiles and generated files regenerated with their tooling, a mirrored context file resolved once and copied to all three runtimes), commit the merge, then `npm run pipeline -- verify`. The merge gate merges a PR only on a head containing `main`'s tip, so a branch that skips this step pays for it with an extra CI round after it opens — `agentic-autonomous-pipeline` holds why `main` moves under a run. |
| open-pr | `gh pr create --base main --head pipeline/feature-<label> --title "<type>: <summary> (#<N>)" --body-file <body>`, where `<body>` is `.github/PULL_REQUEST_TEMPLATE/pipeline.md` copied outside the working tree (so the tree stays clean) with every `<…>` placeholder filled. Determine `<type>` from pipeline: `full → feat`, `fix-bug → fix`, `multi → feat`. `<summary>` is one line, imperative mood, under ~70 characters, naming what changed for the player or the codebase, e.g. `feat: charging is real work, a blaster loads holes one at a time (#<N>)`. Never the bare `<type>: Resolve #<N>`: it says nothing in `git log`. The title carries no closing directive — the body's standalone `Closes #<N>` line is what closes the issue at merge — so the summary must not place `close`/`fix`/`resolve` in any tense immediately before a `#<number>`: `agentic-closing-keyword-guard.yml` reads the title and fails the PR on that shape. `## Verification` is the report the Definition of Done asks the body for (`agentic-autonomous-pipeline`): one line per channel, saying what ran and what it showed, per `dev-finishing-work`; `<test_count>` is the `Tests` total in the last `verify` run's `logic` log. `## Decisions taken` is the block `agentic-decision-autonomy` formats, dropped when the run defaulted nothing. For draft: add `--draft`, drop the `READY TO MERGE` line. For a **paused handover** (the run stopped on a dependency it filed — `agentic-decision-autonomy`): add `--draft --label "paused"` on the same call and fill `.github/PULL_REQUEST_TEMPLATE/paused.md` instead, which carries no `READY TO MERGE` line. The `paused` label is what keeps the issue assignable, so it is never a follow-up edit either. **Never a follow-up `gh pr edit --add-label`** — a label added after `create` raises no `pull_request` event of its own. |
| await-ci | `npm run ci:await -- --pr <number>` (or `--head pipeline/feature-<label>` before the number is known). Exit codes: `0` GREEN, `1` RED with the failing jobs and their log URLs printed, `2` TIMEOUT (only reachable if you pass `--timeout-minutes`, which a pipeline run never does), `3` the PR is gone, `4` bad arguments or `gh` could not answer. It listens to **every** workflow run on the PR head — not `ci.yml` alone, since a check any workflow emits blocks the merge just as hard (the closing-keyword guard can fail with CI green) — minus a named list of merge-machinery workflows; it never re-runs a channel, and no verdict it reports depends on a duration. |
| followup | Drain the register in one pass through the filing gate above — defects only, one filed finding per run, convention debt recorded rather than filed — newest entry last, then `gh pr comment <pr-url> --body "<the table below>"` — one comment, only when something was filed. Decisions: `gh label create decision-review --description "A default the pipeline chose; revisit when convenient" --color ededed --force` then `gh issue create --label agent-task --label decision-review --label scope:<area> --title "Decision review: <summary> (from #<N>)" --body-file <body>`, the body filled from `.github/ISSUE_BODY_TEMPLATE/decision-review.md` per `agentic-decision-autonomy`. `--force` makes the label step idempotent — it updates an existing label instead of failing the run on every issue after the first. Findings and scope cuts: duplicate-check, then file per `agentic-issue-creation` — `agent-task` and the `scope:*` labels of the code the finding lives in, always; `ready` whenever its Definition of Ready holds, which a reproduced defect with no open question does. A finding filed without `ready` carries an `## Open question` in its body, and its row in the comment below names that question. **A bypassed blocker is not filed here** — its issue number has to exist before the `TODO(#N)` referencing it is written, so it was filed at the moment of bypassing, back in the TDD phase (`agentic-decision-autonomy`). Draining the register here only records it in the summary table. |

History: docs/context-history/agentic-pipeline-finalization.md
