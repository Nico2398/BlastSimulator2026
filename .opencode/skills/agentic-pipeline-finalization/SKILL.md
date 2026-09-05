---
name: agentic-pipeline-finalization
description: >
  Standard finalization procedure for TDD pipelines. Runs parallel code review,
  merges findings, refactors, validates, and opens PR. Used as the final phase
  of full, fix-bug, and multi pipelines.
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

Runs after qualimetry passes. Branch: `pipeline/feature-<label>` — `<label>` is `<issue>-<runId>`, per `agentic-pipeline-tdd`'s Branch naming.

**Parameters:**
- `skip_refactorer` (default: `false`) — set to `true` for bug-fix pipelines to skip refactoring phase.
- `visual_incomplete` (default: `false`) — set to `true` when visual feedback loop could NOT complete inspection (VISUAL: BLOCKED). When `true`, the PR MUST be created as draft (--draft) WITHOUT `READY TO MERGE`.

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

 1. Code review (parallel):
        Delegate to `agentic-pipeline-review-pr` skill's code review step.
        All five delegations go out in ONE message and are awaited in that same
        turn — never backgrounded. See that skill's rules for why.
 2. [merge-findings]     → Orchestrator merges all sub-reviewer findings → pass/fail.
                            Pass/fail evaluated AFTER all reviewers complete.
                            if fail → @implementer (big loop)
 3. @refactorer          → If `skip_refactorer=true` → skip this step (jump to step 5).
                            Otherwise: clean up conventions, no behavior change,
                            then re-run [test-runner] to verify no regression.
                            [test-runner] results:
                              PASS → continue to step 5 (skip qualimetry + code review)
                              FAIL → @implementer (big loop: TDD → qualimetry → finalization from start)
 4. [verify-commit]      → confirm refactor commit exists; auto-commit if dirty
 5. @validator           → Full validation: typecheck → tests → build
                            if fail → @implementer (big loop)
 6. [verify-commit]      → final commit check before PR
 7. [open-pr]            → create PR from feature branch to main.
                             Evaluate draft/ready per `agentic-pipeline-pr-management` skill,
                             and decide the `full-ci` label by the same skill's test.
                             Carry every defaulted requirement into the body under
                             `## Decisions taken` per `agentic-decision-autonomy`.
                             **If `visual_incomplete=true` → MUST use --draft, NO `READY TO MERGE`.**
                             **The PR leaves this step marked or --draft. Never both absent:
                             a channel CI runs is covered by the marker, not a reason to defer it.**
 8. [followup]           → Drain the follow-up register (below): every finding and scope cut
                             reported by a sub-agent this run, plus any decision material to
                             gameplay, economy, or a player-facing default. File each per
                             `agentic-issue-creation`, carrying the PR link, then post **one**
                             comment on the PR listing what was filed. The issues link to the
                             PR; the comment is what links the PR back to them, because
                             `open-pr` composed the body a step earlier and cannot name numbers
                             that did not exist yet.
                             Register empty → skip both the filing and the comment.
                             Filing never reopens an earlier step and never changes the PR's
                             status.
 9. [git-verify]         → confirm clean state: git status, branch, last commits
10. [await-ci]           → `npm run ci:await -- --pr <number>`. Blocks until every workflow
                             run on the PR head reports — no deadline, because any deadline
                             would be a guess about CI that reports "still running" as an
                             outcome. **The run does not end before this step does.**
                             Exit 0 (GREEN) → the run is finished. Exit 1 (RED) → the CI-fix
                             loop below. Exit 3/4 → say so in a PR comment naming what never
                             reported, then stop. Never pass `--timeout-minutes` in a
                             pipeline run: the bound is the job's own timeout, and reaching
                             it hands the PR to `agentic-ci-failure.yml` intact.
                             Skip only when the PR was created `--draft`: a draft already
                             names a channel that stayed red, and its issue is `blocked`.
