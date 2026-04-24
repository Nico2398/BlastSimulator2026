# BlastSimulator2026 — Copilot Instructions

**What it is:** Satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits, 3-level campaign.

## Skills

Skills in `.github/skills/` auto-load based on task relevance: `architecture`, `blast-system`, `buildings`, `vehicle-fleet`, `employee-skills`, `survey-system`, `navmesh`, `employee-needs`, `game-design`, `testing-strategy`, `visual-testing`, `coding-conventions`, `autonomous-pipeline`.

## Custom Agents — TDD Development Pipeline

For every feature or bug fix, follow **test-driven development pipeline** using specialized agents. Each agent has focused context + tools for its phase:

### The TDD Pipeline

```
1. @test-writer    → Write failing tests (Red phase)
2. @implementer    → Write minimum code to pass tests (Green phase)
3. @refactorer     → Clean up code for clarity (Refactor phase)
4. @validator      → Run full validation suite
5. @visual-tester  → Screenshot verification (only for visual changes)
```

**How to use agents:**
- **New feature**: `@test-writer` → `@implementer` → `@refactorer` → `@validator`
- **Bug fix**: `@test-writer` to capture bug → `@implementer` to fix
- **Visual change**: After main pipeline, also run `@visual-tester`
- **Simple tasks** (docs, config, typos): Skip pipeline, make changes directly
- **PR review**: Use `@reviewer` outside the pipeline to audit a PR + post APPROVED to trigger auto-merge

Agents defined in `.github/agents/`, invoked as sub-agents from main context.

### Agent Handoff Protocol

Each agent should:
1. State what it produced (files created/modified)
2. Report pass/fail status of verification step
3. Identify next agent in pipeline

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

## Quick Reference — Validation Commands

```bash
npm run validate        # TypeScript → tests → build (run after every change)
npm run test            # Tests only
npx tsx src/console.ts  # Interactive gameplay testing (no browser)
```

## Quick Reference — Scenario Testing

```bash
npm run dev &
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts --scenario blast-basic
```

Available scenarios: `blast-basic`, `level1-win-efficient`, `level1-win-conservative`, `level1-lose-bankruptcy`, `level1-lose-arrest`, `level1-lose-ecology`, `level1-lose-revolt`.

## Essential Rules

- **300-line limit** per code file — split into sub-modules if needed (data/i18n files exempt)
- **TypeScript strict** — no `any` except in test fixtures
- **Seeded PRNG** (`src/core/math/Random.ts`) — never `Math.random()`
- **Centralized config** (`src/core/config/`) — never hardcode numbers in logic
- **Named exports** everywhere except entry points
- **i18n**: Every user-facing string through `t('key')`. Always add both `en.json` and `fr.json`. Never hardcode player-visible text.
- **PR body**: Always include `Closes #<number>` — critical for auto-assign pipeline

## Backlog

Next phase features documented in `.agent/NEXT_PHASE_DESIGN.md`. Feature backlog with atomic task breakdowns for 8 major systems (buildings, vehicles, employee skills, rock composition, blast algorithm, navmesh, employee needs, testing strategy).

**Required steps when working on a backlog task:**
1. Before coding: `npx tsx .github/skills/backlog/backlog.ts start <id>`
2. After opening the PR: include `Closes #<number>` in the PR body
3. **Before the final commit/push**: `npx tsx .github/skills/backlog/backlog.ts done <id> --pr <pr_number>` — CI blocks merge until no task is `in-progress`

## Creative Direction

Human is **creative director**. Ask for input on:
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

## Code Review Rules

- Approve if: all acceptance criteria pass, tests pass, code is clean
- Request changes if: tests fail or code quality issues exist → Comment `@copilot <specific fix instruction>`
- Tag @Nico2398 if: architectural decisions needed, ambiguous requirements, or creative direction input needed
