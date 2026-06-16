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
                            Assign issue-number = single GitHub issue for all sections.
 2. [plan-all]            → (orchestrator) Create a TODO list with all sections.
                            Share with user: "Section 1 → Section 2 → ... → Section N. Single PR."
 3. For each section K in [1..N]:
       TDD cycle via `agentic-pipeline-tdd` with label = <issue-number>-section-<K>.
       EXCEPT:
       - Section 1 creates pipeline/feature-<issue-number> (shared across all sections)
       - Sections 2..N cherry-pick onto the EXISTING pipeline/feature-<issue-number>
       - [test-runner] runs after EACH section (catch regressions early)
       - If test-runner fails → @fixer → re-run test-runner (tight loop, max 7 retries)
       - If cherry-pick conflicts → @conflict-resolver → retry cherry-pick
 4. After ALL sections merged:
       [qualimetry]              → jscpd syntactic duplication check
                                   if fail → @implementer → re-run affected section's TDD
       [finalization]            → Delegate to `agentic-pipeline-finalization` skill
```

### Branch Strategy

```
main
 └─ pipeline/tests-<N>-section-1   (stubs + tests)
 │    └─ pipeline/impl-<N>-section-1  (implementer)
 └─ pipeline/tests-<N>-section-2   (stubs + tests)
 │    └─ pipeline/impl-<N>-section-2  (implementer)
 └─ pipeline/feature-<N>           (accumulated — ALL sections cherry-picked here)
      └─ qualimetry → finalization → PR to main
```

Each section preserves branch isolation. Feature branch accumulates all changes. Single PR at the end.

### Rules

- Section 1 creates pipeline/feature-<N>. Sections 2..N cherry-pick onto existing branch.
- Test-runner runs after every section to catch cross-section regressions early.
- Qualimetry and finalization run once, after all sections merged.
- Total retries per pipeline phase: max 7 before human escalation.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| decompose | Manual — orchestrator splits prompt |
| plan-all | Orchestrator creates TODO list |
| test-runner | `npx vitest run` — route to @fixer on fail |
| qualimetry | `npx jscpd src/ tests/` — route to @implementer on fail |
