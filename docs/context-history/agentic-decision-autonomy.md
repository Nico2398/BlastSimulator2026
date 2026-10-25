# History — agentic-decision-autonomy

This file records why the rules in the `agentic-decision-autonomy` skill and its `references/pausing.md` exist.

## ▶ Something in your way — try three things before you stop

The bypass example was written against issue #742: `// TODO(#742): SurveyPanel re-reads the grid on every tick. Cache once #742 lands.` (now shown with the `#N` placeholder).

## Churn is not a blocker

An earlier convention held a PR back for "significant churn". It cost a green, fully verified run its auto-merge and sent a human to re-review work that five specialist reviewers had already passed — while the issue stayed `in-progress` and the chain stalled behind it. Iteration count measures how hard the problem was, not how likely the answer is to be wrong.

## Event option comparison

The rule for balancing event options (no option of an event may dominate a sibling) comes from #1894.

## references/pausing.md — Steps

Step 2 (set it as your issue's dependency): forgetting the `blocked_by` relationship is no longer a silent gap, because `blockedByFor` reads the union of the relationship and the `## Blocked by` section — the section alone already holds the queue, which is exactly why the missing relationship used to go unnoticed (#1090, 16 Sep 2026). `handle-failure.yml`'s `reconcile-dependencies` job now derives the relationship from the section when the `paused` label lands.

Step 4 warning: if the blocker's own `## Blocked by` section contains prose that happens to name your paused issue's number — explaining *why* it was filed as a dependency, for instance — that prose used to be read as a declared dependency (not commentary), creating a mutual-blocking cycle neither issue could escape. `parseDependencies` now treats a section whose first non-empty line begins with `None` as declaring nothing, which closes that specific shape.
