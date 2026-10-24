# History — agentic-autonomous-pipeline

Records why the rules in the `agentic-autonomous-pipeline` skill (`SKILL.md` and its `references/`) exist: the incidents, runs and measurements they came from.

## SKILL.md — A runner session gets exactly one turn

The runtimes disagree on what delegation defaults to; `references/runtime-parity.md` records which layer enforces the rule, and the run that died proving it necessary (issue #404, see "runtime-parity.md — Where a shared instruction stops being enough" below).

## SKILL.md — The loop budget

Runs 565, 591, 606 and 609 (#921, #947, #953, #956) each finished their TDD cycle inside the first hour and spent the next five iterating — scenario recalibration, a visual loop on a runner without a GPU, fix rounds against CI — until the job clock cut them off with nothing landed.

## SKILL.md — Branch namespace — solution-independent

Rule 4 (every branch a run creates carries that run's id): #554 spent two six-hour budgets proving why: the second run rebuilt `pipeline/feature-554` from `main` while the first run's abandoned branch still held the name, and the rescue push was refused `non-fast-forward` with the whole run on it.

## SKILL.md — Before ending: verify the issue, branch and PR agree

The closing-keyword checklist item used to end: "`references/keyword-closing-postmortem.md` has the real incident this was learned from, in four rounds — read it once before you next write a PR that mentions an issue you are not closing." The postmortem's full text follows; the reference file was deleted and the rule is now stated in the checklist itself.

### Postmortem: GitHub's closing-keyword parser and prose

| Exhibit | PR | Issue | What happened |
|---|---|---|---|
| 1 | 750 | 707 | Body explained, correctly, that the PR did not resolve the issue — using the closing-keyword phrase to say so. Merged; issue ended anyway. |
| 2 | 753 | 707 | Written specifically to document exhibit 1. Quoted exhibit 1's own disclaiming sentence as evidence, in plain prose. Merged; same issue ended a second time. |
| 3 | 641 | 572 | Wrote a genuine, correctly-parsed closing reference. The fix behind it answered a tangent (why the issue's own pipeline run had gone missing) rather than the issue's original report (an unbounded loop, still unguarded in the codebase after this PR merged). |
| 4 | 754 | 707 | Opened specifically to correct exhibits 1 and 2, with its own new commits and PR body checked clean beforehand. Still ended the same issue a third time — see below. |
| 5 | (the PR for #755) | 755 | Reproduced exhibit 1's shape deliberately against a throwaway test issue and confirmed the mechanical guard below catches it before merge, rather than documenting the rule a fourth time. |

#### Why exhibits 1 and 2 matter more than they look

GitHub's merge-time parser scans PR bodies and commit messages for a fixed set of keywords — close/closes/closed/fix/fixes/fixed/resolve/resolves/resolved — immediately followed by `#` and a number. It has no concept of negation, quotation, or tense. A sentence can be entirely honest and entirely correct in a human reader's eyes and still trigger a close, because the parser reads five words and a number, nothing else.

Exhibit 2 is the sharper lesson: a session writing *about* exhibit 1's failure, explaining the exact mechanism, reproduced it in the same PR body — by quoting exhibit 1's own sentence as evidence, without noticing the quotation itself carried the trigger. Explaining the bug is not protection against repeating it.

#### Why exhibit 4 is the sharpest lesson of the three

Exhibit 4's own new commits and its own PR body were checked clean before it was opened — no adjacent keyword-and-number anywhere in either. It still closed the same issue, because the trigger was neither: it was a commit already merged once before, in exhibit 2's own squash-merge.

Squash-merging a pull request does not discard its constituent commit messages — it concatenates them into the new squash commit's message, verbatim, keyword-shaped text included. Exhibit 2's squash commit therefore carries its original commit's disclaiming sentence forward into the base branch permanently, as part of that squash commit's own message.

The branch that produced exhibit 2 was then updated for exhibit 4 with a merge of the base branch back in, specifically to avoid a force-push. That choice is what let the same original commit reappear: merging preserves the branch's own prior commits by their original SHA, so the pre-squash commit — content already landed, message unchanged — stayed reachable from the branch tip and rode into exhibit 4's own commit range as if it were new. Exhibit 4's squash commit concatenated it in turn, carrying the same disclaiming sentence into the base branch a second time, and that is what closed the issue again on merge.

#### What did protect against it

Exhibit 2's PR body also referenced exhibit 3's issue number, written as inline code — a closing-keyword phrase inside backticks. That issue was unaffected. The parser skips code spans and fenced code blocks entirely; that is the one reliable boundary, in a commit message exactly as in a PR body.

#### What makes it unnecessary to write around now (issue #755)

Exhibits 1, 2 and 4 all happened because the only defense was a human or agent
re-reading their own prose and catching a pattern shaped like the one they had
just been warned about — and each of the three sessions that tried that,
failed at it. That is not a reliability gap prose can close by being written
more carefully; it needs a machine reading the text the same way GitHub's
parser does, before the merge happens rather than after.

Two changes, evaluated together per issue #755's own instructions:

- **A repo setting alone does not cover it.** GitHub has no setting that
  disables closing-keyword parsing — Settings → General → Pull Requests has no
  such toggle, confirmed by both a search of GitHub's own documentation and the
  absence of any matching field on the repository API resource. What the repo
  *does* control is which text becomes a squash commit's message:
  `squash_merge_commit_message` is `COMMIT_MESSAGES` (concatenates every
  constituent commit message verbatim — exactly the mechanism exhibit 4 used to
  carry a stale commit message forward). Switching it to `PR_BODY` would close
  exhibit 4's specific vector for a squash merge — recorded as a decision under
  `## Decisions taken` on the PR for #755, not applied by that run itself,
  because a repository-settings write needs the `Administration` permission and
  the pipeline's token carries only `contents`/`pull-requests`/`issues` write.
  Even applied, it would not be complete: this repo still allows merge-commit
  and rebase-merge, both of which land every constituent commit message on
  `main` verbatim regardless of this setting, and exhibits 1 and 2 were never a
  commit-message problem in the first place — they were the PR body itself. The
  setting narrows the surface; it does not obsolete a check on the text.
- **A required CI check reads the PR the same way the parser does.**
  `.github/workflows/agentic-closing-keyword-guard.yml` runs
  `.github/scripts/check-closing-keywords.cjs` against the PR title, the PR
  body, and every commit message in the PR's range on every open/edit/push —
  matching `close[sd]?/fix(es|ed)?/resolve[sd]?\s+#\d+` outside fenced and
  inline code spans, exempting only a line whose entire content is a
  standalone closing directive — `Closes #<N>`, the pipeline's body convention,
  optionally behind a conventional-commit type (`fix: Resolve #<N>`). A match
  anywhere else fails the check — including a correct reference to the right
  issue, if it is not written as one of those two shapes, because the incidents
  were never about the wrong number, they were about the phrase appearing where
  a reader parses it as prose rather than as a deliberate directive.

  **The title shape had to be admitted, and the omission cost a pull request.**
  The guard shipped while `open-pr` was required to write exactly
  `<type>: Resolve #<N>` as the PR title, so the two landed in direct
  contradiction: PR #773 — the first pipeline PR opened after the guard merged —
  failed this check on its own mandated title, and every pipeline PR after it
  would have failed the same way. A guard that rejects the convention it ships
  beside does not harden the pipeline, it stops it.

  **Admitting the shape cost the titles.** The exemption is a whole-line match,
  so the one title the pipeline could write was the bare directive, and every
  pipeline PR from #773 to #980 read `fix: Resolve #<N>` — the descriptive half
  the titles carried through #616 (`feat: Resolve #554 — charging is real work,
  a blaster loads holes one at a time`) was gone from `git log`. `open-pr` now
  writes `<type>: <summary> (#<N>)`: the directive lives only in the body's
  `Closes #<N>` line, which is what closes the issue at merge, and the title
  carries no closing keyword at all, so the guard has nothing to admit. The
  typed-directive exemption stays in `SANCTIONED_LINE_RE` for the pull requests
  already opened under the old title and for a hand-written directive title;
  what it never admits is unchanged — a directive with prose after it on the
  same line.

  No branch protection rule was added for this check, on the grounds that
  `agentic-auto-merge` and `scripts/await-pr-ci.ts` already read every workflow
  run on a PR's head and treat any reported failure as red. **Half of that was
  untrue when it was written.** `await-pr-ci` excluded merge machinery by a
  `^agentic-` filename prefix, so this guard — named
  `agentic-closing-keyword-guard.yml` — exempted itself from the verdict by its
  own name, and #773's session read GREEN over a failing check. Both readers now
  decide by a named list rather than a prefix, and an unrecognised workflow
  counts as a channel. See "A red CI is nobody's report" in `github-loop.md`.

#### Manual defense in depth

The guard above is what actually stops a fifth exhibit; the checklist below is
what to do by hand in the rare case something reaches the base branch outside
a pull request the guard could see (a direct push, a squash performed outside
the pipeline's own tooling). Never let a closing keyword sit immediately
before a bare `#<number>` anywhere it could end up in the base branch's
history — a PR body, a commit message, or a squash-merge message that
concatenates one — regardless of grammar:

- Rephrase so the keyword and the number are not adjacent, in every commit message as much as the PR body.
- If the literal phrase must appear — quoting another PR, demonstrating the pattern — wrap the whole keyword-plus-number phrase in one code span or fenced block, in the commit message too, not only where it is later quoted.
- After a squash merge, reset the working branch to the new base rather than merging the base back in. A merge keeps the branch's own pre-squash commits reachable by their original SHA, and anything already landed can ride into the next PR's commit range as if it were new — carrying a stale, already-corrected commit message right back into the next squash commit.

Before submitting a PR that discusses any numbered issue, reread every commit message in its range and the PR body once, hunting for the literal shape — keyword, then `#`, then digits — the same way the parser will, not for what the sentence means.

## github-loop.md — Four ways in, and nothing else

Before the third and fourth entries existed: with only the first two entries, every failure parked the pipeline until a human dispatched the trigger, which on a repository with nobody watching means until somebody noticed.

**The fourth closed the last hole in it**, and it stayed open far longer because the state it covers looks like success. Three of the four terminal states had a subscriber and the fourth had none, and every document in this tree said there were three ways in — so nothing read as broken. On 28 Aug 2026 issue #557 ended `blocked` and chained correctly to #807; #807's run filed twelve follow-up issues, closed itself `done` at 19:41:07, and the pipeline stopped with 23 `ready` issues queued behind it. `agentic-assign` had carried the `closed_without_pr` guard for this case since it was written, and had never had a caller.

## github-loop.md — Two rules keep the loop alive

An issue the agent closes without opening a PR raises no `pull_request` event, so the merge chain cannot carry it. The runners used to carry their own step for that case; it was removed, and correctly — a run starting the next run is the pipeline deciding to run again on its own. What was missing was the other half: with the runner's step gone and nothing put in its place, the state had no subscriber at all and the queue went idle every time a run delivered something other than a diff. `agentic-chain-on-close.yml` is that half.

## github-loop.md — How many runs at once

The default of 1 is single flight exactly as the pipeline ran before `AGENTIC_MAX_PARALLEL_RUNS` existed.

Scope is a throughput hint: over 384 merged pipeline PRs, two adjacent ones shared a file 36% of the time; pairs whose `src/` scopes were disjoint still did 7% of the time.

`src/ui` was split into six areas and the simulation core into four because each in turn carried more than half the backlog. `src/core/mining` was split three ways because, as one `scope:nav` with pathfinding, it carried six of eleven `ready` issues on 20 Oct 2026, four kept waiting on a live run they shared no file with.

A live run carrying no scope, or an unknown one, is a run assigned before scopes existed.

Holds: on 5 Oct 2026 #1403 (`console`, `hud`, `engine`) holding all three of its scopes kept nine `console`/`hud` issues behind a run they had nothing to do with — hence a wide claim holds only its wide part. On 5 Oct 2026 #1380 (`engine`, `world`) waiting on live #1379 held `world`, and #1466, touching only `world`, could not start — hence an ordinary claim waits without holding. A hold is one level deep because on 4 Oct 2026 chained holds through multi-scope issues covered every scope from a single live run.

`agentic-assign` used to comment "Pipeline halted — no linked PR was created" on sight, which it posted on #404 while that run was one minute into a two-hour session.

A run whose name carries no identity includes a run from before `run-name` existed. "Is a session live on this issue" used to be "is any runner run live".

Before #572/#610, *every* such run still claimed the shared group on its way to resolving `if:` false, so a burst of irrelevant comments (a session's own trailing wrap-up comment among them) could drop a real, already-queued assignment before its job ever started.

#614 is what checking only `queued`/`in_progress` costs: a real, correctly-queued run came back `pending`, the narrower check missed it, and the issue was labelled `blocked` 21 seconds into a session that went on to open its PR. The unfiltered listing was added for a seconds-old run (#1136).

## github-loop.md — Halt conditions

The handover PR rule: #730's did, on 25 Aug 2026: its handover PR #740 also carried `Closes #758` for a defect the same run had fixed in passing, so #758's assignment was answered with #730's handover and told, in the assignment's own words, that "a previous run on this issue" had left work on `pipeline/feature-730-32642264036`. That run finished on #730's branch, took `paused` off #740 and marked it ready — and #730, its carve-out gone, was skipped by every assignment afterwards with "pull request #740 is already open against it" while the queue took another issue and nothing reported it. `resumeTargetFor` was then narrowed to the head-matched `pipeline` entry.

## github-loop.md — The run is retried before it is written off

Every early-ending session wastes a whole assignment and, before the retry existed, a whole day — #404 waited four hours for a watchdog sweep, and #406 sat `in-progress` after dying in 58 seconds.

Per-step timeouts: Runs 565, 591, 606 and 609 (#921, #947, #953, #956) ended on the job clock with neither the retry nor the rescue, because a cancelled job skips the retry gate and gives the rescue seconds.

## github-loop.md — Rescue: a run that ends early must not end silently

Issue #707 is the case for checking the exemption before anything is said: its run reported an unrunnable channel, filed the defect behind it, and escalated exactly as the skill asks, and the rescue step still commented that it had "concluded that no code change was needed without saying so", one comment under where it said so.

Issue #2045 is the case for rescuing a resumed handover: its resume run hit the step timeout on PR #2065, the rescue read the old PR as a finished run, and the watchdog skipped the issue for the same PR, so `in-progress` held the only slot with no run behind it.

## github-loop.md — The cascade brake

The risk of a runaway chain is why the chain from a halt did not exist before.

## github-loop.md — What may be assigned

Open PR rule: #567's own body cites half the backlog, and under a mention predicate that one PR froze it.

Closed dependency with an open PR: the headline case — issue #547 with PR #566.

Unreadable dependency: a typo in a `Blocked by` line used to read as "no dependency" and start the run anyway.

Unread pull requests: before the retry and REST fallback, an unread state meant *one thing* answered badly rather than *nothing* answered.

## github-loop.md — Where a dependency comes from

The body section is kept because every issue written before relationships existed carries its dependencies there and nowhere else. Dropping it the moment relationships arrived would make that entire backlog instantly assignable — a regression in the property the relationships are being adopted for.

## github-loop.md — What counts as an issue's pull request

A timeline cross-reference counts for nothing: any PR that merely writes `#N` in prose raises one, which is how docs PR #561's passing mention of #547 read as run #133's deliverable and disarmed its retry with five hours of budget left.

The keyword fallback is what keeps the closers arm from being the mention predicate #568 removed. On 17 Aug 2026 `closedByPullRequestsReferences` answered 503 for every candidate, three dispatches of `agentic-trigger.yml` in a row skipped the entire `ready` queue, and issue #554 sat unassigned behind three green runs.

Undeclared coupling: comparing an issue's `## Files` list against the files an open pipeline PR touches was considered and rejected. Measured again for parallel runs, 36% of adjacent pipeline PRs share a file, most of them in files that merge cleanly.

## github-loop.md — Repository variables

`AGENTIC_CI_FIX_ENABLED` off leaves a red CI reporting to nobody — the state PR #581 was left in.

## github-loop.md — The merge gate

Green alone was the rule while only one session ran and `main` moved only through that session's own merge.

The lock is job-level because a workflow-level group would repeat #572/#610's eviction, in another group.

The CI-success wake: PR #499 was verified, marked and green, and sat open for want of this trigger.

The marker decides: PR #430 sat open as a `github-actions[bot]` PR, fully verified and marked, with zero checks, holding its issue and the queue behind it.

Before the gate, three places could merge a pipeline PR — the runner that opened it, `auto-assign-next.yml` on the PR's own events, and the CI-completion sweep — each on one PR's head alone. The runners no longer carry an arming step. GitHub native auto-merge, on this repository with no required checks, was always refused (`Pull request is in unstable status`) and every merge already happened inside the action. PR #434 is the other reason it is gone: the `enablePullRequestAutoMerge` mutation named its variable `$method`, which @octokit/graphql rejects before the request leaves the runner, and both arming paths threw on every call and reported success.

What fails the step: a run-level success hiding a required job that never ran is #615. PRs #507 and #508 were opened as non-draft unmarked pipeline PRs, each promising `READY TO MERGE` "once the CI jobs report", and with no step anywhere coming back to write it they held their issues indefinitely.

## github-loop.md — A red CI is nobody's report

Every path ended at a merge or at `blocked`. There was a third ending nothing owned: the pull request opened, marked, and its CI came back red. PR #581 sat there — green on every channel its own session ran, two interaction-mode shards red in CI — holding issue #552 `in-progress` with the whole queue behind it, until a human noticed.

The merge gate's handback reaches PR #773's `closing-keyword-guard` red, with `ci.yml` itself green.

Branch family suffix: since #554 every branch a run creates carries its run id, and the fail-safe's pattern was anchored without it, so it matched **no branch any run actually pushes**. The whole fail-safe was dead code from that day until PR #773, silently.

**A red check is not always CI's.** PR #773 ended with `ci.yml` green on every job and the pull request still `unstable`: `agentic-closing-keyword-guard.yml` (#765) had failed on the PR title. Each reader missed it for its own reason, and each reason was the same shape — a scope narrowed to a name.

- `[await-ci]` filtered the machinery out of its verdict by a `^agentic-` **prefix**, so the guard exempted itself from the channels by being called `agentic-closing-keyword-guard.yml`. The session waited the full fourteen minutes, read GREEN, and ended having done exactly what it was told. That filter became a named list.
- The fail-safe fired on `workflow_run` for `"CI"` and, on dispatch, used to look up `ci.yml` by path — so a failure from any other workflow raised no event and, once asked, found nothing to hand back.
- `agentic-auto-merge` was the one reader that got it right: it read every run, refused to merge, and said so by failing its own job — which is announced to nobody. The gate then started dispatching the fail-safe for every marked PR that is red or conflicting.

Conflict handback: before the gate, nothing handed a conflicting PR to anyone.

## runtime-parity.md — Where a shared instruction stops being enough

Issue #404 died on the delegation-default gap: the orchestrator ended its turn with `Waiting for completion notifications`, the process exited, and 2h08 of finished work went with the runner — TDD complete, validation complete, `pipeline/feature-404` never pushed, no PR.

The guard first shipped declared in the orchestrator's own frontmatter, and it never fired once. Issue #406 then repeated #404 exactly — planner launched in the background, turn ended, `num_turns: 0`, nothing on the remote — 58 seconds into a run, with the guard sitting inert in a file that passed `validate:context`. `validate:context` was then extended to check the registration, not only the file.

## runtime-parity.md — Claude Code prerequisites

Hooks run on every OS: the shell versions these replaced degraded silently on Windows: they needed Git Bash plus python3, failed open without it, and the stop guard's Python liveness probe, `os.kill(pid, 0)`, is TerminateProcess there — it killed the long run it was checking.