```

**Retry counter:** resets at start of each finalization invocation.

### The follow-up register

A run's sub-agents notice work that is not this run's task: a reviewer finds pre-existing debt, an implementer hits a task bigger than one run, a test-writer finds a convention the codebase contradicts. None of them files an issue — every runtime denies its read-only agents the commands that mutate GitHub, and five parallel reviewers filing independently would produce five issues for one finding.

Instead the orchestrator keeps a register for the run. Every sub-agent report may append to it; nothing is filed until `[followup]`.

| Column | Holds |
|--------|-------|
| Kind | `finding` / `scope-cut` / `decision` |
| Reported by | Which agent, at which step |
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

Convention debt found `[in-diff]` is not recorded either: @refactorer fixes it inside the run, which is what that phase is for.

The register drained without this gate is a generator rather than a backlog. Five reviewers audit every pull request the pipeline merges, so entries scale with the pipeline's own output and not with any fixed stock of debt. One stretch ran at 0.99 filed issues per run — one new issue for every issue closed — with half of every merged pull request resolving an issue the pipeline had filed for itself, finding-chains seven generations deep from a single human task, and the median finding pointing at code merged two issue numbers earlier. The queue never grew; its contents were replaced, while the two human-authored gameplay issues in it went untouched. The gate protects the throughput, not the issue count.

`[followup]` runs **after** review and validation for one reason: by then every agent has reported, so the register can be deduplicated across all of them at once. The same debt reported by @quality-reviewer and @duplication-reviewer under two names is one issue, and only a pass that sees both can tell.

A register entry is not a blocker. It never holds the PR, never downgrades it to draft, and never delays `[await-ci]`. A run that files four follow-ups still finishes its own issue.

#### The comment `[followup]` posts

```markdown
## Follow-ups filed

Work this run found outside its own task. None of it blocks this PR.

