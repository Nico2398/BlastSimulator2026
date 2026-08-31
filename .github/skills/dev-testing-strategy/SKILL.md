---
name: dev-testing-strategy
description: >
  Testing strategy and conventions for BlastSimulator2026: 4-layer test pyramid (unit, integration,
  visual, scenario), Vitest patterns, per-chapter coverage goals, integration test suites with
  specific scenarios, full-level integration tests, scenario definitions, performance benchmarks,
  and validation workflow. Use when writing tests, setting up test infrastructure, or validating changes.
---

## Philosophy

No layer optional. **More tests always better** — do not limit test cases.

1. **Unit tests** — Every exported pure function in `src/core/` has exhaustive coverage. Fast, no I/O, seeded PRNG.
2. **Small integration tests** — Console command sequences covering partial gameplay loops with huge scenario variation.
3. **Full-level integration tests** — Complete runs from `new_game` to terminal outcome (win or each loss condition).
4. **Visual scenario tests** — Full browser sessions (Puppeteer), real clicks. Screenshots + JSON state dumps after every command. Proves a player can reach the goal — no console command stands in for a player action.

All four layers must pass before any PR is merged. Playability used to be a fifth, separate layer (`npm run playtest`); issue #515 folded it into `visual` once every scenario step carried a structurally-enforced `role` and interaction-mode `expect.usable`/`expect.blocked` checks proved what a playtest beat proved. The old playtest script and its JSON definitions are deleted.

## Verification Channels

The layers surface as four independent channels. Each catches what the others miss, so a change is verified through every channel it touches — not the cheapest one.

| Channel | Command | Proves | Misses |
|---------|---------|--------|--------|
| `static` | `npm run typecheck` | Types line up across `src/` and `scripts/` | Anything about runtime behaviour |
| `logic` | `npm run test` | Unit + integration behaviour matches expectations | Whether the game renders |
| `scenario` | `npm run scenarios` | Full command sequences produce the expected game state — a command the console refuses now fails the step unless the step declares `commandOutcome: 'refused'`/`'either'` | Whether the UI is reachable |
| `visual` | `npm run scenarios:interaction`, `npm run screenshot` | The game renders, the UI responds to real clicks, and a player can reach the goal by clicking alone | Numeric correctness — that is `logic` |

The first three all drive the simulation through `src/console/`, whose commands are a superset of what the UI exposes. That is why they can be green on an unplayable game, and why a `role: 'player'` scenario step forbids console commands for anything a player would have to do (`checkStepActionAllowed`, `scripts/shared/interaction-executor.ts`). Procedures: `dev-visual-testing` skill; step roles: `.claude/rules/scenario-defs.md`.

Two channels disagreeing means neither result stands. Investigate until they agree.

`npm run verify:env` reports each channel as READY or BLOCKED with the remedy. Run it when a channel's usability is in doubt rather than assuming a failure is a code defect.

## Validation Commands

```bash
npm run verify:env        # which channels are live
npm run validate          # TypeScript → coverage → integration → scenario defs → build
npm run typecheck         # TypeScript across src/ and scripts/
npm run test              # Unit + integration tests
npm run test:integration  # Integration tests only
npm run test:scenarios    # Validates scenario definition files (not the scenario runner)
npm run scenarios         # Runs all scenarios, command mode
npm run scenarios:interaction  # Runs all scenarios, interaction mode (real clicks)
npm run console           # Interactive gameplay testing (no browser)
```

`npm run validate` covers static, logic, and the scenario *definition* check. It does not run the scenario runner or the visual channel — invoke `npm run scenarios` and the visual commands separately.

## Unit Test Conventions

**Location:** `tests/unit/` — mirrors `src/core/` structure.
**Naming:** `{Module}.test.ts` at same path. E.g., `src/core/nav/Pathfinding.ts` → `tests/unit/nav/Pathfinding.test.ts`

Every exported pure function must have:
- One positive test (happy path)
- One boundary test (edge values, empty inputs, zero, maximal)
- One failure/rejection test (invalid input, insufficient funds, wrong state)

```typescript
import { describe, it, expect } from 'vitest';
describe('ModuleName', () => {
    it('specific behavior in present tense', () => {
        // Arrange → Act → Assert
    });
});
```

