---
name: dev-coding-conventions
description: >
  Coding conventions, workflow rules, and style guidelines for BlastSimulator2026: TypeScript strict,
  naming conventions, i18n rules, error handling, console command patterns, and performance
  considerations. Use when writing or reviewing code to ensure consistency.
---

## Bug Fix / Feature Request Workflow

1. **Understand** — reproduce in console mode if possible (`npm run console`)
2. **Find modules** — core logic in `src/core/`, rendering in `src/renderer/`. Never cross layer boundaries.
3. **Write/update tests** — failing test capturing bug or new behavior first
4. **Implement** — minimum change to pass test; don't refactor unrelated code
5. **Validate** — `npm run validate` must pass cleanly
6. **Scenario check** (gameplay, console, economy, campaign touched) — `npm run scenarios`
7. **Visual check** (rendering or UI touched) — capture a screenshot, then open it with the Read tool and describe what is on screen. Details in `dev-visual-testing`.

## Code Style

- **TypeScript strict** — no `any` except in test fixtures
- **Functional style** in `src/core/` — prefer pure functions, avoid mutation
- **Interfaces over classes** for data structures; **classes** for stateful systems
- **Named exports** — no default exports except entry points
- **Single responsibility, not line count.** A code file under `src/` or `scripts/` holds one concern; split it when it doesn't, whatever its length. No lint test owns this — it is a judgment call for the author and, on review, for `@quality-reviewer`/`@refactorer`. A short file mixing two unrelated concerns is a split; a long file holding one genuinely cohesive concern (a data table, a catalog) is not. This applies to `src/core/config/balance.ts`, `src/ui/tokens.ts`, and `src/ui/styles.ts` too — their size tracks how much game content exists, not how many responsibilities the module carries. Tests are outside this call as well: a test file grows one independent case at a time, so its length carries no cohesion signal, and splitting one mints the near-duplicate fixtures a duplication review then flags.
- **Comments:** Document non-obvious algorithms. Don't comment obvious code.
- **`TODO(#N)` — every TODO names its issue.** A bare `TODO` is debt with no owner and no queue position; `TODO(#N)` is debt an issue will come back and remove. Write what to do when #N lands, not just what is wrong, and say so on the line when the workaround degrades behaviour:

  ```ts
  // TODO(#742): SurveyPanel re-reads the grid every tick. Cache once #742 lands.
  const composition = grid.compositionAt(x, y); // recomputed per frame until then
  ```

  A `TODO(#N)` is how a run gets past a blocker without stopping — the procedure, and when a bypass is the right call at all, is in `agentic-decision-autonomy`. The issue it names carries a `## Bypass to remove` section pointing back at this file, and closing that issue deletes the comment.

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files (classes/interfaces) | `PascalCase.ts` | `BlastCalc.ts` |
| Files (utilities) | `camelCase.ts` | `mathUtils.ts` |
| Types/Interfaces | `PascalCase` | `GameState` |
| Functions/variables | `camelCase` | `calculateEnergy` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_FRAGMENTS` |
| Test files | `{SourceFile}.test.ts` | `BlastCalc.test.ts` |
| Translation keys | `dot.separated.lowercase` | `blast.too_strong` |

## i18n Rules

- All user-facing text must go through i18n — never hardcode player-visible strings
- Always add both `en.json` + `fr.json` entries simultaneously
- Use interpolation for dynamic values: `t('blast.fragments', { count: 42 })`
- Fictional names (rocks, explosives, ores) also go through i18n

## Console Command Pattern

When adding or modifying console command:
1. Handler in `src/console/commands/`
2. Register in `ConsoleRunner.ts`
3. Handler receives `GameState` + parsed args → calls core logic → returns `CommandResult`
4. `ConsoleFormatter` converts result to human-readable output
5. Write integration test exercising the command

## Error Handling

Core functions return result objects, not throw exceptions:
```typescript
type Result<T> = { success: true; data: T } | { success: false; error: string };
```

Physics/rendering can use try/catch for unexpected errors. Never let game crash — show error message + continue.

## Performance Considerations

Concrete measures below; the general rule for how cost must scale as the game grows is in `dev-design-principles`.

- Marching cubes recalculation localized — only recompute chunks near blast
- Fragment count capped per blast (max 2000) to avoid physics overload
- Event system timers use delta-time accumulation, not setTimeout
- A UI element that must delay by real wall-clock time (not simulation ticks — e.g. letting an animation play before a modal opens) takes its clock as an injectable constructor param defaulting to `performance.now`: `constructor(..., private readonly now: () => number = () => performance.now())`. Tests inject a fake clock instead of waiting out the real delay; production gets the real one for free. See `BlastReportModal` (#545).
- Voxel grid operations use spatial indexing where beneficial

## Centralized Configuration

All game constants in `src/core/config/`. Never hardcode numbers in logic files.

## Seeded PRNG

Use `src/core/math/Random.ts` for all randomness. Never use `Math.random()`.

## Creative Direction

Human is **creative director**. Ask for input on:
- New fictional names (rocks, ores, explosives, characters, levels)
- New event content — propose 3-5 examples first, get tone approval before generating more
- Game feel decisions (how punishing, how fast, etc.)

Handle all technical decisions autonomously (architecture, algorithms, tests, balancing, translations).

## PR Rules

- Reference issue number in PR body with "Closes #<number>"
- Critical for auto-assign pipeline to work

## Code Review Rules

- Approve if: all acceptance criteria pass, tests pass, code is clean
- Request changes if: tests fail or code quality issues exist
  → Comment `@copilot <specific fix instruction>` so agent can iterate
- **SOLID compliance and durability under growth** — single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion, plus coupling, genericity, and cost curve: `dev-design-principles` holds the criteria and the counterweight against speculative generality.
- Tag @Nico2398 if: architectural decisions needed, ambiguous requirements, or creative direction needed
