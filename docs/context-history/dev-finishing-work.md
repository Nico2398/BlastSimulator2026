# History — dev-finishing-work

This file records why the rules in the `dev-finishing-work` skill exist.

## Which channels you run, which CI runs

The ~6 s per-frame software-rasterisation cost of the terrain material without a GPU was measured in #475. The simulation was ruled out as the cost: turning ticking off changes the frame by 1.7%.

## ▶ Reading the CI result

Two pull requests paid for this rule:

| PR | What the session did | Cost |
|----|----------------------|------|
| #581 | Green on every channel it ran locally, marked `READY TO MERGE`, ended. | Two interaction shards red. Issue #552 held the queue until a human looked. |
| #888 | Opened the PR, labelled it, read `mergeable_state: "unstable"`, called it settling, reported success. | One interaction shard red — on the run's own new scenario. Found only because a human asked. |

## ▶ Driving a red CI green

PR #888's own new scenario asserted a scroll position immediately after dispatching a wheel event — `page.mouse.wheel()` resolving does not mean Chrome has committed the scroll, since it can land on the compositor thread after the CDP call returns. It passed every local run and failed CI reproducibly.
