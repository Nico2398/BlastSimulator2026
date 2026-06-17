---
name: agentic-pipeline-multi
description: >
  Multi-pipeline for complex/mixed prompts. Decomposes a prompt with multiple
  task types (feature + fix-bug + visual-change) into sequential sections,
  each running `agentic-pipeline-tdd`. All sections merge into a single PR
  via `agentic-pipeline-finalization`.
---

## Multi-Pipeline

Use when the prompt mixes multiple task types.

```
 1. [decompose]           → (orchestrator) Split prompt into N sections.
                            Each section = { id, title, task_type, description, acceptance_criteria }
                            Supported task_types: feature, fix-bug, full, ask, executor, review-pr
                            Assign issue-number = single GitHub issue for all sections.
  2. [plan-all]            → (orchestrator) Create a TODO list with all sections.
                             Report to invoker: "Section 1 → Section 2 → ... → Section N. Single PR."
  3. For each section K in [1..N]:
         Route by task_type:
         - Code-producing (feature, fix-bug, full) → `agentic-pipeline-tdd` with
             label = <issue-number>-section-<K>,
             base_branch = (K=1 ? `main` : `pipeline/feature-<issue-number>`)
         - Ask  → `agentic-pipeline-ask`
         - Executor → `agentic-pipeline-executor`
         - Review-pr → `agentic-pipeline-review-pr`

         For code-producing sections:
         - Section 1 creates pipeline/feature-<issue-number> (shared across all sections)
         - Sections 2..N cherry-pick onto the EXISTING pipeline/feature-<issue-number>
         - [test-runner] runs after EACH code-producing section (catch regressions early)
         - If test-runner fails → @fixer → re-run test-runner (tight loop, max 7 retries)
         - If cherry-pick conflicts → @conflict-resolver → retry cherry-pick (max 3 retries)

         For non-code sections:
         - No branch creation, no cherry-pick, no test-runner
         - Results captured and included in final PR description
   4. After ALL sections merged:
          [qualimetry]              → jscpd syntactic duplication check
                                      if fail → @implementer → re-run affected section
          [finalization]            → Delegate to `agentic-pipeline-finalization` skill
          @maintainer               → Context maintainer check
                                      Validate context files against `agentic-context-edition` skill.
                                      Report only — never modifies files.
```

### Branch Strategy

```
main
 └─ pipeline/tests-<N>-section-1   (stubs + tests, forked from main)
 │    └─ pipeline/impl-<N>-section-1  (implementer)
 └─ pipeline/tests-<N>-section-2   (stubs + tests, forked from pipeline/feature-<N>)
 │    └─ pipeline/impl-<N>-section-2  (implementer)
 └─ pipeline/feature-<N>           (accumulated — ALL sections cherry-picked here)
      └─ qualimetry → finalization → PR to main
```

Each section preserves branch isolation. Feature branch accumulates all changes. Single PR at the end.

### Rules

- Section 1 creates pipeline/feature-<N> with base_branch=main. Sections 2..N use base_branch=pipeline/feature-<N> (includes prior sections' code).
- Test-runner runs after every section to catch cross-section regressions early.
- Qualimetry and finalization run once, after all sections merged.
- Each section has its own retry budget (max 7 failures before escalation). One section's flakiness doesn't affect another's budget.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| decompose | Manual — orchestrator splits prompt |
| plan-all | Orchestrator creates TODO list |
| test-runner | `npx vitest run` — route to @fixer on fail |
| qualimetry | `npx jscpd --gitOnly src/ tests/` (changed files only) — route to @implementer on fail |
