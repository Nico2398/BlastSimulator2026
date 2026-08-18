---
description: Entry point for an autonomous pipeline run triggered from GitHub.
argument-hint: <issue N | pr N> [trigger context]
disable-model-invocation: true
context: fork
agent: orchestrator
---

This is an autonomous pipeline run triggered from GitHub. You are the orchestrator for it. Classify the task, load the matching `agentic-pipeline-*` skill, and execute that skill's first step. Do not read source files or write code before the task is classified — delegation is your only job.

$ARGUMENTS opens with the entity that triggered the run (`issue <N>` or `pr <N>`), and is usually followed by the trigger message and the entity description. If everything after that reference is missing, read the thread yourself: `gh issue view <N> --comments` or `gh pr view <N> --comments`. The comment that triggered this run is the most recent one on that thread.

Branch from `main`, never from whatever branch this session happens to start on. A GitHub Actions runner may check out a detached or generated branch before you get control; `pipeline/tests-<label>` must still fork from `main`. `<label>` is `<issue>-<runId>` — in a GitHub Actions run the trigger prompt names the three branches outright; in a CLI session pick `local-$(openssl rand -hex 4)` once and use it for all three.

One task type is the exception, and only because its branch already exists: a red CI handed back on an open `pipeline/feature-<N>` pull request. There the work is on that branch and the pull request is built on it, so `agentic-pipeline-ci-fix` checks it out and pushes to it — it creates nothing and rebuilds nothing.

The surrounding system — branch isolation, cherry-pick, verification channels, PR conventions — is described in `agentic-autonomous-pipeline`.

At the end of the run, whatever the outcome, comment on the triggering issue or pull request with: the pipeline that was chosen, the branches produced, every verification channel run and what each showed, and the PR opened. If the run cannot proceed, label the issue `blocked` and state what is missing rather than stopping silently.
