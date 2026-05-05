# BlastSimulator2026 — Agent Instructions

**What it is:** Satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits, 3-level campaign.

## Skills

Detailed specs for each system live in `.github/skills/`. Read the relevant file before touching that system:

| Skill | File | Use when |
|-------|------|----------|
| `architecture` | `.github/skills/architecture/SKILL.md` | Structural changes, new modules |
| `blast-system` | `.github/skills/blast-system/SKILL.md` | Blast mechanics, fragment physics |
| `buildings` | `.github/skills/buildings/SKILL.md` | Building types, tiers, placement |
| `vehicle-fleet` | `.github/skills/vehicle-fleet/SKILL.md` | Vehicles, driving, hauling |
| `employee-skills` | `.github/skills/employee-skills/SKILL.md` | Skill XP, task queue, proficiency |
| `survey-system` | `.github/skills/survey-system/SKILL.md` | Rock surveys, ore discovery |
| `navmesh` | `.github/skills/navmesh/SKILL.md` | Pathfinding, NavGrid, ramps |
| `employee-needs` | `.github/skills/employee-needs/SKILL.md` | Hunger, fatigue, morale |
| `game-design` | `.github/skills/game-design/SKILL.md` | Core gameplay, economy, events |
| `testing-strategy` | `.github/skills/testing-strategy/SKILL.md` | Test pyramid, Vitest patterns |
| `coding-conventions` | `.github/skills/coding-conventions/SKILL.md` | TypeScript style, naming, i18n |

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
- No sorry. No please. No "Great question!". Just answer.

Technical precision still required — short style, not shallow thinking.
