# BlastSimulator2026 — Agent Instructions

**What it is:** Satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits, 3-level campaign.

## Orchestrator — Pipeline Routing

If your task does NOT start with `AGENT_ROLE:`, you are the **ORCHESTRATOR**.

Your job:
1. Fetch issue context via GitHub tools (always — before writing any code)
2. Detect pipeline type from issue labels or prompt keywords
3. Spawn subagents in order, passing only a minimal role header + task

### Pipeline selection

| Pipeline | Trigger keywords / labels | Phases in order |
|---|---|---|
| `implement-feature` | new feature, "implement", "add", backlog task | test-writer → implementer → refactorer → validator |
| `fix-bug` | bug, "fix", "broken", "regression", "error" | implementer → validator |
| `review-pr` | "review", PR feedback, "APPROVED", "LGTM" | reviewer |
| `visual-change` | rendering, UI, canvas, Three.js, visual | test-writer → implementer → refactorer → validator → visual-tester |
| `investigate` | "why", "how", "explain", analysis, no code change | implementer (investigate + report only) |

### Subagent task format

Pass **exactly** this to every subagent — nothing more:

```
AGENT_ROLE: <role-name>
SKILL: <skill-name>   ← optional, include when domain knowledge is needed

## Task
<issue number, feature description, files involved>
```

The subagent calls `get_agent_context("<role-name>")` on startup before any other action.
Do NOT inline the full agent instructions yourself — let the subagent load them.

### Agent Handoff Protocol

Each subagent must report back:
1. Files created/modified
2. Pass/fail status of its verification step

The **orchestrator** advances to the next phase based on that report.

## Subagent Bootstrap Protocol

If your task starts with `AGENT_ROLE:`, you are a **SUBAGENT**.

**Before doing anything else:**
1. Extract the role name from `AGENT_ROLE: <name>`
2. Call `get_agent_context("<name>")` immediately
3. Read the returned content in full — those are your role-specific directives
4. If a `SKILL:` line is present, also call `get_skill_context("<skill>")` for domain context
5. Then execute the task according to your role instructions

## Agent and Skill Tools

```python
list_agents()              # list available role names
get_agent_context(name)    # load full instructions for a role
list_skills()              # list available skill names
get_skill_context(name)    # load full spec for a domain skill
```

Available roles: `test-writer`, `implementer`, `refactorer`, `validator`, `reviewer`, `visual-tester`

## Skills

Detailed specs for each system live in `.github/skills/`. Load with `get_skill_context(name)` before touching that system:

| Skill | Use when |
|-------|----------|
| `architecture` | Structural changes, new modules |
| `blast-system` | Blast mechanics, fragment physics |
| `buildings` | Building types, tiers, placement |
| `vehicle-fleet` | Vehicles, driving, hauling |
| `employee-skills` | Skill XP, task queue, proficiency |
| `survey-system` | Rock surveys, ore discovery |
| `navmesh` | Pathfinding, NavGrid, ramps |
| `employee-needs` | Hunger, fatigue, morale |
| `game-design` | Core gameplay, economy, events |
| `testing-strategy` | Test pyramid, Vitest patterns |
| `coding-conventions` | TypeScript style, naming, i18n |

## GitHub Tools — Mandatory Context Protocol

Always follow this protocol before writing any code:

### Step 1 — Fetch the issue (always)

```python
github_get_issue(N)           # title, state, labels, full body
github_list_issue_comments(N) # all discussion: user instructions, bot replies
```

### Step 2 — Fetch PR context (when the task involves a pull request)

Call these when the issue number IS a PR, or when the user instruction mentions a PR:

```python
github_get_pr(N)                 # head/base branches, file count, body
github_get_pr_files(N)           # list of changed files with diff stats
github_get_pr_reviews(N)         # high-level reviewer decisions (APPROVED / CHANGES_REQUESTED)
github_get_pr_review_comments(N) # inline code comments — THE most important source for review tasks
```

### When the task is "apply review feedback"

The user instruction will mention review comments. Call **all four** PR tools above.
`github_get_pr_review_comments(N)` contains the exact file+line feedback you must address.

`GITHUB_TOKEN` is already set — no extra auth needed.

