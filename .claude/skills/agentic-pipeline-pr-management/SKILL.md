---
name: agentic-pipeline-pr-management
description: >
  PR status, draft vs ready-to-merge logic, READY TO MERGE convention, and
  [skip ci] rules for pipeline-generated PRs. Referenced by the orchestrator
  before open-pr step.
---

## PR Status — Self-Evaluation

Before open-pr step, evaluate: **is this PR ready to merge or should it be a draft?**

**Verification decides, and nothing else.** A PR is `ready` when every verification channel the change owes reports PASS. Ask one question per channel the change touches — static, logic, scenario, visual — and one question about the issue's own verification list. All PASS → `ready`.

A PR is `draft` in exactly three cases:

| Draft because | Shape |
|---------------|-------|
| A required channel could not run | `VISUAL: BLOCKED` — no browser, dev server unreachable, screenshots never written. The work may be right; nothing can prove it. |
| A required channel is red and stayed red | The pipeline exhausted its retries against a genuine failure |
| A genuine blocker was hit | One of the five in `agentic-decision-autonomy` — contradictory requirements, missing external dependency, capability gap, unrunnable channel, irreversible action |

| Evaluation | Behavior |
|------------|----------|
| `ready` (default) | PR created as normal, `READY TO MERGE` in body triggers auto-merge |
| `draft` | PR created with `--draft` flag, `READY TO MERGE` NOT included |

The open-pr step passes `--draft` to `gh pr create` when evaluation is `draft`.

"Could not run" means **nothing will ever report on it** — not that this session did not run it. A channel CI owns is not a draft case; see below.

**These never make a PR a draft:** iteration counts of any kind (visual loop rounds, implementer do-overs, review findings addressed, cherry-pick retries), a fix that reached beyond the issue's framing, or a requirement the run had to default. Churn measures how hard the problem was. The channels measure whether the answer is right — see `agentic-decision-autonomy`.

## READY TO MERGE

The line goes into the body the PR is **created with** — the last line of `gh pr create --body` at the open-pr step, written in the same command that opens the PR. It is never a later edit, and there is no step after open-pr that adds it. `READY TO MERGE` sits on its own line with nothing else on it. That line is the only thing that puts a PR into auto-merge: the `agentic-auto-merge` action reads it, releases any workflow run parked as `action_required` on the PR head, and enables GitHub native auto-merge via a PAT token. The account that opened the PR is never consulted — see `agentic-autonomous-pipeline`.

This is the **default**, skipped only in the three draft cases above. When skipping, post a comment naming the channel or blocker and the remedy — never a summary of how much work the run took:

```
gh pr comment <pr-url> --body "READY TO MERGE skipped — <channel or blocker>: <what fails, what would unblock it>"
```

A run that defaulted an open requirement keeps `READY TO MERGE` and records the choice in the PR body under `## Decisions taken`, per `agentic-decision-autonomy`.

### The marker is not a report that CI went green

`READY TO MERGE` says **this run has nothing left to add**. It never says every check has already reported, and it is never withheld to wait for one.

A marked PR whose runs are still going is the ordinary state of a PR the pipeline just opened. `agentic-auto-merge` reads it as `pending`, logs which runs it is waiting on, and stops — and the CI-completion sweep re-evaluates it when they report: green merges it, red fails the sweep step naming the PR. Marking is what hands the PR to that machinery. Withholding the marker takes it away.

So a channel this session cannot run but CI does — interaction-mode `visual`/`scenario` — is **covered**, and the PR ships marked; when the change earns the `full-ci` label below, that job is what reports on it. Only a channel no mechanism will ever report on is a draft case.

**There is no third state.** Every pipeline PR leaves the run either marked or `--draft`. A non-draft PR carrying no marker is invisible to the entire loop: `agentic-auto-merge` skips it, `auto-assign-next` chains from a merge that never happens, and the watchdog skips any issue that has a linked PR — so the issue holds `in-progress` and every assignment behind it waits until a human notices. PRs #507 and #508 both ended exactly there, both promising the marker "will follow once those jobs report". Nothing comes back to add it; the only session that could have is over. `agentic-auto-merge` now fails its step on a non-draft `pipeline/feature-*` PR with no marker, so the state is loud instead of silent — but the run must not create it in the first place.

## The `full-ci` label

`full-ci` starts the `Scenarios (interaction mode)` browser job — sharded via the repo variable `SCENARIO_INTERACTION_SHARDS` (a JSON array like `[1,2,3,4]`), defaulting to 4 shards as of #530, each shard driving roughly 127/N of the scenarios; the terrain material still costs ~6.4 s/frame without a GPU (#475), so the job remains real added time to the merge path even sharded. #530 also cut the harness's own overhead by ~30% (measured 3367s -> ~2350s, single-threaded, in a sandbox) and, confirmed on #530's own PR checks, brings the sharded job to ~12 minutes wall clock at 4 shards — of each shard's ~11-12 min, ~30s is fixed per-job setup (checkout, install, Chrome, build, dev-server boot) that does not shrink with more shards, the rest is the harness's own batch time, which scales down roughly with shard count. Treat it as costly, not as free just because it is parallelised; apply it where there is evidence to buy:

| Apply because | Test |
|---------------|------|
| The issue carried it | The label transfers from issue to PR — `agentic-issue-creation` |
| An interaction-mode scenario drives the change | `scripts/scenario-defs/` holds the whole click-only, `role`-tagged suite (issue #515). Read the scenario: does one click its way through the control, panel or flow this diff changes? |
| Every scenario runs through what changed | Shared rendering, input, camera, picking, or the scenario harness itself — machinery no single scenario names and all of them exercise |

Otherwise the label pays real added CI time to replay flows the diff never touched. A control added to an existing panel, a setup form's field list, copy, a renderer detail no scenario reaches — the `visual` channel already covers those, run in this session against the one named scenario that exercises them, and that is the stronger evidence because it looks at the thing that changed.

**When player-reachability is owed and no scenario drives the flow**, the label is not the answer — running scenarios that never reach the change reports nothing about it. Say so in the PR body, naming the flow and what does cover it. A goal-reaching flow worth pinning earns a new `role: 'player'` step in `scripts/scenario-defs/` (and then the label, so CI runs it in interaction mode); a control on an existing panel is covered by the `visual` channel and needs neither.

Labelling is a claim about which machine runs a channel. It is never a reason to withhold the marker, and never a substitute for the visual channel.

## Critical: NEVER use `[skip ci]` on PR branches

`auto-assign-next.yml` (triggered on `pull_request: [synchronize]`) re-arms auto-merge when the marker arrives after the PR did. **Any commit with `[skip ci]` on a PR branch prevents that workflow from triggering.** It also suppresses the CI run auto-merge is waiting on, which nothing downstream can substitute for: the PR then sits armed and unmergeable until a human intervenes.

Rules:
- **NEVER** include `[skip ci]` in any commit message on `pipeline/feature-*` branches
- The `verify-commit` auto-commit message must NOT contain `[skip ci]`
