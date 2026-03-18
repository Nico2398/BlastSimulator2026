# BlastSimulator2026 — Workflow Reference

Reference for approaching bug fixes and feature requests. Consult on demand.

---

## Approaching a Bug Fix or Feature Request

1. **Understand the issue** — reproduce it in console mode if possible (`npx tsx src/console.ts`), read the relevant `.agent/` doc for context
2. **Find the relevant modules** — core logic in `src/core/`, rendering in `src/renderer/`, etc. Never reach across layer boundaries.
3. **Write or update tests** — add a failing test that captures the bug or the expected new behavior before touching implementation
4. **Implement** — minimum change that makes the test pass; don't refactor unrelated code
5. **Validate** — `npm run validate` must pass cleanly
6. **Visual check** (if rendering was touched) — `bash scripts/visual-test.sh --name "label" --commands "..."` and inspect the screenshot

---

## Code Style

- **TypeScript strict** — no `any` except in test fixtures
- **Functional style** in `src/core/` — prefer pure functions, avoid mutation where practical
- **Interfaces over classes** for data structures; **classes** for stateful systems
- **Named exports** — no default exports except entry points
- **File size limit:** 300 lines per code file. Split into sub-modules if needed.
- **Comments:** Document non-obvious algorithms. Don't comment obvious code.

---

## Naming Conventions

- Files: `PascalCase.ts` for classes/interfaces, `camelCase.ts` for utility modules
- Types/Interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Test files: `{SourceFile}.test.ts`
- Translation keys: `dot.separated.lowercase` (e.g., `blast.too_strong`)

---

## i18n Rules

- **All user-facing text** must go through the i18n system — never hardcode player-visible strings
- Always add both `en.json` and `fr.json` entries simultaneously
- Use interpolation for dynamic values: `t('blast.fragments', { count: 42 })`
- Fictional names (rocks, explosives, ores) also go through i18n

---

## Console Command Pattern

When adding or modifying a console command:
1. Handler lives in `src/console/commands/`
2. Register it in `ConsoleRunner.ts`
3. Handler receives `GameState` and parsed arguments, calls core logic, returns `CommandResult`
4. `ConsoleFormatter` converts the result to human-readable output
5. Write an integration test that exercises the command

---

## Error Handling

Core functions should return result objects, not throw exceptions:
```typescript
type Result<T> = { success: true; data: T } | { success: false; error: string };
```
Physics/rendering can use try/catch for unexpected errors. Never let the game crash — show an error message and continue.

---

## Performance Considerations

- Marching cubes recalculation is localized — only recompute chunks near the blast
- Fragment count is capped per blast (max 2000) to avoid physics overload
- Event system timers use delta-time accumulation, not setTimeout
- Voxel grid operations use spatial indexing where beneficial

---

## Reference Documents

| Feature area | Read |
|-------------|------|
| Any game mechanic | `.agent/GAME_DESIGN.md` |
| Code structure, modules | `.agent/ARCHITECTURE.md` |
| Blast mechanics | `.agent/BLAST_SYSTEM.md` |
| Writing tests | `.agent/TESTING.md` |
| Visual/screenshot testing | `.agent/VISUAL_TESTING.md` |