| Issue | Kind | Labels | What |
|-------|------|--------|------|
| #N | finding | `agent-task` `ready` | one line, the summary the issue title carries |
| #M | scope-cut | `agent-task` `ready` | which slice was cut, and why it did not fit |
| #P | decision | `decision-review` | the default taken, and the lever that reverses it |
```

One comment per run, posted only when the register held something. An empty register posts nothing: a comment saying "none" on every pipeline pull request is noise, and it proves nothing anyway — a clean run and a run that dropped its findings write the same word. What separates them is the review output from the same run, which lists every `[pre-existing]` finding the reviewers reported. A reader comparing that list against this comment can see what went unfiled; a reader handed "none" cannot.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| [merge-findings] | @implementer (big loop) |
| @refactorer or [test-runner after refactorer] | @implementer (big loop) |
| @validator | @implementer (big loop) |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| [await-ci] | The CI-fix loop below — never a big loop: the PR exists and its branch is the deliverable |
| Any × 7 | Human escalation: add PR/issue comment summarizing failure + history, then stop with `ESCALATED: human intervention required` |

### The CI-fix loop — a red channel this run handed to CI is still this run's

`static`, `logic` and command-mode `scenario` are runnable in the session. Interaction-mode `visual`, the production `build`, and every channel on a machine with a GPU are CI's — and CI reports minutes *after* the step that opened the PR. Ending there is what PR #581 did: green on every channel its session ran, marked `READY TO MERGE`, two interaction shards red in CI, and `agentic-auto-merge.yml` skips a failed CI run by design. Nothing merged it, nothing chained, and issue #552 held `in-progress` with the whole queue behind it.

So `[await-ci]` is not a courtesy wait. It is the step that reads the channels this run deferred.

On RED, bounded at **3 rounds**, counted per finalization invocation:

1. Read the failing jobs the script named. Fetch the log; for an interaction-mode failure read the FAIL screenshots in the run's artifacts. Never re-run the whole suite locally to "confirm" it — a sandbox without a GPU cannot reproduce that channel, and #581's session already proved a local run of those exact files times out on load contention.
2. Decide which side is wrong, the change or the expectation, then delegate: `@fixer` for a test/expectation disagreement, `@implementer` for a defect in the change, `@visual-tester` when the failure is a rendering or click-reachability claim.
3. Commit and push to `pipeline/feature-<label>`. Never `[skip ci]` — `agentic-pipeline-pr-management` holds why.
4. Run `[await-ci]` again. The script reads one run per workflow, newest first, so the run CI cancelled on the previous head does not count against you.

After 3 rounds still red: convert the PR to a draft, comment naming the channel, what fails and what would unblock it, label the issue `blocked`, and stop with `ESCALATED: CI red after 3 fix rounds`. That is a terminal state — `handle-failure.yml` chains the queue past it.

**If the session dies before `[await-ci]` returns**, `agentic-ci-failure.yml` posts the failure back as a fresh task on the same PR, bounded by `AGENTIC_CI_FIX_ATTEMPT_LIMIT`. That is the fail-safe, not the plan: a nudged session pays the whole startup cost again to read a verdict this one was already holding.

When looping back to `@implementer` from any finalization step:
`@implementer on impl branch → cherry-pick → switch-to-feature → qualimetry → finalization`
Do NOT re-run skeleton-writer or test-writer — branches and tests already exist.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| merge-findings | Deduplicate and merge all reviewer outputs → pass/fail (evaluate after ALL reviewers complete) |
| After refactorer | `npx vitest run` — PASS → @validator, FAIL → @implementer (big loop) |
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<N>)"` |
| open-pr | Decide the `full-ci` label **before** calling `gh pr create`, by `agentic-pipeline-pr-management`'s test. `gh pr create --base main --head pipeline/feature-<label> --title "<type>: <summary> (#<N>)" --body "Closes #<N>\n\n<test_count> tests — all passing\n\n<decisions_block>\n\nREADY TO MERGE"`, adding `--label "full-ci"` to that same call when the test says yes. Determine `<type>` from pipeline: `full → feat`, `fix-bug → fix`, `multi → feat`. `<summary>` is one line, imperative mood, under ~70 characters, naming what changed for the player or the codebase — the descriptive half of the title pipeline PRs carried through #616 (`feat: Resolve #554 — charging is real work, a blaster loads holes one at a time`), e.g. `feat: charging is real work, a blaster loads holes one at a time (#554)`. Never the bare `<type>: Resolve #<N>`: that is what every pipeline PR from #773 to #980 read, and it says nothing in `git log`. The title carries no closing directive — the body's standalone `Closes #<N>` line is what closes the issue at merge — so the summary must not place `close`/`fix`/`resolve` in any tense immediately before a `#<number>`: `agentic-closing-keyword-guard.yml` reads the title and fails the PR on that shape (`keyword-closing-postmortem.md`). Count test cases: `npx vitest list --reporter=json 2>$null | ConvertFrom-Json | ForEach-Object { $_.testModules } | Measure-Object`. `<decisions_block>` is the `## Decisions taken` section, omitted when the run defaulted nothing. For draft: add `--draft`, omit `READY TO MERGE` line. For a **paused handover** (the run stopped on a dependency it filed — `agentic-decision-autonomy`): add `--draft --label "paused"` on the same call, omit `READY TO MERGE`, and use that skill's Done / Remaining / What the blocker changes / Resuming body instead of the test count. The `paused` label is what keeps the issue assignable, so it is never a follow-up edit either. **Never a follow-up `gh pr edit --add-label`** — a label added after `create` raises no `pull_request` event of its own on this repo's older CI trigger shape, and PR #615 merged with its `full-ci` interaction job silently skipped for exactly that reason (`ci.yml` now also re-evaluates on `labeled`, but the label belongs on the opening call regardless — the two are independent fixes for the same incident, not a reason to pick one). |
| await-ci | `npm run ci:await -- --pr <number>` (or `--head pipeline/feature-<label>` before the number is known). Exit codes: `0` GREEN, `1` RED with the failing jobs and their log URLs printed, `2` TIMEOUT (only reachable if you pass `--timeout-minutes`, which a pipeline run never does), `3` the PR is gone, `4` bad arguments or `gh` could not answer. It listens to **every** workflow run on the PR head — not `ci.yml` alone, since a check any workflow emits blocks the merge just as hard (PR #773's was the closing-keyword guard, with CI green) — minus a named list of merge-machinery workflows; it never re-runs a channel, and no verdict it reports depends on a duration. |
| followup | Drain the register in one pass through the filing gate above — defects only, one filed finding per run, convention debt recorded rather than filed — newest entry last, then `gh pr comment <pr-url> --body "<the table below>"` — one comment, only when something was filed. Decisions: `gh label create decision-review --description "A default the pipeline chose; revisit when convenient" --color ededed --force` then `gh issue create --label decision-review --title "Decision review: <summary> (from #<N>)" --body "<decisions block + PR link>"`. `--force` makes the label step idempotent — it updates an existing label instead of failing the run on every issue after the first. Findings and scope cuts: duplicate-check, then file per `agentic-issue-creation`, labels by its confidence table. **A bypassed blocker is not filed here** — its issue number has to exist before the `TODO(#N)` referencing it is written, so it was filed at the moment of bypassing, back in the TDD phase (`agentic-decision-autonomy`). Draining the register here only records it in the summary table. |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