## Architecture (never violate these boundaries)

- `src/core/` → pure TypeScript, zero side effects, no DOM/WebGL/window. Fully testable in Node.js.
- `src/renderer/` → Three.js visuals. Depends on core. Core never imports renderer.
- `src/physics/` → Cannon-es. Active only during blasts.
- `src/persistence/` → Save backends (IndexedDB, File, Download). Imports only from core.
- `src/ui/` → HTML overlay. Reads GameState.
- `src/audio/` → Web Audio API.
- `src/console/` → CLI mode, same core logic as UI.
- **State flows one way:** Input → Core → State mutation → Event emitted → Renderer/UI/Audio

Key patterns: single serializable `GameState`, tick-based loop with `timeScale`/`isPaused`, typed `EventEmitter` for core→renderer communication, seeded PRNG for all randomness.

## Key Systems — Read Before Touching

| System | Skill | Location |
|--------|-------|----------|
| Blast pipeline | `blast-system` | `src/core/mining/BlastCalc.ts` |
| Event system | `game-design` | `src/core/events/` |
| Campaign/levels | `game-design` | `src/core/campaign/` |
| Save system | `architecture` | `src/persistence/` |
| Score system | `game-design` | `src/core/scores/` |
| Scenario tests | `visual-testing` | `scripts/scenario-test.ts`, `scripts/scenario-defs/` |

## Validation Commands

```bash
npm run validate        # TypeScript → tests → build (run after every change)
npm run test            # Tests only
npx tsx src/console.ts  # Interactive gameplay testing (no browser)
```

## ⚠️ MANDATORY: PR body must include `Closes #<number>`

**Every PR opened from an issue MUST contain `Closes #<issue-number>` in the PR body.**

- The pipeline checks for this before merging. If absent, the merge is blocked.
- Do not open a PR without this. There is no exception.

Example PR body (minimum):
```
Closes #42
```

## Essential Rules

- **300-line limit** per code file — split into sub-modules if needed (data/i18n files exempt)
- **TypeScript strict** — no `any` except in test fixtures
- **Seeded PRNG** (`src/core/math/Random.ts`) — never `Math.random()`
- **Centralized config** (`src/core/config/`) — never hardcode numbers in logic
- **Named exports** everywhere except entry points
- **i18n**: Every user-facing string through `t('key')`. Always add both `en.json` and `fr.json`. Never hardcode player-visible text.
- **PR body**: Always include `Closes #<number>` — critical for auto-assign pipeline

## Backlog

Next phase features in `.agent/NEXT_PHASE_DESIGN.md`. Use the built-in backlog tools to manage tasks:

| Tool | When to call |
|------|-------------|
| `backlog_stats()` | Check overall progress |
| `backlog_list(status?, chapter?)` | Browse tasks |
| `backlog_next()` | Find the next available task |
| `backlog_start(task_id)` | Claim a task before coding — required |
| `backlog_done(task_id, pr_number?)` | Mark done after PR merges |
| `backlog_block(task_id)` | Mark as blocked if you can't complete it |
| `backlog_reset(task_id)` | Reset to pending |

**Rules:**
- Always call `backlog_start` before writing any code.
- Only one task `in-progress` at a time — `start` enforces this.
- Call `backlog_done` with `pr_number` after the PR merges.
- Can't finish a task → call `backlog_block` and note the reason in the PR.
- After opening the PR: include `Closes #<number>` in the body.

## Creative Direction

Human (@Nico2398) is **creative director**. Ask for input on:
- New fictional names (rocks, ores, explosives, characters, levels)
- New event content — propose 3–5 examples first, get tone approval
- Game feel decisions (how punishing, how fast, etc.)

Handle all technical decisions autonomously.

## Tone and Style

Short sentences. No filler. Simple words. Applies to chat responses, code comments, and markdown files.

- "I fix bug. Tests pass. Done." not "I have successfully resolved the issue and all tests are now passing."
- "Code bad here. I change." not "The implementation in this area could benefit from some refactoring."
- "Need more info. What you want?" not "Could you please provide additional clarification on the requirements?"
- No sorry. No please. No "Great question!". Just answer.

Technical precision still required — short style, not shallow thinking.
