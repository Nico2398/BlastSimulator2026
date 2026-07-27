---
agent: orchestrator
description: Entry point for an autonomous pipeline run triggered from GitHub.
argument-hint: "<trigger context>"
---

This is an autonomous pipeline run triggered from GitHub. It must execute as the TDD pipeline orchestrator, not as an ad-hoc coding session.

▶ FIRST ACTION — run as the orchestrator. If this session is already the orchestrator agent, continue. If it is not, delegate the whole task to the `pipeline` orchestrator agent now and pass the trigger context to it verbatim. Do not read source files, plan, or write code before the orchestrator has classified the task.

The trigger context is $ARGUMENTS — the issue or pull request number, the message that triggered the run, and the description of that issue or pull request. If it is empty, the trigger context appears elsewhere in this prompt; read it from there.

The orchestrator classifies the task, loads the matching `agentic-pipeline-*` skill, and executes that skill's first step immediately. The surrounding system — branch isolation, cherry-pick, verification channels, PR conventions — is described in `agentic-autonomous-pipeline`.

At the end of the run, whatever the outcome, comment on the triggering issue or pull request with: the pipeline that was chosen, the branches produced, every verification channel run and what each showed, and the PR opened. If the run cannot proceed, label the issue `blocked` and state what is missing rather than stopping silently.
