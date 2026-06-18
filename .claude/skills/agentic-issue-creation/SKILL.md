---
name: agentic-issue-creation
description: Create GitHub issues formatted for agentic pipeline consumption with complete context, files, test files, dependencies, and verification criteria. Use when creating issues for autonomous coding agents.
---

# Skill: agentic-issue-creation

## When to Use

Use when creating GitHub issues that will be picked up by autonomous coding agents (pipeline orchestrator + sub-agents). Every issue must be self-contained — the agent has no prior context beyond what's in the issue body.

## Issue Body Template

```markdown
## Context
[Why this task exists. What larger feature it's part of. Where it fits in the implementation sequence.]

## Files
- `path/to/file.ts` — create | modify — [specific change description]

## Test
- `path/to/test.ts` — create | modify — [what test should verify]

## Blocked by
- #N (backlog-id) — [what must be completed first]

## Conventions
- [Any specific patterns, imports, naming, or code style to follow]

## Verification
- [Specific verifiable condition. Use commands like "Run `npm test` to verify"]
```

## Rules

1. **Every field in the template is required.** An agent with zero context must be able to start from the issue alone.
2. **File paths must be exact** — relative to workspace root, forward slashes.
3. **Dependencies reference GitHub issue numbers** in the `Blocked by` section (e.g., "#302 — level definition must exist first").
4. **Verification must be concrete** — a command to run, a return value to check, a state to observe.
5. **Test files map to the test pyramid** (unit/integration/visual/scenario) per dev-testing-strategy.
6. **Do NOT include** implementation hints, solution approaches, or code snippets in the issue body — the agent must derive these from the codebase.
7. **Context section must explain the "why"** — what feature, what phase, what goal.
8. **Single task per issue.** If a task touches multiple concerns, split it.
9. **SMART compliance.** Every issue must be SMART: Specific (one clear goal), Measurable (verifiable outcome), Achievable (within agent's capabilities), Relevant (part of the larger feature), Time-bound (single atomic task, not open-ended).
10. **Labels required.** Every issue must have `agent-task` and `ready` labels applied via `gh issue edit <number> --add-label "agent-task" --add-label "ready"` after creation.

## Checklist

- [ ] Title starts with feature context ("Add tutorial level - ...")
- [ ] Context section explains larger feature and task's place in it
- [ ] Files section lists every file to create or modify
- [ ] Test section names the test file and what to verify
- [ ] Blocked by section references dependencies with issue numbers
- [ ] Verification section has concrete, testable criteria
- [ ] SMART criteria are respected (specific, measurable, achievable, relevant, time-bound)
- [ ] Labels `agent-task` and `ready` applied after creation

