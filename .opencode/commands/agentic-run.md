---
description: Entry point for an autonomous pipeline run triggered from GitHub.
agent: orchestrator
---

This is an autonomous pipeline run triggered from GitHub. You are the orchestrator for it. Classify the task, load the matching `agentic-pipeline-*` skill, and execute that skill's first step. Do not read source files or write code before the task is classified — delegation is your only job.

$ARGUMENTS opens with the entity that triggered the run (`issue <N>` or `pr <N>`), and is usually followed by the trigger message and the entity description. If everything after that reference is missing, read the thread yourself: `gh issue view <N> --comments` or `gh pr view <N> --comments`. The comment that triggered this run is the most recent one on that thread.

Branch from `main`, never from whatever branch this session happens to start on. A GitHub Actions runner may check out a detached or generated branch before you get control; `pipeline/tests-<label>` must still fork from `main`. `<label>` is `<issue>-<runId>` — in a GitHub Actions run the trigger prompt names the three branches outright; in a CLI session pick `local-$(openssl rand -hex 4)` once and use it for all three.

Two task types are the exception, and only because their branch already exists. A red CI handed back on an open `pipeline/feature-<N>` pull request: the work is on that branch and the pull request is built on it, so `agentic-pipeline-ci-fix` checks it out and pushes to it — it creates nothing and rebuilds nothing. And a **resumed run**: when the assignment comment names a pull request labelled `paused`, an earlier run stopped on a dependency that has since landed and left its finished work on that branch. Check it out and continue there — creating a fresh `pipeline/feature-<label>` from `main` discards every commit the pause saved, and opening a second pull request against the issue makes it unassignable to everyone. `agentic-autonomous-pipeline` holds the rest of the resume rules.

The surrounding system — branch isolation, cherry-pick, verification channels, PR conventions — is described in `agentic-autonomous-pipeline`.

At the end of the run, whatever the outcome, comment on the triggering issue or pull request with: the pipeline that was chosen, the branches produced, every verification channel run and what each showed, and the PR opened.

If something gets in the way, do not reach for `blocked` first. Fix it if it is small, bypass it behind a `TODO(#N)` if the task can still be delivered around it, and **pause** if it cannot — file the blocker, set it as this issue's `Blocked by`, put `ready` and `paused` back on the issue, and hand over whatever you finished on a draft PR labelled `paused`. `blocked` is only for a question a human has to answer. All four procedures are in `agentic-decision-autonomy`. Never stop silently, whichever you take.
