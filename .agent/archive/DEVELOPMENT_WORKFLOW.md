# BlastSimulator2026 — Development Workflow (Archive)

This file preserves the workflow rules used during the autonomous phase-by-phase development (Phases 0–12). It is retained for historical reference. The current workflow for bug fixes and feature requests is described in `CLAUDE.md` and `.agent/WORKFLOW.md`.

---

## Golden Rules (Autonomous Development Phase)

1. **README.md is your single source of truth.** Read the task list before starting any work.
2. **One task at a time.** Never work on multiple tasks simultaneously.
3. **Tests first, code second.** Write acceptance tests before or alongside implementation.
4. **Validate after every task.** Run `bash scripts/validate.sh` after each task. If it fails, fix it before moving on.
5. **Mark tasks as done.** Update the README task list checkbox from `[ ]` to `[x]` when a task passes all its acceptance criteria.
6. **Core before rendering.** All game logic must work in console mode before adding visual elements.
7. **Never break existing tests.** If your change breaks a previously passing test, fix the regression before proceeding.
8. **Commit messages explain what and why.**

---

## Task Execution Procedure

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
- If the task involves rendering, take a screenshot using the one-command helper (see `.agent/VISUAL_TESTING.md`):
```bash
bash scripts/visual-test.sh --name "task-name" --commands "new_game seed:1"
```
- Inspect the screenshot to verify visual correctness; fix issues before marking complete

### Step 7: Mark Complete
- Update README.md: change `- [ ]` to `- [x]` for the completed task
- Update the Progress Summary table
- Move to the next task

---

## Dealing with Blockers

If a task seemed impossible or unclear:
1. Re-read the task description and referenced documents
2. Check if a prerequisite task was missed
3. Simplify: implement the minimum viable version that satisfies acceptance criteria
4. If truly blocked, leave a `<!-- BLOCKED: reason -->` comment in the README next to the task and move to the next independent task

---

## Creative Checkpoint Rules

Before mass-generating content (events, names, levels), the agent was required to:

1. Write 5 complete sample entries with full structure
2. Present them to the human (creative director) for approval on tone, humor, structure
3. Wait for explicit approval before generating the remaining 45–95 entries

**Creative checkpoints were required for:**
- Event content (Union, Politics, Weather, Mafia, Lawsuit events — tasks 6.3–6.7)
- Rock, ore, explosive names (tasks 2.1–2.3)
- Level names and difficulty parameters (task 7.1)

**The human was NOT asked about:**
- Technical architecture, code structure, algorithms
- Test design, debugging, build issues
- Data structure choices
- Numerical balancing
- i18n translations
- Any implementation detail

---

## Adding New Events (Historical Pattern)

When implementing event definitions (50–100 per category):

**CREATIVE CHECKPOINT REQUIRED:** Before mass-generating events for a category:
1. Write 5 complete sample events with full structure (id, i18n text EN+FR, prerequisites, probability formula, severity scaling, 2–4 decision options with consequences)
2. Present them to the human for creative approval
3. Wait for feedback on tone, humor level, structure, and content
4. Only then generate the remaining 45–95 events in that category

Implementation steps per event:
1. Define events in the category file (e.g., `UnionEvents.ts`)
2. Each event has: id, name (i18n key), prerequisites, probability weight formula, value formulas, decision options
3. Each decision option has: description (i18n key), effects on scores/finances/state
4. Add i18n entries for all event text in both en.json and fr.json
5. Write a unit test that verifies event triggering conditions
6. Write a unit test that verifies each decision option's effects

---

## Numerical Values and Balancing (Development Phase Rules)

For all game constants:
1. Research real-world equivalents (ANFO: ~3.4 MJ/kg, dynamite: ~7.5 MJ/kg, drill holes: 75–150mm, rock density: 2000–3000 kg/m³)
2. Scale values for gameplay — realistic starting point, adjusted for fun
3. Store ALL constants in centralized config files, never hardcode
4. Document real-world basis in code comments: `// Real ANFO: 3.4 MJ/kg, scaled to game units (x100)`
5. The human fine-tunes during polish — get values in the right ballpark

---

## Asset Placeholder Strategy

When a visual asset was needed:
1. Create it using simple Three.js geometries (Box, Cylinder, Sphere, Cone)
2. Use distinct flat colors for identification (yellow for excavator, gray for rock, red for explosive)
3. Register it in the AssetManager with a clear ID
4. The ID will later map to real 3D models — the interface stays the same