Always use seeded PRNG: `{ seed: 42 }`. Never use `Math.random()` in tests.

## Per-Chapter Coverage Targets

| Chapter | Minimum Line Coverage |
|---------|----------------------|
| 1 — Buildings | 90% |
| 2 — Vehicles | 90% |
| 3 — Employee Skills | 90% |
| 4 — Survey System | 90% |
| 5 — Blast Full Pipeline | 95% |
| 6 — NavMesh | 90% |
| 7 — Employee Needs | 90% |
| `src/physics/` | 70% (harder to test deterministically) |
| `src/renderer/` | Covered by visual tests (no unit target) |
| `src/console/` | 80% |

## Integration Test Conventions

**Location:** `tests/integration/` and `tests/integration/full-level/`

Same Vitest runner. May import from `src/console/` (command layer). Must exercise at least one full round-trip through game loop. No DOM, no Three.js.

Small suites carry **at least 8 scenarios** each; full-level tests run `new_game` through to a terminal `levelEndReason`. Writing or extending either kind starts by reading `references/integration-suites.md` — it holds the per-suite minimum scenario list and the full-level outcome matrix a suite is measured against.

Discover what already exists rather than assuming: `ls tests/integration/ tests/integration/full-level/`.

## Scenario Test Definitions

JSON files in `scripts/scenario-defs/`. Runner captures screenshot + state JSON after every step.

**Dual-play modes** (`--mode command|interaction`):
- **command** (default) — sends console commands via `__gameConsole()`.
- **interaction** — executes Puppeteer interactions (click, type, waitForSelector, etc.) via `executeInteractionStep()` from `scenario-interaction-runner.ts`.

Scenario steps can define an `interaction` array of `InteractionStepAction` objects for UI-level testing. Steps without `interaction` fall back to command execution. Type definitions in `scripts/shared/scenario-types.ts`.

