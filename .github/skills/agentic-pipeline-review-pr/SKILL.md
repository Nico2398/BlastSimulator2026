---
name: agentic-pipeline-review-pr
description: >
  Review-PR pipeline: the lead checks out the PR and runs the channels it owes,
  one independent reviewer applies the sections the diff owes, the lead posts a
  single review and files the out-of-scope findings. Also defines the
  fix / file / drop disposition every review finding gets.
---

## ▶ PROCEDURE — EXECUTE IN ORDER

| Step | Who | Action |
|------|-----|--------|
| 1 | [checkout] | `git fetch origin pull/<N>/head:pipeline/review-<N>-<runId> && git checkout pipeline/review-<N>-<runId>` |
| 2 | [verify] | `npm run long -- start verify -- npm run pipeline -- verify`, then `npm run long -- wait verify` until FINISHED |
| 3 | @reviewer | Brief: PR number, the issue it closes, "no plan — the PR body stands in for it", and the `verify` verdict |
| 4 | [disposition] | The lead gives each finding a disposition (below) |
| 5 | [post] | One `gh pr comment <N> --body-file <review>`: the verdict, the channels, the findings with their dispositions |
| 6 | [followup] | File the findings dispositioned `file` per `agentic-issue-creation`, then one comment listing them, in the format `agentic-pipeline-finalization` gives. None → skip |

One reviewer, not a panel. `review-brief` tells it which sections the diff owes, and the channels have already answered everything mechanical — types, tests, scenarios, duplication, locale parity — so it spends its reading on judgment. A PR the lead did not write needs no second reader: the reviewer is already independent of its author.

### Rules

- **No branch work.** This pipeline reads; it commits nothing and pushes nothing.
- **A reviewer reports a finding; it never files one.** Mutating `gh` is blocked for it by design. The lead files, after the disposition, so one finding is never filed twice under two names.
- Never post a comment containing `@claude` or `@opencode` — it would wake another session on the PR.

### Finding disposition

Every finding gets exactly one disposition, decided once the whole report is in:

| Disposition | When | What happens |
|-------------|------|--------------|
| `fix` | The finding is inside what this PR changed or broke | Fixed on this branch before the PR is marked — or, reviewing someone else's PR, named in the review as blocking |
| `file` | Real but outside this PR's scope — pre-existing debt, a gap the diff merely revealed | Carried to `[followup]`, subject to `agentic-pipeline-finalization`'s filing gate |
| `drop` | A duplicate, or contradicted by the code | Nothing, beyond saying so in the review |

`file` is not a softer `fix`. A finding inside the diff is this run's work whatever it costs; a finding outside it stays outside, because widening a PR to chase debt is how a reviewed change becomes an unreviewable one.

### Review output

```
## Review Complete
- Channels: <one line per channel verify ran>
- Verdict: APPROVE / REQUEST CHANGES
- Findings: <file:line — what — severity — disposition>, one per line
- Filed as follow-ups: #N, #M (or `none`)
```
