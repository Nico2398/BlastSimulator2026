# History — agentic-pipeline-finalization

This file records why the rules in the `agentic-pipeline-finalization` skill exist: the runs and pull requests behind them.

## ▶ The filing gate — what a register entry becomes

The register drained without this gate is a generator rather than a backlog. A reviewer audits every pull request the pipeline merges, so entries scale with the pipeline's own output and not with any fixed stock of debt. One stretch ran at 0.99 filed issues per run — one new issue for every issue closed — with half of every merged pull request resolving an issue the pipeline had filed for itself, finding-chains seven generations deep from a single human task, and the median finding pointing at code merged two issue numbers earlier. The queue never grew; its contents were replaced, while the two human-authored gameplay issues in it went untouched. The gate protects the throughput, not the issue count.

## The CI-fix round — a red channel this run handed to CI is still this run's

Ending at open-pr is what PR #581 did: green on every channel its session ran, marked `READY TO MERGE`, two interaction shards red in CI, and `agentic-auto-merge.yml` skips a failed CI run by design. Nothing merged it, nothing chained, and issue #552 held `in-progress` with the whole queue behind it.

#581's session proved a local run of those exact interaction-mode files times out on load contention.

Three rounds used to be allowed here. #947's run opened its PR four hours and twenty minutes in, then spent its last ninety-eight minutes on two of them — each push cancelling a twenty-minute CI run and starting another — and the job clock cut it off waiting on the third; the ci-fix session that took the handback the next morning turned the same PR green in a hundred and thirty minutes.

## Steps in detail

### open-pr

The `<summary>` is the descriptive half of the title pipeline PRs carried through #616 (`feat: Resolve #554 — charging is real work, a blaster loads holes one at a time`), e.g. `feat: charging is real work, a blaster loads holes one at a time (#554)`. The bare `<type>: Resolve #<N>` is what every pipeline PR from #773 to #980 read.

The closing-keyword title rule was cited to `keyword-closing-postmortem.md`.

A label added after `create` raises no `pull_request` event of its own, which is how PR #615 merged with its interaction-mode job silently skipped back when a label gated it; the job runs unconditionally now, and the opening-call rule stands for `paused`.

### await-ci

`ci:await` listens to every workflow run on the PR head, not `ci.yml` alone: PR #773's blocking check was the closing-keyword guard, with CI green.