Steps also carry `role: 'player' | 'setup' | 'observe'`, `expect` (`ScenarioStepGoal`), and `commandOutcome: 'refused' | 'either'` — `role` constrains which commands an interaction array may reach for, `expect` proves the step's actions actually moved game state rather than merely not throwing, `commandOutcome` declares when a step's command is expected to be refused by the console (default: the command must succeed, or the step fails, naming the command and the console's refusal text). Full field list and current tagging state: `scripts/shared/scenario-types.ts`'s doc comments (Claude Code sessions also have the narrative version in `.claude/rules/scenario-defs.md`).

**Assert a step's own delta, not the file's running total.** For any field that accumulates across a scenario (cash, scores, counts), prefer `expect.changedBy` (the exact amount *this step's own actions* moved the field) or `expect.increased`/`decreased` (direction only) over a chained `expect.equals` on the same field. `equals` encodes the whole cumulative history of the file up to that step, so inserting a step anywhere upstream — exactly what the #554-#557 "is real work" migrations do, converting an instant action into queued, worker-gated work — forces every absolute figure after it to be recomputed by hand. A step-local assertion only needs editing when its own step changes. Reserve `equals` for a field that genuinely describes a state rather than a running total: flags, ids, terminal outcomes (`levelEndReason`), counts that are set rather than accrued. Full rationale and the field's evaluator: `.claude/rules/scenario-defs.md`.

**Async commands need tick padding.** A command that queues async work (e.g. `survey seismic`) must be followed by enough `tick` steps to let it resolve before a dependent step runs, or the dependent step reads stale state. Insert several `tick 10` steps after the async command, matching `survey-then-blast.json`.

**Scenarios needing a staffed site use `new_game staffed:true` / `sandbox start staffed:true`**, not manual `hire`/`purchase` setup steps. The flag hires and equips the roster and fleet defined in `STARTING_SITE_STAFFED_COMPOSITION` (`src/core/config/balance.ts`) for free, at game-open — see `blast-basic.json`'s `new_game seed:42 staffed:true`.

### Finding the scenarios a change touches

`scripts/scenario-defs/` is the catalogue. It grows with every feature, so read the directory rather than any list of names — each definition states its own `name` and `description`:

```bash
ls scripts/scenario-defs/*.json                          # every scenario
jq -r '.name + " — " + .description' scripts/scenario-defs/*.json   # what each one proves
ls scripts/scenario-defs/*playthrough*.json              # the full-level playthroughs
grep -l 'place_building' scripts/scenario-defs/*.json    # scenarios driving one command
grep -l '"role": "player"' scripts/scenario-defs/*.json  # scenarios that click rather than command
```

Select by what the change touches: every scenario whose steps name the command, panel, or entity involved. Grep for the command the change alters — a filename guessed from memory misses the scenario that actually covers it.

**Mandatory cadence:** a renderer or UI change runs the scenarios that show the thing rendered, found by the greps above. Every playthrough scenario runs before merging a UI or HUD change, and before merging any PR.

### Visual Validation Protocol

After any rendering change:
1. `npm run dev &`
2. Run each selected scenario with screenshots:
   ```bash
   npm run scenario -- --scenario <name> --mode interaction --screenshots
   ```
3. **Open every screenshot** in `screenshots/scenario-{name}-interaction/` with the Read tool and describe what it shows
4. Verify each description against what the scenario's own step `description` and `expect` say should be on screen
5. If any check fails → fix rendering → re-run

Screenshots opt-in via `--screenshots`. CI runs without it (no screenshots, state-only validation).
Use `npm run scenarios` / `npm run scenarios:interaction` for batch runs.

Capturing a screenshot is not inspecting it. A rendering change stays unverified until an image has been read. Full procedure: `dev-visual-testing` skill.

## Performance Benchmarks

| Benchmark | Target |
|-----------|--------|
| A* path on 100×100 grid | < 2ms per request |
| Full blast pipeline (500 voxels) | < 50ms |
| NavGrid full rebuild (100×100) | < 10ms |
| Frame tick at 8× speed, 20 agents | < 16ms |
| Survey estimation (radius 20) | < 5ms |
| Full-level integration test (Level 1 win) | < 30s wall clock |

## CI Launch Strategy

CI has 3 tiers of scenario testing:

| Tier | What | When | Time |
|------|------|------|------|
| **1 — Command** | Every scenario definition in command mode (pure Node.js, no browser) | Every push, PR, schedule, manual | ~1 min |
| **2 — Interaction** | Every scenario definition in interaction mode (Puppeteer, real browser) | Push to main, schedule (weekly), workflow_dispatch, **or PR with `full-ci` label** | tens of minutes† |
| **3 — Full** | Tiers 1 + 2 combined | Automatic on schedule/weekly; opt-in via `full-ci` label on PR | tens of minutes† |

† No GPU means ~6 s/frame in software rasterisation (#475) — a cached minute figure goes stale fast, so none is kept here. Current cost and the `full-ci` label rule: `agentic-pipeline-pr-management` skill. Claude Code session mechanics for these jobs: `.claude/CLAUDE.md`'s "Claude Code only" section.

**Label convention:** Add `full-ci` to a PR when an interaction-mode scenario drives the change, or when it touches machinery every scenario runs through. The `full-ci` label on an issue MUST transfer to the opened PR. Most PRs — docs, config, logic-only, and UI no definition reaches — skip both browser jobs safely; the `visual` channel covers those against the one scenario that exercises them. Rule and cost: `agentic-pipeline-pr-management`.

## Wait on Conditions, Never on a Fixed Delay

A test that sleeps encodes the authoring machine's timing. The delay is simultaneously too long everywhere it passes and too short somewhere it has not run yet — CI on a different browser version, a shared browser under a sharded job, a loaded runner. It is the single most common source of a suite that is both slow and flaky.

Wait on the thing the test actually needs, so it costs only the time really taken and fails by name when the thing never happens:

- **Simulation time** — `waitUntil` on the state field the step is waiting for, never a hand-measured `tick N` pad.
- **DOM state** — `waitForProperty` (a property settling), `waitForSelector` (existence), `awaitUsable` (genuine clickability).
- **Wall-clock delays in UI code** — inject the clock. A component that waits on real time takes `now: () => number` defaulting to `performance.now`, so tests advance a fake clock instead of sleeping through the real one (`dev-coding-conventions`).

A fixed-duration wait is legitimate only where no observable condition exists to poll. There, keep it bounded and state in the test or step what could not be polled — an unexplained sleep is a defect, not a passing test.

## Regression Test Policy

Any bug fix must include new unit or integration test that:
- Fails on the buggy code
- Passes on the fix
