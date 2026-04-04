---
name: coding-conventions
description: >
  Coding conventions, workflow rules, and style guidelines for BlastSimulator2026: TypeScript strict,
  naming conventions, i18n rules, error handling, console command patterns, and performance
  considerations. Use when writing or reviewing code to ensure consistency.
---

## Approaching a Bug Fix or Feature Request

1. **Understand the issue** — reproduce it in console mode if possible (`npx tsx src/console.ts`)
2. **Find the relevant modules** — core logic in `src/core/`, rendering in `src/renderer/`, etc. Never reach across layer boundaries.
3. **Write or update tests** — add a failing test that captures the bug or expected new behavior
4. **Implement** — minimum change that makes the test pass; don't refactor unrelated code
5. **Validate** — `npm run validate` must pass cleanly
6. **Visual check** (if rendering touched) — capture and inspect screenshot

## Code Style

- **TypeScript strict** — no `any` except in test fixtures
- **Functional style** in `src/core/` — prefer pure functions, avoid mutation where practical
- **Interfaces over classes** for data structures; **classes** for stateful systems
- **Named exports** — no default exports except entry points
- **File size limit:** 300 lines per code file. Split into sub-modules if needed.
- **Comments:** Document non-obvious algorithms. Don't comment obvious code.

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

- **All user-facing text** must go through the i18n system — never hardcode player-visible strings
- Always add both `en.json` and `fr.json` entries simultaneously
- Use interpolation for dynamic values: `t('blast.fragments', { count: 42 })`
- Fictional names (rocks, explosives, ores) also go through i18n

## Console Command Pattern

When adding or modifying a console command:
1. Handler lives in `src/console/commands/`
2. Register it in `ConsoleRunner.ts`
3. Handler receives `GameState` and parsed arguments, calls core logic, returns `CommandResult`
4. `ConsoleFormatter` converts the result to human-readable output
5. Write an integration test that exercises the command

## Error Handling

Core functions should return result objects, not throw exceptions:
```typescript
type Result<T> = { success: true; data: T } | { success: false; error: string };
```

Physics/rendering can use try/catch for unexpected errors. Never let the game crash — show an error message and continue.

## Performance Considerations

- Marching cubes recalculation is localized — only recompute chunks near the blast
- Fragment count is capped per blast (max 2000) to avoid physics overload
- Event system timers use delta-time accumulation, not setTimeout
- Voxel grid operations use spatial indexing where beneficial

## Centralized Configuration

All game constants live in `src/core/config/`. Never hardcode numbers in logic files.

## Seeded PRNG

Use `src/core/math/Random.ts` for all randomness. Never use `Math.random()`.

## Creative Direction

The human is the **creative director**. Ask for input on:
- New fictional names (rocks, ores, explosives, characters, levels)
- New event content — propose 3-5 examples first, get tone approval before generating more
- Game feel decisions (how punishing, how fast, etc.)

Handle all technical decisions autonomously (architecture, algorithms, tests, balancing, translations).

## PR Rules

- Reference the issue number in the PR body with "Closes #<number>"
- This is critical for the auto-assign pipeline to work

## Code Review Rules

- Approve if: all acceptance criteria pass, tests pass, code is clean
- Request changes if: tests fail or code quality issues exist
  → Comment `@copilot <specific fix instruction>` so the agent can iterate
- Tag @Nico2398 if: architectural decisions needed, ambiguous requirements, or creative direction input needed
