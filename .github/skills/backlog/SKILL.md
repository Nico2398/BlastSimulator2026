---
name: backlog
description: >
  Backlog management for BlastSimulator2026: task list derived from NEXT_PHASE_DESIGN.md,
  CLI operations (list, next, start, done, block, reset, stats), pipeline integration rules,
  and blockedBy dependency ordering. Use any time you need to pick up, progress, or report
  on a task from the backlog.
---

## When to Load This Skill

Load when you need to:
- Identify what to work on next
- Claim task before starting any coding work
- Mark task done after merging PR
- Check what is blocked or in-progress

---

## Pipeline Integration

**Before starting any coding work:**
```bash
npx tsx .github/skills/backlog/backlog.ts next       # see what's next
npx tsx .github/skills/backlog/backlog.ts start <id> # claim it
```

**After the PR is merged:**
```bash
npx tsx .github/skills/backlog/backlog.ts done <id> --pr <number>
```

---

## Command Reference (Agent Script)

The agent script lives at `.github/skills/backlog/backlog.ts`.  
Output is intentionally terse and machine-readable (`key:value` per line).

| Command | Effect |
|---|---|
| `list` | Print all tasks, one per line |
| `list --status pending` | Filter to a specific status |
| `list --chapter 2` | Filter to a specific chapter |
| `next` | Print the next available `pending` task (respects `blockedBy` ordering) |
| `start <id>` | Set task to `in-progress` (fails if another task is already in-progress) |
| `done <id> [--pr <number>]` | Set task to `done`, record PR number |
| `block <id>` | Set task to `blocked` |
| `reset <id>` | Reset task to `pending` |
| `stats` | Print `done:N in-progress:N pending:N blocked:N total:N` |

**Usage:**
```bash
npx tsx .github/skills/backlog/backlog.ts <command> [args]
```

---

## Backlog File Location

`.github/skills/backlog/backlog.json`

Each task entry:
```json
{
  "id": "2.1",
  "chapter": 2,
  "title": "Define VehicleRole union and rename existing VehicleType → VehicleRole",
  "files": ["src/core/entities/Vehicle.ts"],
  "testFile": "tests/unit/entities/Vehicle.test.ts",
  "status": "pending",
  "blockedBy": [],
  "closedInPR": null
}
```

Statuses: `"pending"` | `"in-progress"` | `"done"` | `"blocked"`

---

## Rules

1. **Only one task `in-progress` at a time** per agent session. `start` command enforces this.
2. **Always call `done` after PR is merged.** Pass `--pr <number>` to record PR reference.
3. **Prefer tasks with all `blockedBy` IDs resolved.** `next` command handles this automatically.
4. **Never skip `start`.** Claiming task before coding prevents two agents on same item.
5. Can't complete task → call `block <id>` + note reason in PR description.

---

## Developer Script

Richer, colour-formatted version of same commands for humans:

```bash
npx tsx scripts/backlog.ts <command> [args]
```

Both scripts read/write same `backlog.json`. Use developer script locally to inspect progress; use agent script in automated pipelines.
