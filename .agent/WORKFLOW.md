# BlastSimulator2026 — Agent Workflow

## 1. Golden Rules

1. **README.md is your single source of truth.** Read the task list before starting any work.
2. **One task at a time.** Never work on multiple tasks simultaneously.
3. **Tests first, code second.** Write acceptance tests before or alongside implementation.
4. **Validate after every task.** Run `bash scripts/validate.sh` after each task. If it fails, fix it before moving on.
5. **Mark tasks as done.** Update the README task list checkbox from `[ ]` to `[x]` when a task passes all its acceptance criteria.
6. **Core before rendering.** All game logic must work in console mode before adding visual elements.
7. **Never break existing tests.** If your change breaks a previously passing test, fix the regression before proceeding.
8. **Commit messages explain what and why.** If using git, write clear commit messages.

## 2. Task Execution Procedure

For each task, follow this exact sequence:

### Step 1: Read the Task
- Read the task description and acceptance criteria in README.md
- Read any referenced `.agent/` documents for additional context
- Identify which source files need to be created or modified

### Step 2: Write Tests
- Create test files for the new functionality
- Tests should initially fail (red phase)
- Tests must cover ALL acceptance criteria listed in the task

### Step 3: Implement
- Write the minimum code to make tests pass
- Follow the architecture defined in ARCHITECTURE.md
- Keep `src/core/` pure — no DOM, no WebGL, no side effects
- Use TypeScript strict mode — fix all type errors

### Step 4: Validate
```bash
bash scripts/validate.sh
```
This runs: TypeScript compilation → Unit tests → Build check → Task consistency check (no skipped tasks, files exist, i18n in sync)

### Step 5: Integration Check (if applicable)
- If the task involves gameplay, test it via console mode
- Run `npx tsx src/console.ts` and manually verify the feature works
- Or run the integration test suite: `npx vitest run tests/integration/`

### Step 6: Visual Check (if applicable)
- If the task involves rendering, take a screenshot:
```bash
npx tsx scripts/screenshot.ts
```
- Inspect the screenshot to verify visual correctness

### Step 7: Mark Complete
- Update README.md: change `- [ ]` to `- [x]` for the completed task
- Move to the next task

## 3. Dealing with Blockers

If a task seems impossible or unclear:
1. Re-read the task description and referenced documents
2. Check if a prerequisite task was missed
3. Simplify: implement the minimum viable version that satisfies acceptance criteria
4. If truly blocked, leave a `<!-- BLOCKED: reason -->` comment in the README next to the task and move to the next independent task

## 4. Code Style Rules

- **TypeScript strict mode** — no `any` types except in test fixtures
- **Functional style** in `src/core/` — prefer pure functions, avoid mutation where practical
- **Interfaces over classes** for data structures
- **Classes** for stateful systems (EventSystem, WeatherCycle, etc.)
- **Named exports** — no default exports except in entry points
- **File size limit:** No file should exceed 300 lines. Split into sub-modules if needed.
- **Comments:** Document non-obvious algorithms. Don't comment obvious code.

## 5. Naming Conventions

- Files: `PascalCase.ts` for classes/interfaces, `camelCase.ts` for utility modules
- Types/Interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Test files: `{SourceFile}.test.ts`
- Translation keys: `dot.separated.lowercase` (e.g., `blast.too_strong`)

## 6. i18n Rules

- **All user-facing text** must go through the i18n system
- Never hardcode strings that the player sees
- Always add both `en.json` and `fr.json` entries simultaneously
- Use interpolation for dynamic values: `t('blast.fragments', { count: 42 })`
- Fictional names (rocks, explosives, ores) also go through i18n

## 7. Console Command Implementation Pattern

When adding a new console command:
1. Create a command handler in `src/console/commands/`
2. Register it in `ConsoleRunner.ts`
3. The handler receives `GameState` and parsed arguments
4. It calls core logic functions and returns a `CommandResult`
5. `ConsoleFormatter` converts the result to human-readable output
6. Write an integration test that exercises the command

## 8. Adding New Events

When implementing event definitions (50-100 per category):

**CREATIVE CHECKPOINT REQUIRED:** Before mass-generating events for a category, you MUST:
1. Write 5 complete sample events with full structure (id, i18n text EN+FR, prerequisites, probability formula, severity scaling, 2-4 decision options with consequences)
2. Present them to the human for creative approval
3. Wait for feedback on tone, humor level, structure, and content
4. Only then generate the remaining 45-95 events in that category

Implementation steps per event:
1. Define events in the category file (e.g., `UnionEvents.ts`)
2. Each event has: id, name (i18n key), prerequisites, probability weight formula, value formulas, decision options
3. Each decision option has: description (i18n key), effects on scores/finances/state
4. Add i18n entries for all event text in both en.json and fr.json
5. Write a unit test that verifies event triggering conditions
6. Write a unit test that verifies each decision option's effects
7. Be creative and humorous — this is a satirical game

## 9. Creative Direction

The human is the creative director. You handle ALL technical decisions autonomously, but you MUST ask the human for validation on creative content:

**Always ask for:** fictional names (rocks, explosives, ores, levels), event content and tone, humor calibration, game feel decisions.

**Never ask for:** code architecture, data structures, algorithms, test design, debugging, numerical balancing, translations.

When asking, always propose concrete options — never send vague questions.

## 10. Numerical Values and Balancing

For all game constants:
1. Research real-world equivalents (ANFO: ~3.4 MJ/kg, dynamite: ~7.5 MJ/kg, drill holes: 75-150mm, rock density: 2000-3000 kg/m³)
2. Scale values for gameplay — realistic starting point, adjusted for fun
3. Store ALL constants in centralized config files, never hardcode
4. Document real-world basis in code comments
5. The human will fine-tune during polish — get values in the right ballpark

## 11. Asset Placeholder Strategy

When a visual asset is needed:
1. Create it using simple Three.js geometries (Box, Cylinder, Sphere, Cone)
2. Use distinct flat colors for identification (e.g., yellow for excavator, gray for rock, red for explosive)
3. Register it in the AssetManager with a clear ID
4. The ID will later map to real 3D models — the interface stays the same

## 12. Error Handling

- Core functions should return result objects, not throw exceptions:
  ```typescript
  type Result<T> = { success: true; data: T } | { success: false; error: string };
  ```
- Physics/rendering can use try/catch for unexpected errors
- Console mode should catch and display errors gracefully
- Never let the game crash — show an error message and continue

## 13. Performance Considerations

- Marching cubes recalculation should be localized (only recompute chunks near the blast)
- Fragment count should be capped per blast (e.g., max 2000) to avoid physics overload
- Event system timers use delta-time accumulation, not setTimeout
- Voxel grid operations should use spatial indexing where beneficial

## 14. Reference Documents

Before implementing a feature, read the relevant document:

| Feature area | Read |
|-------------|------|
| Any game mechanic | `.agent/GAME_DESIGN.md` |
| Code structure, modules | `.agent/ARCHITECTURE.md` |
| Blast mechanics | `.agent/BLAST_SYSTEM.md` |
| Writing tests | `.agent/TESTING.md` |
| Workflow questions | `.agent/WORKFLOW.md` (this file) |
